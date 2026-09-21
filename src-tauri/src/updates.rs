//! Der In-App-Updater: Quelle, Pruefung, Installation.
//!
//! Die Update-Quelle ist absichtlich veraenderbar — steht sie in
//! `{appDataDir}/update.json`, wird sie den einkompilierten Endpoints aus
//! `tauri.conf.json` vorangestellt. Der oeffentliche Schluessel ist es
//! NICHT: er bleibt einkompiliert. Das ist die ganze Sicherheitsarchitektur
//! dieses Moduls. Eine umgebogene URL kann hoechstens nichts liefern oder ein
//! Bundle, dessen Signatur nicht passt — nie etwas, das installiert wird.
//! Waere der Schluessel mitveraenderbar, waere die variable Quelle ein
//! Einfallstor statt einer Bequemlichkeit.
//!
//! Alles laeuft hier in Rust statt ueber die JS-API des Plugins, aus zwei
//! Gruenden: die Endpoints lassen sich nur ueber den `UpdaterBuilder` zur
//! Laufzeit ueberschreiben, und der Netzverkehr bleibt so ausserhalb der
//! WebView — die CSP der App muss fuer Updates nicht aufgemacht werden.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Liegt neben `vaults.json` im App-Datenordner — bewusst dort und nicht in
/// den Vault-Einstellungen: welche Quelle diese Installation nach Updates
/// fragt, gehoert zur Installation, nicht zum Inhalt. Sonst koennte ein
/// importiertes fremdes Backup die Update-Quelle mitbringen.
const SETTINGS_FILE: &str = "update.json";

/// Kein Endlos-Haenger, wenn die Quelle nicht antwortet. Gilt pro Endpoint.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// Genug fuer jede URL, die ein Mensch eintippt, und eine harte Grenze gegen
/// eine Datei, die per Hand aufgeblaeht wurde.
const MAX_ENDPOINT_LEN: usize = 2048;

fn settings_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

/// Jedes Feld mit `serde(default)`: eine halb geschriebene oder von einer
/// aelteren Version stammende Datei laedt weiter, statt die Update-Seite
/// unbenutzbar zu machen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettings {
    #[serde(default = "settings_version")]
    version: u32,
    /// Leer heisst: die einkompilierten Endpoints, nichts vorangestellt.
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

/// Was die Pruefung gefunden hat.
#[derive(Debug, Serialize)]
pub struct UpdateCheck {
    available: bool,
    /// Die gefundene Version; leer, wenn nichts anliegt.
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
    /// Falsch auf einer `.deb`-Installation: der Updater kann nur AppImage,
    /// NSIS/MSI und macOS-Bundles ersetzen. Die UI zeigt dann einen Hinweis
    /// statt eines Knopfes, statt einen Fehler erst beim Klick zu liefern.
    installable: bool,
}

/// Ein Fehler, den die UI uebersetzen kann.
///
/// `code` statt eines fertigen Satzes: die Meldungen des Updater-Plugins sind
/// englisch und fuer Entwickler geschrieben ("Could not fetch a valid release
/// JSON from the remote"). Die haben im Fenster nichts verloren — und die
/// Alternative, sie im Frontend auf ihren Wortlaut zu pruefen, waere eine
/// Kopplung an Zeichenketten einer fremden Bibliothek. `detail` traegt den
/// Originaltext weiter, aber nur in die Konsole.
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

/// Ordnet einen Updater-Fehler einem der drei Faelle zu, die sich fuer einen
/// Nutzer wirklich unterscheiden: niemand hat geantwortet, diese Plattform
/// steht nicht im Manifest, oder etwas anderes ist schiefgegangen.
fn classify(e: tauri_plugin_updater::Error) -> UpdateError {
    use tauri_plugin_updater::Error as E;
    let code = match &e {
        // Die Anfrage kam gar nicht durch: kein Netz, DNS, TLS. Eine Quelle,
        // die mit 404 ANTWORTET, landet nicht hier — siehe `check_for_update`.
        E::Reqwest(_) | E::Io(_) => "unreachable",
        // Der Fall eines Intel-Macs: das Manifest ist da, fuehrt diese
        // Plattform aber nicht.
        E::TargetNotFound(_) | E::TargetsNotFound(_) | E::UnsupportedArch | E::UnsupportedOs => {
            "unsupported-target"
        }
        _ => "failed",
    };
    UpdateError::new(code, e)
}

