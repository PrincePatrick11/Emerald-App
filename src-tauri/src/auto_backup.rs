//! Automatic backups.
//!
//! The frontend decides *when* a backup is due and builds its content; where
//! it goes is decided here. No command in this module takes a path: the target
//! is either the vault's own `backup/` folder or a folder the user picked in a
//! dialog that this module opens itself, and the file name is built here too.
//!
//! That is what allows the one deliberate step outside
//! `resolve_allowed_roots`: a picked folder may lie anywhere — another drive,
//! a USB disk, a share — because the only way to name it is the native dialog.
//! A frontend that could pass the folder would be handing itself the boundary.
//! What can be written there is a sealed `.emeralddb` under a fixed name, and
//! what can be deleted there is exactly this vault's own automatic backups.
//!
//! The picked folder belongs to the installation, not to the vault: it lives
//! in `{appDataDir}/auto-backup.json` and not in the vault's `settings.json`,
//! which travels in backups and could bring a foreign path along.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::vault;

const STATE_FILE: &str = "auto-backup.json";
const STATE_TEMP_FILE: &str = "auto-backup.json.tmp";
const NAME_PREFIX: &str = "emerald-auto-";
const NAME_SUFFIX: &str = ".emeralddb";
/// How much of the vault id goes into the file name — enough to keep two
/// vaults sharing one folder apart.
const TAG_LEN: usize = 8;

/// The picked folder is not there right now — an unplugged disk, most likely.
const DIR_MISSING: &str = "AUTO_BACKUP_DIR_MISSING";

/// What the settings page offers for "keep" — mirrors `BACKUP_KEEP_OPTIONS` in
/// `src/lib/vaultSettings.ts`, without its `null` (= all); change both
/// together. Checked here as well: a caller that could pass `1` would wipe the
/// history with a single call.
const KEEP_CHOICES: [u32; 4] = [3, 5, 10, 30];

/// Serialises read-modify-write of [`STATE_FILE`].
static STATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Serialize, Deserialize)]
struct State {
    /// `vault id → picked folder`. A vault without an entry backs up into its
    /// own `backup/` folder.
    #[serde(default)]
    dirs: HashMap<String, String>,
}

fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no app data dir: {e}"))
}

/// A missing or broken file means: no folder picked.
fn load_state(app: &tauri::AppHandle) -> State {
    state_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(STATE_FILE)).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn update_state(app: &tauri::AppHandle, change: impl FnOnce(&mut State)) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().map_err(|_| "auto backup state unavailable".to_string())?;
    let mut state = load_state(app);
    change(&mut state);
    let dir = state_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir failed: {e}"))?;
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    vault::write_atomic(&dir, STATE_FILE, STATE_TEMP_FILE, &json)
}

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
/// every other name, including another vault's and a manual `emerald-backup-…`.
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
    // Nie alle: das eben geschriebene bleibt, was auch immer ankommt.
    let surplus = found.len().saturating_sub(keep.max(1) as usize);
    for (_, path) in &found[..surplus] {
        std::fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(surplus as u32)
}

fn write_in(dir: &Path, tag: &str, date: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if !is_date(date) {
        return Err("invalid backup date".to_string());
    }
    let name = file_name(tag, date);
    vault::write_atomic_anywhere(dir, &name, &format!("{name}.tmp"), bytes)?;
    Ok(dir.join(name))
}

struct Target {
    /// The picked folder, if there is one — also when it is missing.
    custom: Option<String>,
    dir: PathBuf,
    missing: bool,
}

