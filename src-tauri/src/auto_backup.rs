//! The automatic backup: which vaults, how often, where to — and the
//! schedule that writes their raw backups (`raw_backup.rs`) while the app runs.
//!
//! It belongs to the installation, not to a vault, and is set on the start
//! page: one list of vaults, one interval, one retention and one folder for
//! all of them, in `{appDataDir}/auto-backup.json`. Every chosen vault is
//! backed up on schedule — locked or unlocked, open or not, also while only
//! the start page is shown. The schedule lives here, not in the frontend: it
//! looks shortly after the start, every hour after that, and whenever the
//! setting changes.
//!
//! No command in this module takes a path. The target is either the vault's
//! own `backups/` folder or a folder the user picked in a dialog this module
//! opens itself, and the file name is built here too. That is what allows the
//! one deliberate step outside `resolve_allowed_roots`: a picked folder may
//! lie anywhere — another drive, a USB disk, a share — because the only way to
//! name it is the native dialog. What can be written there is a raw backup
//! under a fixed name, and what can be deleted there is exactly a chosen
//! vault's own automatic backups.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::vault;

const STATE_FILE: &str = "auto-backup.json";
const STATE_TEMP_FILE: &str = "auto-backup.json.tmp";
const NAME_PREFIX: &str = "emerald-auto-";
const NAME_SUFFIX: &str = ".vault.emerald";
/// How much of the vault id goes into the file name — enough to keep the
/// vaults sharing one folder apart.
const TAG_LEN: usize = 8;

/// The picked folder is not there right now — an unplugged disk, most likely.
const DIR_MISSING: &str = "AUTO_BACKUP_DIR_MISSING";
/// The vault's folder is not there right now.
const VAULT_MISSING: &str = "AUTO_BACKUP_VAULT_MISSING";

/// What the start page offers for "keep" — mirrors `BACKUP_KEEP_OPTIONS` in
/// `src/store/autoBackupStore.ts`, without its `null` (= all); change both together.
/// Checked here as well: a caller that could pass `1` would wipe the history
/// with a single call.
const KEEP_CHOICES: [u32; 4] = [3, 5, 10, 30];

/// The event the frontend refreshes its view on.
const CHANGED_EVENT: &str = "auto-backup-changed";
/// After the start: the frontend registers the vaults first.
const FIRST_CHECK: Duration = Duration::from_secs(20);
const RECHECK: Duration = Duration::from_secs(60 * 60);
/// After a change of the setting, and the next try after a busy vault.
const SETTLE: Duration = Duration::from_secs(5);
const RETRY: Duration = Duration::from_secs(60);

/// Serialises read-modify-write of [`STATE_FILE`].
static STATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Interval {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    /// The vaults that are backed up.
    #[serde(default)]
    vaults: Vec<String>,
    #[serde(default = "default_interval")]
    interval: Interval,
    /// For `weekly`: 0 = Sunday … 6 = Saturday, as JavaScript counts.
    #[serde(default = "default_weekday")]
    weekday: u8,
    /// How many backups of each vault are kept; `None` keeps all.
    #[serde(default = "default_keep")]
    keep: Option<u32>,
    /// The picked folder; `None` while each vault's own `backups/` is used.
    #[serde(default)]
    dir: Option<String>,
}

fn default_interval() -> Interval {
    Interval::Weekly
}
fn default_weekday() -> u8 {
    1
}
fn default_keep() -> Option<u32> {
    Some(10)
}

impl Default for State {
    fn default() -> Self {
        State { vaults: Vec::new(), interval: default_interval(), weekday: default_weekday(), keep: default_keep(), dir: None }
    }
}

impl State {
    /// What a file written by hand may not bring: an invalid id, a count the
    /// start page does not offer, a day that is none, a relative folder.
    fn sane(mut self) -> State {
        let mut seen = std::collections::HashSet::new();
        self.vaults.retain(|id| vault::is_valid_vault_id(id) && seen.insert(id.clone()));
        if self.keep.is_some_and(|keep| !KEEP_CHOICES.contains(&keep)) {
            self.keep = default_keep();
        }
        if self.weekday > 6 {
            self.weekday = default_weekday();
        }
        if self.dir.as_ref().is_some_and(|dir| !Path::new(dir).is_absolute()) {
            self.dir = None;
        }
        self
    }
}

fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no app data dir: {e}"))
}

