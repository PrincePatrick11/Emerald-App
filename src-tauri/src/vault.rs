//! Vault storage layout.
//!
//! A vault is a directory the user picked. Inside it live `emerald.db` and an
//! `images/` folder — nothing else. `vaults.json` in the app data directory
//! maps vault ids to those directories; the frontend owns that file and
//! mirrors it into [`VaultRegistry`] on every write.
//!
//! Commands never take a destination path. A path arriving over IPC, or read
//! out of stored HTML content, is not evidence that the user authorised it —
//! only a registered vault id is. That is what lets a vault live outside the
//! usual home/documents roots: storage here resolves an id, never a path.
//!
//! `resolve_allowed_roots` in `lib.rs` deliberately does *not* extend the same
//! trust to the registered directories — it is the boundary for reading and
//! writing *documents*, and the registry is filled by an ordinary frontend
//! command. The two never meet.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub const DB_FILE: &str = "emerald.db";
pub const IMAGES_SUBDIR: &str = "images";
/// Where a vault migrated from the pre-0.2.1 layout lives: `{appDataDir}/vaults/`.
pub const VAULTS_SUBDIR: &str = "vaults";
/// The folder new vaults are offered in, inside the user's documents directory.
pub const VAULT_HOME_DIR: &str = "Emerald";

/// `vault id → absolute directory`, mirrored from `vaults.json`.
#[derive(Default)]
pub struct VaultRegistry(Mutex<HashMap<String, PathBuf>>);

#[derive(serde::Deserialize)]
pub struct VaultEntry {
    pub id: String,
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct VaultProbe {
    pub exists: bool,
    /// The directory is there, but this process may not look inside it. On
    /// macOS that is the normal answer for `~/Documents`, `~/Desktop` and
    /// iCloud until the user grants access — the app is not sandboxed, so
    /// picking the folder in a dialog grants nothing by itself.
    pub denied: bool,
    pub has_db: bool,
    pub is_empty: bool,
}

/// Marker in the error string for the same case, so the UI can say "no access"
/// instead of "not found" — the folder is right where the user left it.
pub const ACCESS_DENIED: &str = "VAULT_ACCESS_DENIED";

/// Tells "not there" apart from "not allowed". `is_dir()` collapses the two.
fn directory_state(dir: &Path) -> Result<(), String> {
    match std::fs::metadata(dir) {
        Ok(md) if md.is_dir() => Ok(()),
        Ok(_) => Err(format!("not a directory: {}", dir.display())),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            Err(format!("{ACCESS_DENIED}: {}", dir.display()))
        }
        Err(_) => Err(format!("vault directory not found: {}", dir.display())),
    }
}

/// Ids are `crypto.randomUUID()` output plus the literal `default`. Anything
/// outside that alphabet is refused before it can become a path segment.
fn is_valid_vault_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Legacy database filenames are `emerald.db` and `emerald-{uuid}.db`. The
/// check exists so the name can never carry a separator into a join.
fn is_valid_legacy_db_name(name: &str) -> bool {
    match name.strip_suffix(".db") {
        Some(stem) => {
            !stem.is_empty()
                && stem.len() <= 64
                && stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        }
        None => false,
    }
}

/// Resolves a vault id against the registered list. The only way to obtain a
/// vault directory.
pub fn vault_dir(app: &tauri::AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    if !is_valid_vault_id(vault_id) {
        return Err("invalid vault id".to_string());
    }
    let state = app.state::<VaultRegistry>();
    let map = state
        .0
        .lock()
        .map_err(|_| "vault registry unavailable".to_string())?;
    map.get(vault_id)
        .cloned()
        .ok_or_else(|| format!("unknown vault: {vault_id}"))
}