/// Where this vault's automatic backups go. The vault's own `backup/` folder
/// is created on demand, like `ensure_backup_dir` does — but for a vault
/// anywhere: the path comes from the registry plus a fixed name, the same
/// class of access as the database next to it. A picked folder is never
/// created: one that is gone is reported, not silently replaced by an empty
/// folder on whatever now answers to that path.
fn target(app: &tauri::AppHandle, vault_id: &str) -> Result<Target, String> {
    let vault_dir = vault::vault_dir(app, vault_id)?;
    if let Some(custom) = load_state(app).dirs.get(vault_id).cloned() {
        let dir = PathBuf::from(&custom);
        // Der Dialog liefert nur absolute Pfade; alles andere stand nicht von hier in der Datei.
        let missing = !dir.is_absolute() || !dir.is_dir();
        return Ok(Target { custom: Some(custom), dir, missing });
    }
    vault::directory_state(&vault_dir)?;
    let dir = vault_dir.join(vault::BACKUP_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(Target { custom: None, dir, missing: false })
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupStatus {
    /// The folder the user picked; `None` while the vault's own is used.
    custom_dir: Option<String>,
    /// Where the backups go.
    dir: String,
    /// The picked folder is not reachable right now.
    missing: bool,
    /// The day of the newest automatic backup of this vault in `dir`.
    newest: Option<String>,
    /// The local day — the same clock the next file name comes from.
    today: String,
}

/// On the blocking pool: the folder may be a share that takes its time to
/// answer, or never does.
#[tauri::command]
pub async fn auto_backup_status(app: tauri::AppHandle, vault_id: String) -> Result<AutoBackupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = target(&app, &vault_id)?;
        let newest = if target.missing {
            None
        } else {
            own_backups(&target.dir, vault_tag(&vault_id))?.pop().map(|(date, _)| date)
        };
        Ok(AutoBackupStatus {
            custom_dir: target.custom,
            dir: target.dir.to_string_lossy().into_owned(),
            missing: target.missing,
            newest,
            today: today(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the folder dialog and remembers the choice for this vault. `None`
/// when the dialog was cancelled. The dialog is opened here and not in the
/// frontend so that the path never crosses IPC as an argument.
#[tauri::command]
pub async fn pick_auto_backup_dir(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    vault_id: String,
) -> Result<Option<String>, String> {
    // Nur eine registrierte Vault-Id bekommt einen Ordner.
    vault::vault_dir(&app, &vault_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().set_parent(&window).blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = picked.into_path().map_err(|e| e.to_string())?;
        if !dir.is_absolute() || !dir.is_dir() {
            return Err(DIR_MISSING.to_string());
        }
        // Ein Name, der kein UTF-8 ist, käme verlustbehaftet in die Datei und
        // passte danach nie wieder auf den Ordner.
        let path = dir.to_str().ok_or("folder name is not valid UTF-8")?.to_string();
        update_state(&app, |state| {
            state.dirs.insert(vault_id, path.clone());
        })?;
        Ok(Some(path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Back to the vault's own `backup/` folder.
#[tauri::command(async)]
pub fn reset_auto_backup_dir(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    // Nur die Form der Id, nicht die Registry: ein Vault wird erst entfernt und
    // dann hier vergessen — andersherum stünde er nach einem gescheiterten
    // Entfernen ohne seinen Ordner da. Einen Eintrag zu streichen, den es nicht
    // gibt, ändert nichts.
    if !vault::is_valid_vault_id(&vault_id) {
        return Err("invalid vault id".to_string());
    }
    update_state(&app, |state| {
        state.dirs.remove(&vault_id);
    })
}

/// Writes today's automatic backup of the vault — `content` is its JSON
/// export, sealed like every backup — and then removes the oldest ones beyond
/// `keep` (`None` keeps all). One file per day: a second run replaces it.
#[tauri::command]
pub async fn write_auto_backup(
    app: tauri::AppHandle,
    vault_id: String,
    content: String,
    keep: Option<u32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if keep.is_some_and(|keep| !KEEP_CHOICES.contains(&keep)) {
            return Err("invalid keep count".to_string());
        }
        let sealed = crate::backup::seal_for_vault(&app, &vault_id, &content)?;
        let target = target(&app, &vault_id)?;
        if target.missing {
            return Err(DIR_MISSING.to_string());
        }
        let tag = vault_tag(&vault_id);
        write_in(&target.dir, tag, &today(), &sealed)?;
        // Das Backup steht. Scheitert das Aufräumen, ist das kein gescheitertes Backup.
        if let Some(keep) = keep {
            if let Err(e) = prune_in(&target.dir, tag, keep) {
                eprintln!("[auto-backup] prune failed: {e}");
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
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

    #[test]
    fn only_this_vaults_automatic_backups_are_recognised() {
        assert_eq!(backup_date("emerald-auto-1a2b3c4d-2026-10-06.emeralddb", "1a2b3c4d"), Some("2026-10-06"));
        assert_eq!(backup_date(&file_name("default", "2026-01-31"), "default"), Some("2026-01-31"));
        for name in [
            "emerald-backup-2026-10-06.emeralddb",
            "emerald-auto-ffffffff-2026-10-06.emeralddb",
            "emerald-auto-1a2b3c4d-2026-10-06.emeralddb.tmp",
            "emerald-auto-1a2b3c4d-2026-10-6.emeralddb",
            "emerald-auto-1a2b3c4d-2026-10-06-copy.emeralddb",
            "emerald-auto-1a2b3c4d-.emeralddb",
            "emerald-auto-1a2b3c4d2026-10-06.emeralddb",
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
            write_in(&dir, tag, date, b"x").unwrap();
        }
        let others = [
            "emerald-backup-2020-01-01.emeralddb".to_string(),
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

        // Nie alles: auch `0` lässt das jüngste stehen.
        assert_eq!(prune_in(&dir, tag, 0).unwrap(), 1);
        assert!(dir.join(file_name(tag, "2026-10-06")).is_file());
        assert_eq!(prune_in(&dir.join("missing"), tag, 3).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_backup_on_the_same_day_replaces_the_first() {
        let dir = scratch();
        write_in(&dir, "default", "2026-10-06", b"first").unwrap();
        let path = write_in(&dir, "default", "2026-10-06", b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        assert_eq!(own_backups(&dir, "default").unwrap().len(), 1);
        assert!(!dir.join(format!("{}.tmp", file_name("default", "2026-10-06"))).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_date_that_is_not_one_is_refused() {
        let dir = scratch();
        for date in ["", "2026-10-6", "2026/10/06", "../../x", "2026-10-06x"] {
            assert!(write_in(&dir, "default", date, b"x").is_err(), "{date}");
        }
        assert!(std::fs::read_dir(&dir).unwrap().next().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