/// A missing or broken file means: nothing chosen.
fn load_state(app: &tauri::AppHandle) -> State {
    state_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(STATE_FILE)).ok())
        .and_then(|raw| serde_json::from_str::<State>(&raw).ok())
        .unwrap_or_default()
        .sane()
}

fn update_state(app: &tauri::AppHandle, change: impl FnOnce(&mut State)) -> Result<State, String> {
    let _guard = STATE_LOCK.lock().map_err(|_| "auto backup state unavailable".to_string())?;
    let mut state = load_state(app);
    change(&mut state);
    let state = state.sane();
    let dir = state_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir failed: {e}"))?;
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    vault::write_atomic(&dir, STATE_FILE, STATE_TEMP_FILE, &json)?;
    Ok(state)
}

// ── names and days ───────────────────────────────────────────────────────────

/// The part of the vault id that goes into the file name. Ids are ASCII
/// (`vault_dir` refuses anything else), so the cut cannot split a character.
fn vault_tag(vault_id: &str) -> &str {
    &vault_id[..vault_id.len().min(TAG_LEN)]
}

/// `YYYY-MM-DD`, by shape. Sorting such strings sorts the days.
fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() })
}

fn file_name(tag: &str, date: &str) -> String {
    format!("{NAME_PREFIX}{tag}-{date}{NAME_SUFFIX}")
}

/// The day in the name of one of this vault's automatic backups — `None` for
/// every other name, including another vault's and a manual export.
fn backup_date<'a>(name: &'a str, tag: &str) -> Option<&'a str> {
    let date = name
        .strip_prefix(NAME_PREFIX)?
        .strip_prefix(tag)?
        .strip_prefix('-')?
        .strip_suffix(NAME_SUFFIX)?;
    is_date(date).then_some(date)
}

/// This vault's automatic backups in `dir`, oldest first. Regular files only —
/// a link or folder of that name is not one.
fn own_backups(dir: &Path, tag: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("read {}: {e}", dir.display())),
    };
    let mut found: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|entry| {
            let date = backup_date(entry.file_name().to_str()?, tag)?.to_string();
            Some((date, entry.path()))
        })
        .collect();
    found.sort();
    Ok(found)
}