/// The vault's image folder.
///
/// Creates the `images/` folder if it is missing, but **not** the vault
/// directory above it — `create_dir_all` on the full path would silently
/// resurrect a vault whose folder is gone, and every image written afterwards
/// would land in a directory the database no longer lives in. Only
/// [`create_vault_dirs`] builds a vault directory, and only when that is the
/// point.
pub fn images_dir(app: &tauri::AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    let vault = vault_dir(app, vault_id)?;
    directory_state(&vault)?;
    let dir = vault.join(IMAGES_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The shared image pool every vault wrote into before the per-vault layout.
/// Read-only from here on: migration v35 copies out of it, nothing copies in.
pub fn legacy_images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(IMAGES_SUBDIR))
}

/// Where a vault lives when the user did not choose a location.
fn default_dir_for(app: &tauri::AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    if !is_valid_vault_id(vault_id) {
        return Err("invalid vault id".to_string());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(VAULTS_SUBDIR)
        .join(vault_id))
}

/// Moves a file, falling back to copy+delete when `rename` cannot cross a
/// filesystem boundary.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("copy {}: {e}", from.display()))?;
    std::fs::remove_file(from).map_err(|e| format!("remove {}: {e}", from.display()))
}

// ── commands ─────────────────────────────────────────────────────────────────

/// Mirrors `vaults.json` into process state. Called after every write to that
/// file, and once at startup before the first database is opened.
#[tauri::command]
pub fn register_vaults(app: tauri::AppHandle, vaults: Vec<VaultEntry>) -> Result<(), String> {
    let state = app.state::<VaultRegistry>();
    let mut map = state
        .0
        .lock()
        .map_err(|_| "vault registry unavailable".to_string())?;
    map.clear();
    for entry in vaults {
        let path = PathBuf::from(&entry.path);
        // Ein relativer Pfad wuerde gegen das Arbeitsverzeichnis des Prozesses
        // aufgeloest — auch ein handgeschriebenes `~`, das hier niemand
        // expandiert. Ein Vault-Pfad ist immer absolut.
        if !is_valid_vault_id(&entry.id) || !path.is_absolute() {
            continue;
        }
        map.insert(entry.id, path);
    }
    Ok(())
}

/// Creates a new vault's directory tree. Called once, when the vault enters
/// `vaults.json` — not on every open. The only place that builds a vault
/// directory; see [`images_dir`] and [`ensure_vault_dirs`] for why.
#[tauri::command]
pub fn create_vault_dirs(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    std::fs::create_dir_all(dir.join(IMAGES_SUBDIR)).map_err(|e| e.to_string())
}

/// Checks a vault's directory before its database is opened, and makes sure the
/// `images/` folder inside it exists.
///
/// Fails when the vault directory is gone rather than recreating it: SQLite
/// would happily make a fresh, empty database in a resurrected folder, so a
/// vault on an unplugged drive would come back as an empty vault instead of an
/// error. That rule lives in [`images_dir`], so it holds for every command that
/// touches vault storage and not just for this one.
#[tauri::command]
pub fn ensure_vault_dirs(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    images_dir(&app, &vault_id).map(|_| ())
}

/// The default location for a vault the user did not place themselves.
#[tauri::command]
pub fn default_vault_dir(app: tauri::AppHandle, vault_id: String) -> Result<String, String> {
    Ok(default_dir_for(&app, &vault_id)?
        .to_string_lossy()
        .into_owned())
}

/// The folder new vaults are offered in: `{documentDir}/Emerald`.
///
/// Deliberately not [`default_dir_for`]. That one is the *migration* target and
/// has to keep pointing at `{appDataDir}/vaults/{id}` for every installation
/// with the move still ahead of it — moving it would strand their database.
///
/// Falls back to that same app directory where the platform exposes no
/// documents folder, so there is always somewhere to offer.
#[tauri::command]
pub fn new_vault_base_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = match app.path().document_dir() {
        Ok(documents) => documents.join(VAULT_HOME_DIR),
        Err(_) => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(VAULTS_SUBDIR),
    };
    Ok(base.to_string_lossy().into_owned())
}