/// Das Ergebnis der letzten Pruefung, bis es installiert wird.
///
/// Gehalten wird es, damit `install_update` nicht erneut ueber das Netz muss —
/// und damit nicht etwas anderes installiert wird als das, was dem Nutzer
/// gezeigt wurde.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|e| format!("no app data dir: {e}"))
}

/// Fehlt die Datei oder ist sie kaputt, gelten die Vorgaben. Ein Lesefehler
/// darf den Updater nicht abschalten — er faellt auf die einkompilierte
/// Quelle zurueck, und die ist der Normalfall.
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

/// Nur `https`. Eine `http`-Quelle waere eine Einladung, das Manifest im Netz
/// zu ersetzen — die Signaturpruefung faenge das zwar ab, aber ein Angreifer
/// koennte die App beliebig lange auf einer alten, verwundbaren Version
/// festhalten. `file:` und alles andere haben hier ebenfalls nichts zu suchen.
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

/// Die Endpoints aus `tauri.conf.json`, gelesen statt in Rust wiederholt.
///
/// `UpdaterBuilder::endpoints` ersetzt die Liste, statt sie zu ergaenzen. Um
/// die eingebauten Quellen als Rueckfall zu behalten, muessen sie also hier
/// bekannt sein — und die einzige Wahrheit dafuer ist die Konfiguration.
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

/// Auf Linux kann der Updater nur ein AppImage ersetzen, und das erkennt er an
/// der `APPIMAGE`-Variable, die der AppImage-Runtime setzt. Fehlt sie, laeuft
/// die App aus einem `.deb` — dann gibt es nichts zu installieren.
fn install_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
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
    // Geprueft wird vor dem Schreiben, damit eine unbrauchbare Quelle gar
    // nicht erst in der Datei landet — sonst stuende sie beim naechsten Start
    // wieder da und die Pruefung schluge jedes Mal fehl.
    if !endpoint.is_empty() {
        parse_endpoint(&endpoint).map_err(|e| UpdateError::new("invalid-url", e))?;
    }
    let settings = UpdateSettings {
        version: settings_version(),
        endpoint,
        auto_check,
    };
    // Getrennt vom Adressfehler: eine Platte, auf die nicht geschrieben werden
    // kann, ist kein Tippfehler des Nutzers und darf nicht so heissen.
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
        builder = builder.endpoints(endpoints).map_err(classify)?;
    }

    let found = match builder.build().map_err(classify)?.check().await {
        Ok(found) => found,
        // Jeder Endpoint hat geantwortet, keiner mit einem brauchbaren
        // Manifest — das Plugin sammelt einen Fehler nur, wenn die Anfrage
        // selbst scheiterte, und meldet sonst am Ende `ReleaseNotFound`. Fuer
        // den Nutzer heisst das dasselbe wie eine Quelle ohne neuere Version:
        // es gibt nichts zu holen. Das ist kein Fehler, sondern der Normalfall,
        // solange noch kein Release ein Manifest traegt.
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => None,
        Err(e) => return Err(classify(e)),
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

    // Auch ein `None` wird uebernommen: sonst haenge der vorige Fund weiter im
    // Zustand und "Installieren" bezoege sich auf ein Ergebnis, das der Nutzer
    // gerade widerlegt hat.
    *state.0.lock().map_err(|_| UpdateError::new("failed", "state poisoned"))? = found;
    Ok(check)
}

/// Laedt und installiert, was die letzte Pruefung gefunden hat, und startet
/// die App neu. Kehrt im Erfolgsfall nicht zurueck.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, PendingUpdate>,
) -> Result<(), UpdateError> {
    if !install_supported() {
        return Err(UpdateError::new("unsupported-install", "no APPIMAGE in the environment"));
    }

    // Herausgenommen statt gehalten: ein MutexGuard darf nicht ueber ein
    // `await` leben. Bei einem Fehlschlag wandert der Fund zurueck, damit ein
    // zweiter Versuch nicht erst neu pruefen muss.
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
        return Err(classify(e));
    }

    // Auf Windows beendet der NSIS-Installer die App selbst; kommt der Aufruf
    // doch zurueck, ist der Neustart der dokumentierte Abschluss.
    app.restart();
}