/// Deletes this vault's automatic backups in `dir` except the newest `keep`
/// and returns how many went. Nothing that is not exactly such a file.
fn prune_in(dir: &Path, tag: &str, keep: u32) -> Result<u32, String> {
    let found = own_backups(dir, tag)?;
    // Never all of them: the one just written stays, whatever arrives.
    let surplus = found.len().saturating_sub(keep.max(1) as usize);
    for (_, path) in &found[..surplus] {
        std::fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(surplus as u32)
}

fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

fn iso(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

/// Whether a backup is due: since the last scheduled day there is none yet —
/// so a day missed while the app was closed is made up at the next start, and
/// without any backup one is due at once.
fn is_due(state: &State, newest: Option<&str>, today: NaiveDate) -> bool {
    let Some(newest) = newest else { return true };
    let scheduled = match state.interval {
        Interval::Daily => today,
        Interval::Monthly => today.with_day(1).expect("the first exists"),
        Interval::Weekly => {
            let back = (today.weekday().num_days_from_sunday() as i64 - state.weekday as i64).rem_euclid(7);
            today - chrono::Duration::days(back)
        }
    };
    newest < iso(scheduled).as_str()
}

// ── targets ──────────────────────────────────────────────────────────────────

struct Target {
    dir: PathBuf,
    /// The picked folder is not reachable.
    missing: bool,
}

/// Where a vault's automatic backups go. The vault's own `backups/` is
/// created on demand — but never the vault folder above it. A picked folder
/// is never created: one that is gone is reported, not silently replaced by
/// an empty folder on whatever now answers to that path.
fn target(vault_dir: &Path, picked: Option<&str>) -> Target {
    match picked {
        Some(picked) => {
            let dir = PathBuf::from(picked);
            // The dialog only returns absolute paths; anything else did not come from here.
            let missing = !dir.is_absolute() || !dir.is_dir();
            Target { dir, missing }
        }
        None => Target { dir: vault_dir.join(vault::BACKUP_SUBDIR), missing: false },
    }
}

// ── runs ─────────────────────────────────────────────────────────────────────

/// What the schedule did last, per vault, and how to wake it.
#[derive(Default)]
pub struct AutoBackup {
    runs: Mutex<HashMap<String, Run>>,
    wake: tokio::sync::Notify,
}

#[derive(Clone, Default)]
struct Run {
    running: bool,
    /// The code of the last failure, cleared by the next success.
    error: Option<&'static str>,
}

fn set_run(app: &tauri::AppHandle, vault_id: &str, change: impl FnOnce(&mut Run)) {
    let state = app.state::<AutoBackup>();
    let mut runs = state.runs.lock().unwrap_or_else(|p| p.into_inner());
    change(runs.entry(vault_id.to_string()).or_default());
    drop(runs);
    app.emit(CHANGED_EVENT, ()).ok();
}

/// What a run came to.
#[derive(Debug, PartialEq)]
enum Outcome {
    Written,
    NotDue,
    /// Changed or locked during the copy: worth another try soon.
    Busy,
    Failed(&'static str),
}

/// Backs up one vault if it is due — with `force` anyway.
async fn run_one(app: &tauri::AppHandle, vault_id: &str, force: bool) -> Outcome {
    let state = load_state(app);
    let Ok(vault_dir) = vault::vault_dir(app, vault_id) else {
        return Outcome::NotDue;
    };
    {
        let runs = app.state::<AutoBackup>();
        let mut runs = runs.runs.lock().unwrap_or_else(|p| p.into_inner());
        let run = runs.entry(vault_id.to_string()).or_default();
        if run.running {
            return Outcome::Busy;
        }
        run.running = true;
    }
    app.emit(CHANGED_EVENT, ()).ok();
    let outcome = back_up(app, vault_id, &vault_dir, &state, force).await;
    set_run(app, vault_id, |run| {
        run.running = false;
        match &outcome {
            Outcome::Written | Outcome::NotDue => run.error = None,
            Outcome::Failed(code) => run.error = Some(code),
            Outcome::Busy => {}
        }
    });
    outcome
}

async fn back_up(app: &tauri::AppHandle, vault_id: &str, vault_dir: &Path, state: &State, force: bool) -> Outcome {
    if vault::directory_state(vault_dir).is_err() {
        return Outcome::Failed("vaultMissing");
    }
    let target = target(vault_dir, state.dir.as_deref());
    if target.missing {
        return Outcome::Failed("dirMissing");
    }
    let tag = vault_tag(vault_id).to_string();
    let today = today();
    let (dir, tag_for_list) = (target.dir.clone(), tag.clone());
    let newest = tauri::async_runtime::spawn_blocking(move || own_backups(&dir, &tag_for_list).map(|mut found| found.pop().map(|(date, _)| date)))
        .await
        .map_err(|e| e.to_string())
        .and_then(|found| found);
    let newest = match newest {
        Ok(newest) => newest,
        Err(e) => {
            eprintln!("[auto-backup] reading {} failed: {e}", target.dir.display());
            return Outcome::Failed("failed");
        }
    };
    if !force && !is_due(state, newest.as_deref(), today) {
        return Outcome::NotDue;
    }
    // Only the vault's own `backups/` is made; a picked folder that vanished
    // since the check above lets the write fail rather than be recreated.
    let made = if state.dir.is_none() { std::fs::create_dir_all(&target.dir) } else { Ok(()) };
    if let Err(e) = made {
        eprintln!("[auto-backup] creating {} failed: {e}", target.dir.display());
        return Outcome::Failed("failed");
    }

    // One file per day: a second run replaces it.
    let file = target.dir.join(file_name(&tag, &iso(today)));
    let key = crate::raw_backup::key_in_memory(app, vault_id);
    let (closed_app, closed_id) = (app.clone(), vault_id.to_string());
    let still_closed = move || !crate::db::is_open_blocking(&closed_app, &closed_id);
    match crate::raw_backup::write(vault_dir, vault_id, key.as_ref(), &file, still_closed).await {
        Ok(()) => {}
        Err(e) if e == crate::raw_backup::BUSY => return Outcome::Busy,
        Err(e) if e == crate::raw_backup::INTERRUPTED => return Outcome::Failed("interrupted"),
        Err(e) if e == crate::keys::VAULT_KEY_MISSING => return Outcome::Failed("keyMissing"),
        Err(e) => {
            eprintln!("[auto-backup] {vault_id} failed: {e}");
            return Outcome::Failed("failed");
        }
    }
    // The backup is in place. If the cleanup fails, that is not a failed backup.
    if let Some(keep) = state.keep {
        let dir = target.dir.clone();
        let pruned = tauri::async_runtime::spawn_blocking(move || prune_in(&dir, &tag, keep)).await;
        if let Ok(Err(e)) = pruned {
            eprintln!("[auto-backup] prune failed: {e}");
        }
    }
    Outcome::Written
}

/// One pass over the chosen vaults; `true` when one was busy and wants another try soon.
async fn run_due(app: &tauri::AppHandle) -> bool {
    let mut retry = false;
    for vault_id in load_state(app).vaults {
        if run_one(app, &vault_id, false).await == Outcome::Busy {
            retry = true;
        }
    }
    retry
}

/// Starts the schedule for the life of the app.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AutoBackup>();
        let mut wait = FIRST_CHECK;
        loop {
            // Woken before the time is up: by a change of the setting.
            if tokio::time::timeout(wait, state.wake.notified()).await.is_ok() {
                // Someone clicking through the choices triggers one run, not five.
                tokio::time::sleep(SETTLE).await;
            }
            wait = if run_due(&app).await { RETRY } else { RECHECK };
        }
    });
}

