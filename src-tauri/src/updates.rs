//! The in-app updater: source, check, installation.
//!
//! The update source is deliberately changeable — if it is set in
//! `{appDataDir}/update.json`, it is prepended to the compiled-in endpoints from
//! `tauri.conf.json`. The public key is NOT: it stays compiled in. That is the
//! whole security architecture of this module. A redirected URL can at most
//! deliver nothing or a bundle whose signature does not match — never anything
//! that gets installed. Were the key changeable too, the variable source would
//! be an entry point instead of a convenience.
//!
//! Everything runs here in Rust instead of through the plugin's JS API, for two
//! reasons: the endpoints can only be overridden at runtime through the
//! `UpdaterBuilder`, and the network traffic stays outside the WebView — the
//! app's CSP does not have to be opened up for updates.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Sits next to `vaults.json` in the app data folder — deliberately there and
/// not in the vault settings: which source this installation asks for updates
/// belongs to the installation, not to the content. Otherwise an imported
/// foreign backup could bring the update source along.
const SETTINGS_FILE: &str = "update.json";

/// No endless hang if the source does not answer. Applies per endpoint.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// Enough for any URL a human types, and a hard limit against a file that
/// was inflated by hand.
const MAX_ENDPOINT_LEN: usize = 2048;

fn settings_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

/// Every field has `serde(default)`: a half-written file, or one from an
/// older version, still loads instead of making the update page unusable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettings {
    #[serde(default = "settings_version")]
    version: u32,
    /// Empty means: the compiled-in endpoints, nothing prepended.
    #[serde(default)]
    endpoint: String,
    #[serde(default = "default_true")]
    auto_check: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            version: settings_version(),
            endpoint: String::new(),
            auto_check: true,
        }
    }
}

/// What the check found.
#[derive(Debug, Serialize)]
pub struct UpdateCheck {
    available: bool,
    /// The version found; empty if nothing is pending.
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
    /// False on a `.deb` installation. Not because the plugin could not do it
    /// — it calls `pkexec dpkg -i` for that — but because the manifest would need
    /// its own key `linux-x86_64-deb` for it and the release workflow publishes
    /// none. The UI therefore shows a notice instead of a button, rather than
    /// delivering the error only on click.
    installable: bool,
}

/// An error the UI can translate.
///
/// `code` instead of a finished sentence: the updater plugin's messages are
/// English and written for developers ("Could not fetch a valid release JSON
/// from the remote"). They do not belong in the window — and the alternative,
/// checking their wording in the frontend, would couple us to the strings of a
/// foreign library. `detail` carries the original text along, but only into the
/// console.
#[derive(Debug, Serialize)]
pub struct UpdateError {
    code: &'static str,
    detail: String,
}

impl UpdateError {
    fn new(code: &'static str, detail: impl std::fmt::Display) -> Self {
        Self { code, detail: detail.to_string() }
    }
}

/// Maps an error of the CHECK to one of the cases that really differ for a
/// user: nobody answered, this platform is not in the manifest, or something
/// else went wrong.
fn classify_check(e: tauri_plugin_updater::Error) -> UpdateError {
    use tauri_plugin_updater::Error as E;
    let code = match &e {
        // The request did not get through at all: no network, DNS, TLS. A source
        // that ANSWERS with 404 does not end up here — see `check_for_update`.
        E::Reqwest(_) | E::Io(_) => "unreachable",
        // The case of an Intel Mac: the manifest is there, but it does not list
        // this platform.
        E::TargetNotFound(_) | E::TargetsNotFound(_) | E::UnsupportedArch | E::UnsupportedOs => {
            "unsupported-target"
        }
        _ => "failed",
    };
    UpdateError::new(code, e)
}

/// The same for the INSTALLATION — and deliberately not the same function.
/// `Io` here does not mean "nobody answered" but that the bundle could not be
/// written or replaced. With the check's mapping, a user with a permissions
/// problem would have read that the source is unreachable — and looked in the
/// wrong place.
fn classify_install(e: tauri_plugin_updater::Error) -> UpdateError {
    use tauri_plugin_updater::Error as E;
    let code = match &e {
        E::Reqwest(_) => "unreachable",
        E::Io(_) => "install-failed",
        _ => "failed",
    };
    UpdateError::new(code, e)
}

/// The result of the last check, until it is installed.
///
/// It is kept so that `install_update` does not have to go over the network
/// again — and so that nothing other than what was shown to the user gets
/// installed.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|e| format!("no app data dir: {e}"))
}

/// If the file is missing or broken, the defaults apply. A read error must
/// not switch the updater off — it falls back to the compiled-in source, and
/// that is the normal case.
fn load_settings(app: &AppHandle) -> UpdateSettings {
    let Ok(path) = settings_path(app) else {
        return UpdateSettings::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => UpdateSettings::default(),
    }
}

fn save_settings(app: &AppHandle, settings: &UpdateSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write failed: {e}"))
}

/// `https` only. An `http` source would be an invitation to replace the
/// manifest on the network — the signature check would catch that, but an
/// attacker could hold the app on an old, vulnerable version for as long as
/// they like. `file:` and everything else have no business here either.
fn parse_endpoint(raw: &str) -> Result<url::Url, String> {
    if raw.len() > MAX_ENDPOINT_LEN {
        return Err("endpoint too long".into());
    }
    let url = url::Url::parse(raw).map_err(|e| format!("invalid url: {e}"))?;
    if url.scheme() != "https" {
        return Err("endpoint must use https".into());
    }
    Ok(url)
}