/// Whether this installation already holds a database from before `vaults.json`
/// existed, or from a first run that was cut short after the layout migration.
///
/// Answers one question for the frontend: is a missing `vaults.json` a genuine
/// first start, or an installation whose journal is sitting right there? Getting
/// that wrong the wrong way puts a user with data on disk through onboarding.
///
/// Deliberately `is_file()` and not [`probe_vault_dir`]: that one lists the
/// directory, and a refused listing reports `has_db: false` — indistinguishable
/// from "there is nothing here". Statting a single file needs no listing.
///
/// The two legacy locations are not the same directory on every platform — see
/// [`migrate_vault_layout`] — so both are searched. Only `emerald.db` matters:
/// the flat `emerald-{uuid}.db` files of other legacy vaults were only ever
/// addressable through `vaults.json`, so without it they are unreachable anyway.
#[tauri::command]
pub fn legacy_default_db_exists(app: tauri::AppHandle) -> Result<bool, String> {
    let legacy = [
        app.path().app_config_dir().ok(),
        app.path().app_data_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .map(|dir| dir.join(DB_FILE));

    let adopted = default_dir_for(&app, "default")?.join(DB_FILE);

    Ok(legacy.chain(std::iter::once(adopted)).any(|db| db.is_file()))
}

/// Reports what a directory chosen in the folder dialog contains, so the UI
/// can tell "create a vault here" from "open the one already here".
#[tauri::command]
pub fn probe_vault_dir(path: String) -> Result<VaultProbe, String> {
    let dir = PathBuf::from(&path);
    let denied = VaultProbe { exists: true, denied: true, has_db: false, is_empty: false };
    let gone = VaultProbe { exists: false, denied: false, has_db: false, is_empty: true };

    match directory_state(&dir) {
        Ok(()) => {}
        Err(e) if e.starts_with(ACCESS_DENIED) => return Ok(denied),
        Err(_) => return Ok(gone),
    }

    // Statting the directory can succeed while listing it is refused — on
    // macOS that is exactly what a TCC-protected folder looks like.
    let mut entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return Ok(denied),
        Err(e) => return Err(e.to_string()),
    };

    Ok(VaultProbe {
        exists: true,
        denied: false,
        has_db: dir.join(DB_FILE).is_file(),
        is_empty: entries.next().is_none(),
    })
}