fn wake(app: &tauri::AppHandle) {
    app.state::<AutoBackup>().wake.notify_one();
}

// ── commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupSettings {
    vaults: Vec<String>,
    interval: Interval,
    weekday: u8,
    keep: Option<u32>,
    /// The picked folder; `None` while each vault's own `backups/` is used.
    custom_dir: Option<String>,
    /// The picked folder is not reachable right now.
    dir_missing: bool,
}

impl From<State> for AutoBackupSettings {
    fn from(state: State) -> Self {
        let dir_missing = state.dir.as_deref().is_some_and(|dir| target(Path::new(""), Some(dir)).missing);
        AutoBackupSettings {
            vaults: state.vaults,
            interval: state.interval,
            weekday: state.weekday,
            keep: state.keep,
            custom_dir: state.dir,
            dir_missing,
        }
    }
}

/// On the blocking pool: the folder may be a share that takes its time to answer.
#[tauri::command]
pub async fn auto_backup_settings(app: tauri::AppHandle) -> Result<AutoBackupSettings, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(load_state(&app).into()))
        .await
        .map_err(|e| e.to_string())?
}

/// Stores the choice of vaults, interval and retention; the folder has
/// commands of its own. Wakes the schedule: a newly chosen vault without a
/// backup gets its first one in a few seconds.
#[tauri::command(async)]
pub fn set_auto_backup_settings(
    app: tauri::AppHandle,
    vaults: Vec<String>,
    interval: Interval,
    weekday: u8,
    keep: Option<u32>,
) -> Result<AutoBackupSettings, String> {
    if keep.is_some_and(|keep| !KEEP_CHOICES.contains(&keep)) {
        return Err("invalid keep count".to_string());
    }
    if weekday > 6 || vaults.iter().any(|id| !vault::is_valid_vault_id(id)) {
        return Err("invalid auto backup settings".to_string());
    }
    let state = update_state(&app, |state| {
        state.vaults = vaults;
        state.interval = interval;
        state.weekday = weekday;
        state.keep = keep;
    })?;
    wake(&app);
    Ok(state.into())
}

/// Opens the folder dialog and remembers the choice for all vaults. `None`
/// when the dialog was cancelled. The dialog is opened here and not in the
/// frontend so that the path never crosses IPC as an argument.
#[tauri::command]
pub async fn pick_auto_backup_dir(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            // In a build with the dev bridge, while a client is connected and the
            // instance is out of sight, the question goes to that client instead
            // of to a dialog: a native folder dialog cannot be answered from
            // outside on macOS.
            #[cfg(feature = "devbridge")]
            let held = crate::devbridge::pick_folder(&app);
            #[cfg(not(feature = "devbridge"))]
            let held: Option<Option<std::path::PathBuf>> = None;
            let picked = match held {
                Some(answer) => answer,
                None => match app.dialog().file().set_parent(&window).blocking_pick_folder() {
                    Some(picked) => Some(picked.into_path().map_err(|e| e.to_string())?),
                    None => None,
                },
            };
            let Some(dir) = picked else {
                return Ok::<_, String>(None);
            };
            if !dir.is_absolute() || !dir.is_dir() {
                return Err(DIR_MISSING.to_string());
            }
            // A name that is not UTF-8 would enter the file lossily and then
            // never match the folder again.
            let path = dir.to_str().ok_or("folder name is not valid UTF-8")?.to_string();
            update_state(&app, |state| state.dir = Some(path.clone()))?;
            Ok(Some(path))
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    if picked.is_some() {
        wake(&app);
    }
    Ok(picked)
}