/// The endpoints from `tauri.conf.json`, read instead of repeated in Rust.
///
/// `UpdaterBuilder::endpoints` replaces the list instead of extending it. To
/// keep the built-in sources as a fallback, they must be known here — and the
/// single source of truth for that is the configuration.
fn configured_endpoints(app: &AppHandle) -> Vec<url::Url> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|cfg| cfg.get("endpoints"))
        .and_then(|list| list.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| url::Url::parse(s).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Whether this installation can replace itself.
///
/// On Linux this hangs on the AppImage — but checking `APPIMAGE` alone would be
/// wrong, and dangerously so: the variable is an ordinary environment variable
/// and is inherited by every child process. An Emerald installed from a `.deb`,
/// started from a terminal or editor that is itself an AppImage, sees the path
/// of THAT AppImage there. The plugin takes exactly this path as the
/// installation target (`env.appimage` → `extract_path`) — so in the worst case
/// a foreign application is overwritten, and in the best case the installation
/// fails after the complete download.
///
/// Hence the additional probe that `tauri-utils` itself uses (there only for a
/// warning): a running AppImage application lives in the mount point
/// `{temp}/.mount_…`. Both together mean "this program IS an AppImage", rather
/// than "there was one somewhere around here".
///
/// A hand-unpacked AppImage (`--appimage-extract` plus `AppRun`, the usual way
/// without libfuse2) thus falls into "not replaceable" — correct, since there is
/// no single file to swap there.
fn install_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_none() {
            return false;
        }
        let mount_prefix = format!("{}/.mount_", std::env::temp_dir().display());
        std::env::current_exe()
            .map(|exe| exe.display().to_string().starts_with(&mount_prefix))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

#[tauri::command]
pub fn update_settings(app: AppHandle) -> UpdateSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn set_update_settings(
    app: AppHandle,
    endpoint: String,
    auto_check: bool,
) -> Result<UpdateSettings, UpdateError> {
    let endpoint = endpoint.trim().to_string();
    // Checked before writing, so that an unusable source does not even land in
    // the file — otherwise it would be there again at the next start and the check
    // would fail every time.
    if !endpoint.is_empty() {
        parse_endpoint(&endpoint).map_err(|e| UpdateError::new("invalid-url", e))?;
    }
    let settings = UpdateSettings {
        version: settings_version(),
        endpoint,
        auto_check,
    };
    // Separate from the address error: a disk that cannot be written to is not
    // a typo by the user and must not be called one.
    save_settings(&app, &settings).map_err(|e| UpdateError::new("write-failed", e))?;
    Ok(settings)
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, PendingUpdate>,
) -> Result<UpdateCheck, UpdateError> {
    let settings = load_settings(&app);
    let current_version = app.package_info().version.to_string();

    let mut builder = app.updater_builder().timeout(CHECK_TIMEOUT);
    if !settings.endpoint.is_empty() {
        let endpoint = parse_endpoint(&settings.endpoint)
            .map_err(|e| UpdateError::new("invalid-url", e))?;
        let mut endpoints = vec![endpoint];
        endpoints.extend(configured_endpoints(&app));
        builder = builder.endpoints(endpoints).map_err(classify_check)?;
    }

    let found = match builder.build().map_err(classify_check)?.check().await {
        Ok(found) => found,
        // Every endpoint answered, none with a usable manifest — the plugin only
        // collects an error if the request itself failed, and otherwise reports
        // `ReleaseNotFound` at the end. For the user this means the same as a source
        // without a newer version: there is nothing to fetch. That is not an error but
        // the normal case, as long as no release carries a manifest yet.
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => None,
        Err(e) => return Err(classify_check(e)),
    };

    let check = match &found {
        Some(update) => UpdateCheck {
            available: true,
            version: update.version.clone(),
            current_version,
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
            installable: install_supported(),
        },
        None => UpdateCheck {
            available: false,
            version: String::new(),
            current_version,
            notes: None,
            date: None,
            installable: install_supported(),
        },
    };

    // A `None` is taken over too: otherwise the previous finding would stay in
    // the state and "Install" would refer to a result the user has just
    // disproved.
    *state.0.lock().map_err(|_| UpdateError::new("failed", "state poisoned"))? = found;
    Ok(check)
}

/// Downloads and installs what the last check found, and restarts the app.
/// Does not return on success.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, PendingUpdate>,
) -> Result<(), UpdateError> {
    if !install_supported() {
        return Err(UpdateError::new("unsupported-install", "no APPIMAGE in the environment"));
    }

    // Taken out instead of held: a MutexGuard must not live across an
    // `await`. On failure the finding goes back, so that a second attempt does not
    // have to check anew.
    let update = {
        let mut pending = state.0.lock()
            .map_err(|_| UpdateError::new("failed", "state poisoned"))?;
        pending.take()
            .ok_or_else(|| UpdateError::new("nothing-to-install", "no checked update held"))?
    };

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();

    let result = update
        .download_and_install(
            move |chunk, content_length| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "update://progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": content_length,
                    }),
                );
            },
            || {},
        )
        .await;

    if let Err(e) = result {
        if let Ok(mut pending) = state.0.lock() {
            *pending = Some(update);
        }
        return Err(classify_install(e));
    }

    // On Windows the NSIS installer ends the app itself; if the call returns
    // after all, the restart is the documented conclusion.
    app.restart();
}