/// Moves a pre-0.2.1 vault into its own directory and returns that directory.
///
/// This cannot be a SQL migration — the database file itself is what moves, and
/// it moves before anything opens it. Idempotent: a vault whose target already
/// holds an `emerald.db` is left alone.
///
/// The two legacy locations are **not** the same directory on every platform.
/// `tauri-plugin-sql` joins its connection string onto `app_config_dir`, while
/// the shared image pool was written to `app_data_dir`. Windows and macOS
/// resolve both to one folder; on Linux they are `~/.config/…` and
/// `~/.local/share/…`, and looking in only one of them finds nothing.
#[tauri::command]
pub fn migrate_vault_layout(
    app: tauri::AppHandle,
    vault_id: String,
    legacy_db_name: String,
) -> Result<String, String> {
    if !is_valid_legacy_db_name(&legacy_db_name) {
        return Err("invalid database filename".to_string());
    }

    let target_dir = default_dir_for(&app, &vault_id)?;
    std::fs::create_dir_all(target_dir.join(IMAGES_SUBDIR)).map_err(|e| e.to_string())?;

    let target_db = target_dir.join(DB_FILE);
    if target_db.exists() {
        return Ok(target_dir.to_string_lossy().into_owned());
    }

    let legacy_db = [
        app.path().app_config_dir().ok(),
        app.path().app_data_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .map(|dir| dir.join(&legacy_db_name))
    .find(|candidate| candidate.is_file());

    // No legacy file means a vault that was registered but never opened. An
    // empty directory is the correct outcome; the first getDb() fills it.
    if let Some(source) = legacy_db {
        move_file(&source, &target_db)?;
        // journal_mode = DELETE leaves no sidecar behind on a clean close, but
        // an unclean shutdown does. Leaving it next to a moved database would
        // strand a rollback the database can no longer find.
        let journal = source.with_file_name(format!("{legacy_db_name}-journal"));
        if journal.is_file() {
            move_file(&journal, &target_dir.join(format!("{DB_FILE}-journal")))?;
        }
    }

    Ok(target_dir.to_string_lossy().into_owned())
}

/// Marker in the error string, so the UI can tell "there was something else in
/// that folder" apart from every other failure without parsing prose.
pub const DIR_NOT_EMPTY: &str = "VAULT_DIR_NOT_EMPTY";

/// Deletes a vault's files. Only ever reached through the vault modal's opt-in
/// "delete files" checkbox.
///
/// Deliberately **not** `remove_dir_all`. A vault directory is one the user
/// picked, and the app puts `emerald.db` into whatever they picked — so "it
/// contains a database" proves nothing about the rest of the folder. Someone
/// who created a vault straight in their Documents folder would have lost
/// Documents.
///
/// So only this vault's own artefacts are removed by name, and the two
/// directories go with plain `remove_dir`, which fails while anything else is
/// still in them. A folder with a stranger's file in it survives and reports
/// [`DIR_NOT_EMPTY`] instead of being erased.
#[tauri::command]
pub fn delete_vault_files(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    if !dir.join(DB_FILE).is_file() {
        return Err("not a vault directory: no database found".to_string());
    }

    // Erst zaehlen, dann loeschen. `remove_dir` weiter unten ist die Sperre
    // gegen fremde Dateien, aber es laeuft zuletzt — ohne diesen Vorlauf waeren
    // Datenbank und Bilder bereits weg, wenn es scheitert. Der Vault bliebe
    // dabei in `vaults.json` stehen (der Aufrufer schreibt die Datei erst nach
    // einem erfolgreichen Lauf), sein Ordner existierte noch, und das naechste
    // `getDb()` legte darin eine frische, leere Datenbank an. Aus einem
    // `desktop.ini` oder `.DS_Store` — in `~/Documents` die Regel, nicht die
    // Ausnahme — wuerde so ein stiller Totalverlust.
    let foreign = |entry: &std::fs::DirEntry, allowed: &dyn Fn(&str) -> bool| {
        !allowed(&entry.file_name().to_string_lossy())
    };
    let journal = format!("{DB_FILE}-journal");
    let owned_at_top =
        |name: &str| name == DB_FILE || name == journal || name == IMAGES_SUBDIR;

    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if foreign(&entry, &owned_at_top) {
            return Err(DIR_NOT_EMPTY.to_string());
        }
    }
    let images = dir.join(IMAGES_SUBDIR);
    if images.is_dir() {
        for entry in std::fs::read_dir(&images).map_err(|e| e.to_string())?.flatten() {
            if foreign(&entry, &crate::images::is_valid_image_name) {
                return Err(DIR_NOT_EMPTY.to_string());
            }
        }
    }

    // Ab hier gehoert alles im Ordner diesem Vault. Die Datenbank zuerst: sie
    // ist das einzige Stueck, das noch gesperrt sein kann, und ein Fehlschlag
    // laesst dann wenigstens die Bilder stehen.
    for name in [DB_FILE, &journal] {
        let file = dir.join(name);
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|e| format!("remove {}: {e}", file.display()))?;
        }
    }

    let images = dir.join(IMAGES_SUBDIR);
    if images.is_dir() {
        for entry in std::fs::read_dir(&images).map_err(|e| e.to_string())?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if crate::images::is_valid_image_name(&name) {
                std::fs::remove_file(entry.path()).ok();
            }
        }
        std::fs::remove_dir(&images).map_err(|_| DIR_NOT_EMPTY.to_string())?;
    }

    std::fs::remove_dir(&dir).map_err(|_| DIR_NOT_EMPTY.to_string())
}