/// Back to each vault's own `backups/` folder.
#[tauri::command(async)]
pub fn reset_auto_backup_dir(app: tauri::AppHandle) -> Result<(), String> {
    update_state(&app, |state| state.dir = None)?;
    wake(&app);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackupStatus {
    vault_id: String,
    /// Where its backups go.
    dir: String,
    /// The day of its newest automatic backup there.
    newest: Option<String>,
    running: bool,
    /// `dirMissing`, `vaultMissing`, `interrupted` (a re-encryption cut short),
    /// `keyMissing` (an encrypted database without `vault.key`) or `failed` —
    /// the last run's, until one succeeds.
    error: Option<&'static str>,
}

/// Per registered vault — chosen or not — where its backups go, its newest
/// and what the last run came to. On the blocking pool: the folder may be a
/// share that takes its time to answer.
#[tauri::command]
pub async fn auto_backup_status(app: tauri::AppHandle, vault_ids: Vec<String>) -> Result<Vec<VaultBackupStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = load_state(&app);
        let runs = app.state::<AutoBackup>().runs.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let mut out = Vec::new();
        for vault_id in vault_ids {
            let Ok(vault_dir) = vault::vault_dir(&app, &vault_id) else { continue };
            let target = target(&vault_dir, state.dir.as_deref());
            let newest = if target.missing {
                None
            } else {
                own_backups(&target.dir, vault_tag(&vault_id)).ok().and_then(|mut found| found.pop()).map(|(date, _)| date)
            };
            let run = runs.get(&vault_id).cloned().unwrap_or_default();
            out.push(VaultBackupStatus {
                dir: target.dir.to_string_lossy().into_owned(),
                newest,
                running: run.running,
                error: run.error,
                vault_id,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How long "Back up now" waits for a backup already running, in seconds —
/// a large vault on a slow disk takes minutes.
const BACK_UP_NOW_WAIT_SECS: u32 = 15 * 60;

/// "Back up now": today's backup of one vault, due or not. Waits for a run
/// of it — or of another vault — that is going on, and for a password change; `AUTO_BACKUP_BUSY`
/// when it still could not after `BACK_UP_NOW_WAIT_SECS`.
#[tauri::command]
pub async fn back_up_vault_now(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    vault::vault_dir(&app, &vault_id).map_err(|_| VAULT_MISSING.to_string())?;
    // Waits out another vault's backup: the schedule would not come back to
    // this one if it is not due, so the request would be lost otherwise.
    for _ in 0..BACK_UP_NOW_WAIT_SECS {
        match run_one(&app, &vault_id, true).await {
            Outcome::Written | Outcome::NotDue => return Ok(()),
            Outcome::Failed(code) => return Err(code.to_string()),
            Outcome::Busy => tokio::time::sleep(Duration::from_secs(1)).await,
        }
    }
    // Another run held the vault or the lock for all that time.
    Err("AUTO_BACKUP_BUSY".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch() -> PathBuf {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("emerald-auto-backup-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn only_this_vaults_automatic_backups_are_recognised() {
        assert_eq!(backup_date("emerald-auto-1a2b3c4d-2026-10-06.vault.emerald", "1a2b3c4d"), Some("2026-10-06"));
        assert_eq!(backup_date(&file_name("default", "2026-01-31"), "default"), Some("2026-01-31"));
        for name in [
            "emerald-backup-2026-10-06.vault.emerald",
            "emerald-auto-1a2b3c4d-2026-10-06.emeralddb",
            "emerald-auto-ffffffff-2026-10-06.vault.emerald",
            "emerald-auto-1a2b3c4d-2026-10-06.vault.emerald.part",
            "emerald-auto-1a2b3c4d-2026-10-6.vault.emerald",
            "emerald-auto-1a2b3c4d-2026-10-06-copy.vault.emerald",
            "emerald-auto-1a2b3c4d-.vault.emerald",
            "emerald-auto-1a2b3c4d2026-10-06.vault.emerald",
        ] {
            assert_eq!(backup_date(name, "1a2b3c4d"), None, "{name}");
        }
    }

    #[test]
    fn the_tag_is_the_start_of_the_id() {
        assert_eq!(vault_tag("1a2b3c4d-0000-4000-8000-000000000000"), "1a2b3c4d");
        assert_eq!(vault_tag("default"), "default");
    }

    #[test]
    fn prune_keeps_the_newest_and_touches_nothing_else() {
        let dir = scratch();
        let tag = "1a2b3c4d";
        for date in ["2026-09-01", "2026-10-05", "2025-12-31", "2026-10-06"] {
            std::fs::write(dir.join(file_name(tag, date)), "x").unwrap();
        }
        let others = [
            "emerald-backup-2020-01-01.vault.emerald".to_string(),
            file_name("ffffffff", "2020-01-01"),
            "notes.txt".to_string(),
        ];
        for name in &others {
            std::fs::write(dir.join(name), "keep").unwrap();
        }
        std::fs::create_dir_all(dir.join(file_name(tag, "2019-01-01"))).unwrap();

        assert_eq!(prune_in(&dir, tag, 2).unwrap(), 2);
        assert!(dir.join(file_name(tag, "2026-10-06")).is_file());
        assert!(dir.join(file_name(tag, "2026-10-05")).is_file());
        assert!(!dir.join(file_name(tag, "2026-09-01")).exists());
        assert!(!dir.join(file_name(tag, "2025-12-31")).exists());
        for name in &others {
            assert!(dir.join(name).is_file(), "{name}");
        }
        assert!(dir.join(file_name(tag, "2019-01-01")).is_dir());

        // Never everything: even `0` leaves the newest one.
        assert_eq!(prune_in(&dir, tag, 0).unwrap(), 1);
        assert!(dir.join(file_name(tag, "2026-10-06")).is_file());
        assert_eq!(prune_in(&dir.join("missing"), tag, 3).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn due_follows_the_interval() {
        let state = |interval, weekday| State { interval, weekday, ..State::default() };
        // 2026-11-19 is a Thursday.
        let today = day("2026-11-19");
        assert!(is_due(&state(Interval::Daily, 1), None, today));
        assert!(is_due(&state(Interval::Daily, 1), Some("2026-11-18"), today));
        assert!(!is_due(&state(Interval::Daily, 1), Some("2026-11-19"), today));
        // Weekly on Monday: the last Monday was the 16th.
        assert!(!is_due(&state(Interval::Weekly, 1), Some("2026-11-16"), today));
        assert!(is_due(&state(Interval::Weekly, 1), Some("2026-11-15"), today));
        // Weekly on Thursday: today.
        assert!(is_due(&state(Interval::Weekly, 4), Some("2026-11-18"), today));
        // Monthly: since the first.
        assert!(!is_due(&state(Interval::Monthly, 1), Some("2026-11-01"), today));
        assert!(is_due(&state(Interval::Monthly, 1), Some("2026-10-31"), today));
    }

    #[test]
    fn a_hand_written_state_is_made_sane() {
        let state: State = serde_json::from_str(
            r#"{"vaults":["ok-1","../x","ok-1"],"interval":"daily","weekday":9,"keep":1,"dir":"relative"}"#,
        )
        .unwrap();
        let state = state.sane();
        assert_eq!(state.vaults, vec!["ok-1".to_string()]);
        assert_eq!(state.weekday, 1);
        assert_eq!(state.keep, Some(10));
        assert_eq!(state.dir, None);
        // The old shape (a folder per vault) reads as nothing chosen.
        let old: State = serde_json::from_str(r#"{"dirs":{"a":"C:\\x"}}"#).unwrap();
        assert_eq!(old, State::default());
    }

    #[test]
    fn without_a_picked_folder_the_vaults_own_backups_folder_is_the_target() {
        let vault_dir = scratch();
        let own = target(&vault_dir, None);
        assert_eq!(own.dir, vault_dir.join("backups"));
        assert!(!own.missing);
        let gone = target(&vault_dir, Some(&vault_dir.join("gone").to_string_lossy()));
        assert!(gone.missing);
        assert!(target(&vault_dir, Some("relative")).missing);
    }
}
