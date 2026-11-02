//! Vault storage layout.
//!
//! A vault is a directory the user picked. Inside it live `emerald.db`, an
//! `images/` folder, a `backup/` folder, and `settings.json`.
//! `vaults.json` in the app data directory
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
/// The copy a backup import fills before it swaps it in, next to [`DB_FILE`].
pub const IMPORT_STAGING_FILE: &str = "emerald.db.import";
pub const IMAGES_SUBDIR: &str = "images";
/// Where a vault migrated from the pre-0.2.1 layout lives: `{appDataDir}/vaults/`.
pub const VAULTS_SUBDIR: &str = "vaults";
/// The folder new vaults are offered in, inside the user's documents directory.
pub const VAULT_HOME_DIR: &str = "Emerald Vaults";
/// Where the database export offers to write its `.emeralddb`, inside the vault.
pub const BACKUP_SUBDIR: &str = "backup";
/// The vault's own settings. The frontend owns its shape; Rust only moves the text.
pub const SETTINGS_FILE: &str = "settings.json";
/// Written first and renamed over [`SETTINGS_FILE`], so a crash mid-write
/// leaves the previous settings rather than half a file.
const SETTINGS_TEMP_FILE: &str = "settings.json.tmp";
/// Far above anything the settings page can produce — a guard against a
/// runaway write, not a format limit.
const SETTINGS_MAX_BYTES: u64 = 256 * 1024;
/// The unsaved drafts of the vault's block and template pages, written along
/// while they are being edited so that a crash takes nothing that was typed.
/// The frontend owns the shape; Rust only moves the text.
pub const DRAFTS_FILE: &str = "drafts.json";
/// Written first and renamed over [`DRAFTS_FILE`], like the settings.
const DRAFTS_TEMP_FILE: &str = "drafts.json.tmp";
/// A template's content is block HTML and can grow — still a guard against a
/// runaway write, not a format limit.
const DRAFTS_MAX_BYTES: u64 = 4 * 1024 * 1024;
/// The registry the frontend owns, in the app data directory.
const VAULTS_FILE: &str = "vaults.json";

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
pub(crate) fn directory_state(dir: &Path) -> Result<(), String> {
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
pub(crate) fn is_valid_vault_id(id: &str) -> bool {
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

// ── Taking over data from the previous identifier's directory ────────────────

/// The identifier before 0.2.1.
///
/// Frozen history, not a configuration value: the ten releases up to v0.1.3.6
/// ran under this name, and that is what their directories are still called.
/// Should the identifier ever change again, a further stage is added — this
/// value stays what it is.
const PREVIOUS_IDENTIFIER: &str = "com.emerald.magical-journal";

/// As deep as anything can ever lie here (`vaults/{id}/images/`), with
/// plenty of room. The limit is not a matter of taste but the floor under the
/// recursion: a stack overflow is an `abort` and not an `Err` that
/// [`adopt_previous_identifier_dirs`] could catch.
const MAX_COPY_DEPTH: u32 = 16;

/// The directory that would correspond to the same installation under the
/// previous identifier.
///
/// Derived from the name of the current one and not from a second constant:
/// that way the current identifier appears nowhere here, and the next change
/// does not touch this line. The `.dev` of the dev build travels along, so
/// that it does not draw from the production folder.
fn previous_dir(current: &Path) -> Option<PathBuf> {
    let name = current.file_name()?.to_str()?;
    let suffix = if name.ends_with(".dev") { ".dev" } else { "" };
    Some(current.with_file_name(format!("{PREVIOUS_IDENTIFIER}{suffix}")))
}

/// What is taken over from the old installation at all, recognised by name.
///
/// A list and not "everything that lies there", because this directory holds
/// more than our data. On Linux `app_data_dir` is also the webview profile:
/// `dirs::data_local_dir()` is the same function there as `data_dir()`, and
/// Tauri creates the profile under `LocalData/{identifier}`. The old folder
/// there therefore also contains cookies and the `localStorage` of the old
/// installation — they have no business in the new one's profile, least of all
/// while WebKitGTK holds it open.
///
/// The same list answers the question whether a takeover has already happened
/// here. If another artefact of our own is added, it belongs here.
fn is_own_data(name: &str) -> bool {
    name == VAULTS_FILE
        || name == IMAGES_SUBDIR
        || name == VAULTS_SUBDIR
        // `emerald.db`, the flat `emerald-{uuid}.db` of the old layout, their
        // `-journal` companions and the `.pre-vNN.bak` backups.
        || name.starts_with("emerald")
}

/// Whether nothing of ours lies in `dir` yet.
///
/// Deliberately not "the directory is empty". On Linux Tauri creates it before
/// the first window exists, and WebKitGTK writes into it; on Windows and macOS
/// `desktop.ini` and `.DS_Store` can show up in it. An empty folder would thus
/// be the wrong question — the right one is whether an earlier takeover or a
/// start of the new version has already left something here.
fn holds_no_data_yet(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(entries) => !entries
            .flatten()
            .any(|e| e.file_name().to_str().is_some_and(is_own_data)),
        // `read_dir` throws the same error for "does not exist" and "not
        // allowed", `metadata` tells them apart. Not there means free; anything else
        // means: touch nothing.
        Err(_) => matches!(
            std::fs::metadata(dir),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound
        ),
    }
}

/// Clears away a path, whether file or directory. If it does not exist,
/// there is nothing to do.
fn clear(path: &Path) -> Result<(), String> {
    let removed = match std::fs::symlink_metadata(path) {
        Ok(md) if md.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(_) => return Ok(()),
    };
    removed.map_err(|e| format!("clear {}: {e}", path.display()))
}

/// Copies a directory tree. Symlinks are left alone: there is none here,
/// and following one would mean copying from a directory the app knows
/// nothing about.
fn copy_dir(from: &Path, to: &Path, depth: u32) -> Result<(), String> {
    if depth > MAX_COPY_DEPTH {
        return Err(format!("too deep at {}", from.display()));
    }
    std::fs::create_dir_all(to).map_err(|e| format!("create {}: {e}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        // `file_type` does not resolve symlinks, so they are neither one nor the
        // other here and fall through.
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &target, depth + 1)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), &target)
                .map_err(|e| format!("copy {}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

/// Places `source` under `target` without it ever standing there half done:
/// it is written alongside, and only the final `rename` — in the same
/// directory, so a name swap and not a copy — makes it visible.
///
/// Everything else rests on this. A half-copied `emerald.db` under its right
/// name would look like a successful takeover at the next start and would
/// never be repeated.
fn place_atomically(source: &Path, target: &Path) -> Result<(), String> {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("unnamed target {}", target.display()))?;
    let staging = target.with_file_name(format!("{name}.adopting"));
    clear(&staging)?;

    let staged = if source.is_dir() {
        copy_dir(source, &staging, 0)
    } else {
        std::fs::copy(source, &staging)
            .map(|_| ())
            .map_err(|e| format!("copy {}: {e}", source.display()))
    };
    let placed = staged.and_then(|()| {
        std::fs::rename(&staging, target).map_err(|e| format!("place {}: {e}", target.display()))
    });
    if placed.is_err() {
        let _ = clear(&staging);
    }
    placed
}

/// Moves the paths in the copied `vaults.json` from `old_root` to `new_root`.
///
/// The file stores an absolute directory per vault. For the usual ones — chosen
/// by the user, mostly under `Documents` — nothing changes as a result. A vault
/// migrated from the pre-0.2.1 layout, however, lives under
/// `{appDataDir}/vaults/{id}`, and so the old identifier is in its stored path.
/// If that stayed, the new version would keep reading and writing in the old
/// folder while the copy next to it silently went stale.
///
/// An unreadable file is not an error. It stays as it is, and that is the
/// better half of a bad choice: the old installation already faced the same
/// file, and a copy with an untouched registry can be fixed by hand — a failed
/// takeover, by contrast, looks like an empty journal.
fn retarget_registry(file: &Path, old_root: &Path, new_root: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(file).map_err(|e| format!("read {}: {e}", file.display()))?;
    let mut doc: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(doc) => doc,
        Err(e) => {
            eprintln!("[vault] {} kept as is, could not parse it: {e}", file.display());
            return Ok(());
        }
    };

    let Some(vaults) = doc.get_mut("vaults").and_then(|v| v.as_array_mut()) else {
        return Ok(());
    };
    let mut moved_any = false;
    for vault in vaults {
        let Some(path) = vault.get("path").and_then(|p| p.as_str()).map(PathBuf::from) else {
            continue;
        };
        if let Ok(rest) = path.strip_prefix(old_root) {
            // `strip_prefix` and `join` work purely lexically: a `..` in the stored
            // path would survive the rewrite and afterwards point out of the data
            // directory. Elsewhere that would not matter, here it does — this registry
            // comes from a folder the app does not manage, and `register_vaults` lets
            // every absolute path through. So only rewrite what consists exclusively of
            // ordinary names; everything else stays as it was, and the user notices it as
            // a missing vault instead of it silently pointing somewhere else.
            if !rest
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_)))
            {
                continue;
            }
            let moved = new_root.join(rest).to_string_lossy().into_owned();
            vault["path"] = serde_json::Value::String(moved);
            moved_any = true;
        }
    }

    // Nothing rewritten means: do not touch the file. Otherwise this function
    // would rewrite it just for the formatting — and the oldest version of the
    // registry that still exists does not know `path` at all, but `dbName` (see
    // `migrate_vault_layout`). It falls through here, and it should travel on
    // unchanged.
    if !moved_any {
        return Ok(());
    }

    // When rewriting, serde_json sorts an object's keys alphabetically.
    // Harmless — the file is read as JSON — but it explains why it looks
    // different afterwards than it did going in.
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| format!("write {}: {e}", file.display()))
}

/// Places the registry last — copy, rewrite, then make visible.
///
/// The order is the reason this function exists separately: if the file were
/// there first and the rewrite after, an abort in between would leave a
/// registry that points to the old folder and yet looks adopted.
fn place_registry(source: &Path, target: &Path, previous: &Path, current: &Path) -> Result<(), String> {
    let staging = target.with_file_name(format!("{VAULTS_FILE}.adopting"));
    clear(&staging)?;

    let placed = std::fs::copy(source, &staging)
        .map(|_| ())
        .map_err(|e| format!("copy {}: {e}", source.display()))
        .and_then(|()| retarget_registry(&staging, previous, current))
        .and_then(|()| {
            std::fs::rename(&staging, target)
                .map_err(|e| format!("place {}: {e}", target.display()))
        });
    if placed.is_err() {
        let _ = clear(&staging);
    }
    placed
}

/// Brings over every entry of our own and notes in `placed` what was
/// actually placed — the caller needs that for rolling back.
fn adopt_entries(previous: &Path, current: &Path, placed: &mut Vec<PathBuf>) -> Result<(), String> {
    std::fs::create_dir_all(current).map_err(|e| format!("create {}: {e}", current.display()))?;

    let mut registry = None;
    for entry in
        std::fs::read_dir(previous).map_err(|e| format!("read {}: {e}", previous.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !is_own_data(&name) {
            continue;
        }
        // The registry last, see `place_registry`.
        if name == VAULTS_FILE {
            registry = Some(entry.path());
            continue;
        }
        let target = current.join(&name);
        place_atomically(&entry.path(), &target)?;
        placed.push(target);
    }

    if let Some(source) = registry {
        let target = current.join(VAULTS_FILE);
        place_registry(&source, &target, previous, current)?;
        placed.push(target);
    }
    Ok(())
}

/// Adopts a directory if the predecessor's exists and nothing of ours lies
/// in our own yet.
///
/// **Copies, does not move.** `previous` is only read. The old installation
/// stays runnable and is the fallback.
///
/// **All or nothing.** Every single entry is created next to its place and
/// made visible by `rename`; if one fails, what this run placed is rolled
/// back. Afterwards nothing of ours lies here again, and the next start tries
/// again. The rollback is safe because the check above guarantees that nothing
/// of ours lay here before this run.
///
/// **Only our own data**, see [`is_own_data`] — on Linux the old folder is also
/// the old installation's webview profile.
fn adopt_into(current: &Path) -> Result<(), String> {
    let Some(previous) = previous_dir(current) else {
        return Ok(());
    };
    // `symlink_metadata` and not `is_dir()`: that would follow a symlink, and
    // the root folder is the only one that `copy_dir` does not skip itself. If it
    // pointed to an ancestor of the target folder, the intermediate folder would
    // copy itself into itself. A link's metadata is never that of a directory, so
    // the condition catches both.
    if !std::fs::symlink_metadata(&previous).is_ok_and(|m| m.is_dir()) {
        return Ok(());
    }
    if !holds_no_data_yet(current) {
        return Ok(());
    }

    let mut placed = Vec::new();
    let outcome = adopt_entries(&previous, current, &mut placed);
    if outcome.is_err() {
        for target in placed.iter().rev() {
            let _ = clear(target);
        }
    }
    outcome
}

/// On the first start, takes over the data from the previous identifier's
/// directory.
///
/// Tauri derives `app_data_dir` and `app_config_dir` from the `identifier`.
/// With the switch to `com.emerald.app` the app therefore looks somewhere else
/// than every installation up to v0.1.3.6 — their `vaults.json` lies intact
/// next door, and without this step the new version would greet a long-time
/// user with an empty journal.
///
/// What is taken over and under which guarantees is documented at
/// [`adopt_into`]. What remains here is the outside:
///
/// **Does not abort the start.** A failed takeover is an empty journal next to
/// intact data and can be fixed by hand; a `?` at this point would be an app
/// that does not come up at all.
///
/// **Runs before there is a window** — as a plugin `setup`, see the call in
/// `lib.rs`. Copying thus blocks no window thread and nobody can look at a
/// frozen UI.
pub fn adopt_previous_identifier_dirs(app: &tauri::AppHandle) {
    // On Windows and macOS both are the same directory, on Linux not — see
    // `migrate_vault_layout`. Running twice would be harmless (the second pass
    // would no longer find the target free), but the error message would be one
    // too many. Deliberately `contains` and not `dedup`: that only removes
    // adjacent equals and would silently miss with a third entry.
    let mut dirs: Vec<PathBuf> = Vec::new();
    for dir in [
        app.path().app_data_dir().ok(),
        app.path().app_config_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }

    for current in dirs {
        if let Err(e) = adopt_into(&current) {
            eprintln!("[vault] could not adopt into {}: {e}", current.display());
        }
    }
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
    let previous = std::mem::take(&mut *map);
    for entry in vaults {
        let path = PathBuf::from(&entry.path);
        // A relative path would be resolved against the process's working
        // directory — also a hand-written `~`, which nobody expands here. A vault
        // path is always absolute.
        if !is_valid_vault_id(&entry.id) || !path.is_absolute() {
            continue;
        }
        map.insert(entry.id, path);
    }
    // A key in memory belongs to the folder in which it was unlocked. If the
    // id now points elsewhere (or no longer exists), it is forgotten — otherwise
    // images and drafts would be sealed in the new folder under a key that its
    // `vault.key` does not know.
    let vault_keys = app.state::<crate::keys::VaultKeys>();
    for (id, old_path) in &previous {
        if map.get(id) != Some(old_path) {
            vault_keys.remove(id);
        }
    }
    Ok(())
}

/// Creates a new vault's directory tree. Called once, when the vault enters
/// `vaults.json` — not on every open. The only place that builds a vault
/// directory; see [`images_dir`] and [`ensure_vault_dirs`] for why.
#[tauri::command]
pub fn create_vault_dirs(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    std::fs::create_dir_all(dir.join(IMAGES_SUBDIR)).map_err(|e| e.to_string())?;
    // `backup/` belongs from the start, not only from the first export — that
    // way the structure of a vault folder is always the same. For vaults outside
    // the allowed roots it stays empty without consequence (the export does not
    // offer it there, see `ensure_backup_dir`), and an empty `backup/` does not
    // stand in the way of deleting the folder.
    std::fs::create_dir_all(dir.join(BACKUP_SUBDIR)).map_err(|e| e.to_string())
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

/// The vault's `backup/` folder, created on demand — where the database
/// export dialog opens by default. Deliberately *inside* the vault: the backup
/// travels with the data it captures when the folder is copied elsewhere. And
/// deliberately not part of what [`delete_vault_files`] removes — a backup is
/// exactly the thing that should outlive the vault it was taken from.
#[tauri::command]
pub fn ensure_backup_dir(app: tauri::AppHandle, vault_id: String) -> Result<String, String> {
    let vault = vault_dir(&app, &vault_id)?;
    // As everywhere here: do not resurrect a vanished vault folder (see
    // `images_dir`), only create the subfolder in it.
    directory_state(&vault)?;

    // The dialog is only half the way: the file is then written by
    // `write_file`, and that is limited to the fixed roots (see
    // `resolve_allowed_roots` — vault directories deliberately do not extend
    // them). Offering a target for a vault outside — another drive, a folder
    // outside `~` — would mean offering one that the write command then refuses.
    // The `Err` ends up in the frontend's fallback (bare file name) before a dead
    // `backup/` folder is created.
    let allowed = crate::resolve_allowed_roots(&app)?;
    let canonical = std::fs::canonicalize(&vault).map_err(|e| e.to_string())?;
    if !crate::is_within_allowed_roots(&canonical, &allowed) {
        return Err("vault outside allowed storage roots".to_string());
    }
    // The same for the write command's second rule: in the app data folder it
    // only accepts `vaults/`. A vault lying next to it there would otherwise be
    // offered a target that is then refused.
    crate::check_app_data_write(&app, &canonical.join(BACKUP_SUBDIR))?;

    let dir = vault.join(BACKUP_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// The folder new vaults are offered in: `{documentDir}/Emerald Vaults`.
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

/// Database, drafts and images go; the folder and its settings stay. For a vault
/// that fetches itself anew from a sync server.
pub(crate) fn remove_vault_content(dir: &Path) -> Result<(), String> {
    let journal = format!("{DB_FILE}-journal");
    for name in [DB_FILE, journal.as_str(), DRAFTS_FILE] {
        let file = dir.join(name);
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|e| format!("remove {}: {e}", file.display()))?;
        }
    }
    if let Ok(entries) = std::fs::read_dir(dir.join(IMAGES_SUBDIR)) {
        for entry in entries.flatten() {
            if crate::images::is_valid_image_name(&entry.file_name().to_string_lossy()) {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }
    Ok(())
}

/// Deletes a vault's files — the database, its journal, its images and its
/// settings. Only ever reached through the vault modal's opt-in "delete files"
/// checkbox.
///
/// Deliberately **not** `remove_dir_all`. A vault directory is one the user
/// picked, and the app puts `emerald.db` into whatever they picked — so "it
/// contains a database" proves nothing about the rest of the folder. Someone
/// who created a vault straight in their Documents folder would have lost
/// Documents.
///
/// So only this vault's own artefacts are removed by name. Whatever else lies
/// there — the `backup/` folder of the database export, a `desktop.ini`, in
/// `~/Documents` the rule rather than the exception — stays, and with it the
/// directory: both directories go with plain `remove_dir`, which fails while
/// anything is left inside, and that failure is the answer here, not an error.
/// Returns whether the vault directory itself is gone, so the UI can say "the
/// folder stayed".
///
/// A half-deleted vault cannot come back as an empty one: the caller takes
/// it out of `vaults.json` after every `Ok`, and an `Err` only occurs while
/// the database is still there (deletion locked/refused).
#[tauri::command]
pub fn delete_vault_files(app: tauri::AppHandle, vault_id: String) -> Result<bool, String> {
    let dir = vault_dir(&app, &vault_id)?;
    if !dir.join(DB_FILE).is_file() {
        return Err("not a vault directory: no database found".to_string());
    }
    crate::sync::forget(&app, &vault_id);

    // The database first: it is the only piece that can still be locked, and
    // a failure then at least leaves the images in place.
    let journal = format!("{DB_FILE}-journal");
    for name in [DB_FILE, journal.as_str()] {
        let file = dir.join(name);
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|e| format!("remove {}: {e}", file.display()))?;
        }
    }

    // No more `?` from here: the database is already gone, and the caller only
    // takes the vault out of `vaults.json` after an `Ok`. An error from this
    // point on would leave the entry in place, and the next `getDb()` would put
    // a fresh, empty database into the folder — the state that the invariant
    // above rules out. What cannot be deleted simply stays, folder included.
    let images = dir.join(IMAGES_SUBDIR);
    if let Ok(entries) = std::fs::read_dir(&images) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if crate::images::is_valid_image_name(&name) {
                std::fs::remove_file(entry.path()).ok();
            }
        }
        std::fs::remove_dir(&images).ok();
    }

    for name in [SETTINGS_FILE, SETTINGS_TEMP_FILE, DRAFTS_FILE, DRAFTS_TEMP_FILE, crate::keys::KEY_FILE, crate::keys::KEY_TEMP_FILE] {
        std::fs::remove_file(dir.join(name)).ok();
    }
    // What is useless without the key: working copies, backups before
    // migrations, remains of an aborted re-encryption.
    for suffix in ["", "-journal", "-wal", "-shm"] {
        std::fs::remove_file(dir.join(format!("{IMPORT_STAGING_FILE}{suffix}"))).ok();
    }
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_str().and_then(migration_backup_version).is_some() {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }
    crate::reencrypt::remove_leftovers(&dir);
    // With the files gone the key is worthless — the remembered one too.
    crate::keys::discard(&app, &vault_id);

    // An *empty* `backup/` — the normal case without an export, since
    // `create_vault_dirs` creates it too — should not prevent the folder from
    // being removed. `remove_dir` fails as soon as a backup lies in it, and
    // exactly then both stay.
    std::fs::remove_dir(dir.join(BACKUP_SUBDIR)).ok();

    Ok(std::fs::remove_dir(&dir).is_ok())
}

/// What [`read_vault_settings`] and [`read_vault_drafts`] found.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum VaultFileRead {
    Missing,
    Found { contents: String },
    /// There is something, but not a file this app wrote: a link, a directory,
    /// an oversized or unreadable file. The frontend falls back to defaults and
    /// leaves it alone — a broken settings file must not lock the vault.
    Unreadable,
}

/// The vault's `settings.json`.
///
/// Fails only when the vault directory itself is gone — same rule as
/// [`images_dir`]: the caller is about to open that vault and must hear about
/// it before SQLite creates an empty database in a resurrected folder.
#[tauri::command]
pub fn read_vault_settings(app: tauri::AppHandle, vault_id: String) -> Result<VaultFileRead, String> {
    let dir = vault_dir(&app, &vault_id)?;
    directory_state(&dir)?;
    Ok(read_settings_in(&dir))
}

/// Replaces the vault's `settings.json` with `contents`.
///
/// Only well-formed JSON objects are written: the file is read back by every
/// build, and a stray string here would only ever be thrown away there.
/// `async`, like [`write_vault_drafts`]: a file held by a scanner or a sync
/// client is waited out ([`patiently`]), and not on the main thread.
#[tauri::command(async)]
pub fn write_vault_settings(app: tauri::AppHandle, vault_id: String, contents: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    directory_state(&dir)?;
    write_settings_in(&dir, &contents)
}

/// The vault's `drafts.json` — same answers as [`read_vault_settings`]. In an
/// encrypted vault the file is sealed; a plain one (written before the vault
/// was encrypted) is still read.
#[tauri::command(async)]
pub fn read_vault_drafts(app: tauri::AppHandle, vault_id: String) -> Result<VaultFileRead, String> {
    let dir = vault_dir(&app, &vault_id)?;
    directory_state(&dir)?;
    let key = drafts_key(&app, &vault_id)?;
    Ok(read_drafts_in(&dir, key.as_ref()))
}

/// The key `drafts.json` is sealed with, `None` in an unencrypted vault.
fn drafts_key(app: &tauri::AppHandle, vault_id: &str) -> Result<Option<crate::crypto::Key>, String> {
    Ok(crate::keys::key_for(app, vault_id)?.map(|key| crate::crypto::subkey(&key, crate::crypto::Purpose::Files)))
}

fn read_drafts_in(dir: &Path, key: Option<&crate::crypto::Key>) -> VaultFileRead {
    use crate::crypto::{self, Context};
    let Some(key) = key else {
        return read_json_in(dir, DRAFTS_FILE, DRAFTS_MAX_BYTES);
    };
    let file = dir.join(DRAFTS_FILE);
    let bytes = match std::fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return VaultFileRead::Missing,
        // A sealed file is larger than its content by header and tag.
        Ok(md) if md.is_file() && md.len() <= DRAFTS_MAX_BYTES + 64 => match std::fs::read(&file) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("[vault] read {}: {e}", file.display());
                return VaultFileRead::Unreadable;
            }
        },
        _ => return VaultFileRead::Unreadable,
    };
    let plain = if crypto::is_sealed(&bytes) {
        match crypto::open(key, Context::Drafts, &bytes) {
            Ok(plain) => plain.to_vec(),
            Err(e) => {
                eprintln!("[vault] {DRAFTS_FILE}: {e}");
                return VaultFileRead::Unreadable;
            }
        }
    } else {
        bytes
    };
    match String::from_utf8(plain) {
        Ok(contents) => VaultFileRead::Found { contents },
        Err(_) => VaultFileRead::Unreadable,
    }
}

/// Replaces the vault's `drafts.json` with `contents`, a JSON object. An
/// empty object removes the file instead: a vault nobody is editing in
/// carries no drafts file around.
///
/// `async`: written after every pause in typing, and a synchronous command
/// would do that on the main thread, where the window lives. The frontend
/// chains its calls, so they still arrive one after the other — and closing
/// the window waits for the last one, so that a draft that was just discarded
/// does not come back after the restart.
#[tauri::command(async)]
pub fn write_vault_drafts(app: tauri::AppHandle, vault_id: String, contents: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    directory_state(&dir)?;
    let key = drafts_key(&app, &vault_id)?;
    write_drafts_in(&dir, &contents, key.as_ref())
}

fn write_drafts_in(dir: &Path, contents: &str, key: Option<&crate::crypto::Key>) -> Result<(), String> {
    if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(contents) {
        if map.is_empty() {
            std::fs::remove_file(dir.join(DRAFTS_TEMP_FILE)).ok();
            let file = dir.join(DRAFTS_FILE);
            return match patiently(|| std::fs::remove_file(&file)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("remove {DRAFTS_FILE}: {e}")),
                _ => Ok(()),
            };
        }
    }
    let Some(key) = key else {
        return write_json_in(dir, DRAFTS_FILE, DRAFTS_TEMP_FILE, DRAFTS_MAX_BYTES, contents);
    };
    if contents.len() as u64 > DRAFTS_MAX_BYTES {
        return Err(format!("{DRAFTS_FILE} too large"));
    }
    match serde_json::from_str::<serde_json::Value>(contents) {
        Ok(serde_json::Value::Object(_)) => {}
        _ => return Err(format!("{DRAFTS_FILE} must be a JSON object")),
    }
    let sealed = crate::crypto::seal(key, crate::crypto::Context::Drafts, contents.as_bytes());
    write_atomic(dir, DRAFTS_FILE, DRAFTS_TEMP_FILE, &sealed)
}

fn read_settings_in(dir: &Path) -> VaultFileRead {
    read_json_in(dir, SETTINGS_FILE, SETTINGS_MAX_BYTES)
}

fn write_settings_in(dir: &Path, contents: &str) -> Result<(), String> {
    write_json_in(dir, SETTINGS_FILE, SETTINGS_TEMP_FILE, SETTINGS_MAX_BYTES, contents)
}

/// Runs `op` again a few times when it fails. On Windows a virus scanner, the
/// indexer or a sync client holding the file for a moment makes a rename or a
/// remove fail with a sharing violation that is gone a little later. The wait
/// doubles each time (30 ms up to 480 ms, just under a second in all): a sync
/// client in a OneDrive or Dropbox folder holds on longer than a scanner. A
/// missing file is an answer, not a failure to retry.
pub(crate) fn patiently<T>(mut op: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    const ATTEMPTS: u32 = 6;
    let mut wait_ms = 30;
    let mut attempt = 1;
    loop {
        match op() {
            Err(e) if attempt < ATTEMPTS && e.kind() != std::io::ErrorKind::NotFound => {
                std::thread::sleep(std::time::Duration::from_millis(wait_ms));
                wait_ms *= 2;
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// One of the vault's own JSON files (`settings.json`, `drafts.json`).
fn read_json_in(dir: &Path, name: &str, max_bytes: u64) -> VaultFileRead {
    let file = dir.join(name);
    // `symlink_metadata`, not `metadata`: a vault folder can come from
    // elsewhere, and a link in it should not be followed — as with
    // `guarded_read_path` in `lib.rs`.
    match std::fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => VaultFileRead::Missing,
        Ok(md) if md.is_file() && md.len() <= max_bytes => match std::fs::read_to_string(&file) {
            Ok(contents) => VaultFileRead::Found { contents },
            Err(e) => {
                eprintln!("[vault] read {}: {e}", file.display());
                VaultFileRead::Unreadable
            }
        },
        _ => VaultFileRead::Unreadable,
    }
}

/// Writes `contents` under `name`, through `temp_name`. Only well-formed JSON
/// objects, and nothing above `max_bytes`.
fn write_json_in(dir: &Path, name: &str, temp_name: &str, max_bytes: u64, contents: &str) -> Result<(), String> {
    if contents.len() as u64 > max_bytes {
        return Err(format!("{name} too large"));
    }
    match serde_json::from_str::<serde_json::Value>(contents) {
        Ok(serde_json::Value::Object(_)) => {}
        _ => return Err(format!("{name} must be a JSON object")),
    }
    write_atomic(dir, name, temp_name, contents.as_bytes())
}

/// Writes `bytes` to `dir/name` through `dir/temp_name` and a rename, so a
/// crash leaves either the old file or the new one, never half of either.
pub(crate) fn write_atomic(dir: &Path, name: &str, temp_name: &str, bytes: &[u8]) -> Result<(), String> {
    write_atomic_with(dir, name, temp_name, bytes, true, false)
}

/// [`write_atomic`] for a file only this account may read, from its first byte on.
pub(crate) fn write_atomic_private(dir: &Path, name: &str, temp_name: &str, bytes: &[u8]) -> Result<(), String> {
    write_atomic_with(dir, name, temp_name, bytes, true, true)
}

/// [`write_atomic`] for a folder that is not the vault's: a volume that cannot
/// flush to disk — some network shares refuse it — still gets the file. For a
/// backup that is the better answer; for `vault.key` it would not be. A flush
/// that fails for any other reason still fails the write.
pub(crate) fn write_atomic_anywhere(dir: &Path, name: &str, temp_name: &str, bytes: &[u8]) -> Result<(), String> {
    write_atomic_with(dir, name, temp_name, bytes, false, false)
}

/// Whether a failed flush only says "this volume cannot flush" — the one
/// answer a backup may ignore. Everything else fails the write: on a network
/// volume a full disk, an exhausted quota or a failing medium only shows when
/// the data is flushed, because `write` has merely filled a cache by then.
fn sync_refusal_is_harmless(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    // ENOTTY: what a file system answers that does not know the flush call.
    // The same number on Linux and macOS; on Windows 25 would mean something else.
    const ENOTTY: i32 = 25;
    // macOS: ENOTSUP (45) is not EOPNOTSUPP (102) there, and std maps only
    // EOPNOTSUPP and ENOSYS to `Unsupported`. This is how F_FULLFSYNC — which is
    // `sync_all` on macOS — answers on an SMB share.
    const MACOS_ENOTSUP: i32 = 45;
    // ERROR_INVALID_FUNCTION, ERROR_NOT_SUPPORTED.
    const WINDOWS_NOT_SUPPORTED: [i32; 2] = [1, 50];
    // InvalidInput: EINVAL — this is how `fsync` answers when the target has no notion of syncing.
    matches!(error.kind(), ErrorKind::Unsupported | ErrorKind::InvalidInput)
        || (cfg!(unix) && error.raw_os_error() == Some(ENOTTY))
        || (cfg!(target_os = "macos") && error.raw_os_error() == Some(MACOS_ENOTSUP))
        || (cfg!(windows) && error.raw_os_error().is_some_and(|code| WINDOWS_NOT_SUPPORTED.contains(&code)))
}

/// `must_sync`: whether a flush the volume refuses fails the write.
fn write_atomic_with(dir: &Path, name: &str, temp_name: &str, bytes: &[u8], must_sync: bool, private: bool) -> Result<(), String> {
    use std::io::Write;

    // Whatever lies under the temp name — a crash remnant or a planted
    // link — get rid of it (a link disappears, its target stays). `create_new`
    // fails if something shows up again in between, instead of writing after a
    // link.
    let temp = dir.join(temp_name);
    std::fs::remove_file(&temp).ok();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = private;
    let written = options
        .open(&temp)
        // First onto the disk, then rename: otherwise an empty file can sit under
        // the target name after a power failure — for `vault.key` that would mean the
        // vault is lost. Without `must_sync` a volume may refuse the flush — any
        // other error there counts.
        .and_then(|mut file| {
            file.write_all(bytes)?;
            match file.sync_all() {
                Err(e) if must_sync || !sync_refusal_is_harmless(&e) => Err(e),
                _ => Ok(()),
            }
        });
    if let Err(e) = written {
        std::fs::remove_file(&temp).ok();
        return Err(format!("write {}: {e}", temp.display()));
    }
    // `rename` replaces an existing file on all three platforms — also a
    // link under the target name, without following it.
    let target = dir.join(name);
    patiently(|| std::fs::rename(&temp, &target)).map_err(|e| {
        std::fs::remove_file(&temp).ok();
        format!("replace {name}: {e}")
    })?;
    // On Unix the new name is only settled once the folder itself is on the
    // disk. Windows records that with the rename.
    #[cfg(unix)]
    if let Ok(dir) = std::fs::File::open(dir) {
        dir.sync_all().ok();
    }
    Ok(())
}

/// Removes the working copy of a backup import (`importStaging.ts`) along
/// with its journal. If it is missing, that is no error — before every import,
/// whatever a crashed run left lying around is cleaned up, and usually there
/// is nothing.
///
/// The file name is fixed: the command can delete nothing other than this copy
/// in the registered vault folder.
#[tauri::command]
pub fn discard_import_staging(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_id)?;
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let file = dir.join(format!("{IMPORT_STAGING_FILE}{suffix}"));
        match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("remove {}: {e}", file.display()));
            }
            _ => {}
        }
    }
    Ok(())
}

/// The version number of a migration backup (`emerald.db.pre-v42.bak`,
/// created by `backupDatabaseFile` in `dbRebuild.ts`) — `None` for every other
/// name.
pub(crate) fn migration_backup_version(name: &str) -> Option<u32> {
    name.strip_prefix(DB_FILE)?
        .strip_prefix(".pre-v")?
        .strip_suffix(".bak")?
        .parse()
        .ok()
}

/// Deletes in `dir` all migration backups except the newest and returns
/// how many there were. Only ordinary files of exactly this name — a symlink
/// or folder of the same name stays.
fn prune_migration_backups_in(dir: &Path) -> Result<u32, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(format!("read {}: {e}", dir.display())),
    };
    let mut found: Vec<(u32, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|entry| {
            let version = migration_backup_version(entry.file_name().to_str()?)?;
            Some((version, entry.path()))
        })
        .collect();
    found.sort_by_key(|(version, _)| *version);
    found.pop();
    for (_, path) in &found {
        std::fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(found.len() as u32)
}

/// Every migration that rebuilds creates a full copy of the database
/// beforehand (embedded images included). Once the vault is open afterwards,
/// only the newest is needed — the older ones used to lie in the vault folder
/// forever. Deletes nothing outside the registered vault folder and nothing
/// that is not named exactly `emerald.db.pre-vNN.bak`.
#[tauri::command]
pub fn prune_migration_backups(app: tauri::AppHandle, vault_id: String) -> Result<u32, String> {
    prune_migration_backups_in(&vault_dir(&app, &vault_id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    /// A parent directory of its own per test. `adopt_into` derives the source
    /// from the target folder and expects both side by side; a shared temp folder
    /// would let the tests interfere with each other.
    fn scratch() -> PathBuf {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("emerald-adopt-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn registry(entries: &[(&str, &Path)]) -> String {
        let vaults: Vec<serde_json::Value> = entries
            .iter()
            .map(|(id, path)| serde_json::json!({ "id": id, "path": path.to_string_lossy() }))
            .collect();
        serde_json::json!({ "version": 2, "vaults": vaults }).to_string()
    }

    fn paths_in(file: &Path) -> Vec<String> {
        let doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        doc["vaults"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["path"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn settings_round_trip_and_a_missing_file_is_missing() {
        let dir = scratch();
        assert_eq!(read_settings_in(&dir), VaultFileRead::Missing);
        write_settings_in(&dir, r#"{"version":1}"#).unwrap();
        write_settings_in(&dir, r#"{"version":2}"#).unwrap();
        assert_eq!(
            read_settings_in(&dir),
            VaultFileRead::Found { contents: r#"{"version":2}"#.to_string() }
        );
        assert!(!dir.join(SETTINGS_TEMP_FILE).exists());
    }

    #[test]
    fn drafts_round_trip_and_an_empty_object_removes_the_file() {
        let dir = scratch();
        assert_eq!(read_json_in(&dir, DRAFTS_FILE, DRAFTS_MAX_BYTES), VaultFileRead::Missing);
        // Nothing there, nothing to remove — no error.
        write_drafts_in(&dir, "{}", None).unwrap();
        write_drafts_in(&dir, r#"{"version":1,"templates":{}}"#, None).unwrap();
        assert_eq!(
            read_json_in(&dir, DRAFTS_FILE, DRAFTS_MAX_BYTES),
            VaultFileRead::Found { contents: r#"{"version":1,"templates":{}}"#.to_string() }
        );
        assert!(!dir.join(DRAFTS_TEMP_FILE).exists());
        write_drafts_in(&dir, "{}", None).unwrap();
        assert!(!dir.join(DRAFTS_FILE).exists());
        assert!(write_drafts_in(&dir, "[]", None).is_err());
        // The settings next to it stay untouched.
        write_settings_in(&dir, r#"{"version":1}"#).unwrap();
        write_drafts_in(&dir, r#"{"version":1}"#, None).unwrap();
        write_drafts_in(&dir, "{}", None).unwrap();
        assert!(dir.join(SETTINGS_FILE).exists());
    }

    #[test]
    fn drafts_are_sealed_in_an_encrypted_vault() {
        let dir = scratch();
        let key = crate::crypto::random_key();
        // A plain-text remnant from before encryption is still read.
        write_drafts_in(&dir, r#"{"version":1,"old":true}"#, None).unwrap();
        assert_eq!(
            read_drafts_in(&dir, Some(&key)),
            VaultFileRead::Found { contents: r#"{"version":1,"old":true}"#.to_string() }
        );
        write_drafts_in(&dir, r#"{"version":1,"secret":"GEHEIM-DRAFT"}"#, Some(&key)).unwrap();
        let raw = std::fs::read(dir.join(DRAFTS_FILE)).unwrap();
        assert!(!raw.windows(12).any(|w| w == b"GEHEIM-DRAFT"));
        assert_eq!(
            read_drafts_in(&dir, Some(&key)),
            VaultFileRead::Found { contents: r#"{"version":1,"secret":"GEHEIM-DRAFT"}"#.to_string() }
        );
        // Without the right key: unreadable, not plain text.
        assert_eq!(read_drafts_in(&dir, Some(&crate::crypto::random_key())), VaultFileRead::Unreadable);
        assert!(write_drafts_in(&dir, "[]", Some(&key)).is_err());
        write_drafts_in(&dir, "{}", Some(&key)).unwrap();
        assert!(!dir.join(DRAFTS_FILE).exists());
    }

    #[test]
    fn settings_refuse_anything_but_a_json_object() {
        let dir = scratch();
        for bad in ["", "[]", "\"x\"", "{", "null"] {
            assert!(write_settings_in(&dir, bad).is_err(), "accepted {bad:?}");
        }
        assert!(!dir.join(SETTINGS_FILE).exists());
        let huge = format!(r#"{{"x":"{}"}}"#, "a".repeat(SETTINGS_MAX_BYTES as usize));
        assert!(write_settings_in(&dir, &huge).is_err());
    }

    #[test]
    fn a_settings_path_that_is_no_plain_file_is_unreadable_not_an_error() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join(SETTINGS_FILE)).unwrap();
        assert_eq!(read_settings_in(&dir), VaultFileRead::Unreadable);

        let big = scratch();
        write(&big.join(SETTINGS_FILE), &"a".repeat(SETTINGS_MAX_BYTES as usize + 1));
        assert_eq!(read_settings_in(&big), VaultFileRead::Unreadable);
    }

    #[test]
    fn a_stale_temp_file_does_not_block_the_write() {
        let dir = scratch();
        write(&dir.join(SETTINGS_TEMP_FILE), "leftover");
        write_settings_in(&dir, "{}").unwrap();
        assert_eq!(read_settings_in(&dir), VaultFileRead::Found { contents: "{}".to_string() });
    }

    #[cfg(unix)]
    #[test]
    fn settings_never_write_through_or_read_through_a_link() {
        let dir = scratch();
        let outside = scratch().join("victim.txt");
        write(&outside, "keep me");
        std::os::unix::fs::symlink(&outside, dir.join(SETTINGS_TEMP_FILE)).unwrap();
        write_settings_in(&dir, "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep me");
        assert!(!std::fs::symlink_metadata(dir.join(SETTINGS_FILE)).unwrap().file_type().is_symlink());

        let linked = scratch();
        std::os::unix::fs::symlink(&outside, linked.join(SETTINGS_FILE)).unwrap();
        assert_eq!(read_settings_in(&linked), VaultFileRead::Unreadable);
    }

    #[test]
    fn the_dev_build_adopts_from_the_dev_predecessor() {
        let base = Path::new("/parent");
        assert_eq!(
            previous_dir(&base.join("com.emerald.app")).unwrap(),
            base.join(PREVIOUS_IDENTIFIER)
        );
        assert_eq!(
            previous_dir(&base.join("com.emerald.app.dev")).unwrap(),
            base.join(format!("{PREVIOUS_IDENTIFIER}.dev"))
        );
    }

    #[test]
    fn copies_the_whole_tree_and_leaves_the_source_standing() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        write(&previous.join(VAULTS_FILE), &registry(&[]));
        write(&previous.join("images").join("a.jpg"), "bild");
        write(&previous.join("vaults").join("abc").join(DB_FILE), "datenbank");

        adopt_into(&current).unwrap();

        assert_eq!(
            std::fs::read_to_string(current.join("vaults").join("abc").join(DB_FILE)).unwrap(),
            "datenbank"
        );
        assert_eq!(
            std::fs::read_to_string(current.join("images").join("a.jpg")).unwrap(),
            "bild"
        );
        assert!(previous.join(VAULTS_FILE).is_file(), "the source stays");
        let leftovers: Vec<_> = std::fs::read_dir(&current)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".adopting"))
            .collect();
        assert!(leftovers.is_empty(), "Reste des Zwischenschritts: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The case that decides on "once": if the takeover ran a second time, it
    /// would overwrite what the user has created since.
    #[test]
    fn keeps_its_hands_off_a_directory_that_already_holds_something() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        write(&previous.join(VAULTS_FILE), &registry(&[]));
        write(&current.join(VAULTS_FILE), "neuer Bestand");

        adopt_into(&current).unwrap();

        assert_eq!(
            std::fs::read_to_string(current.join(VAULTS_FILE)).unwrap(),
            "neuer Bestand"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_predecessor_is_not_an_error() {
        let root = scratch();
        let current = root.join("com.emerald.app");

        adopt_into(&current).unwrap();

        assert!(!current.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Only paths that lay in the old directory are rewritten — the vaults
    /// chosen by the user lie elsewhere and stay where they are.
    #[test]
    fn moves_only_the_paths_that_pointed_into_the_old_directory() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        let migrated = previous.join(VAULTS_SUBDIR).join("abc");
        let chosen = root.join("Documents").join("Kampfmagie");
        write(
            &previous.join(VAULTS_FILE),
            &registry(&[("a", &migrated), ("b", &chosen)]),
        );

        adopt_into(&current).unwrap();

        assert_eq!(
            paths_in(&current.join(VAULTS_FILE)),
            vec![
                current
                    .join(VAULTS_SUBDIR)
                    .join("abc")
                    .to_string_lossy()
                    .into_owned(),
                chosen.to_string_lossy().into_owned(),
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A `..` in the stored path survived `strip_prefix`/`join` and then
    /// pointed out of the data directory. Such entries stay untouched instead of
    /// silently pointing elsewhere.
    #[test]
    fn refuses_to_retarget_a_path_that_climbs_out() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        let climbing = previous.join(VAULTS_SUBDIR).join("..").join("..").join("woanders");
        write(&previous.join(VAULTS_FILE), &registry(&[("a", &climbing)]));

        adopt_into(&current).unwrap();

        assert_eq!(
            paths_in(&current.join(VAULTS_FILE)),
            vec![climbing.to_string_lossy().into_owned()],
            "unveraendert stehen geblieben"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The Linux case: the target directory is also the webview profile there
    /// and exists before the first window does. Foreign files in it must not
    /// prevent the takeover — and ours must not overwrite theirs.
    #[test]
    fn foreign_files_in_the_target_neither_block_nor_get_touched() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        write(&previous.join(VAULTS_FILE), &registry(&[]));
        write(&previous.join("cookies"), "alte Kekse");
        write(&current.join("cookies"), "neue Kekse");

        adopt_into(&current).unwrap();

        assert!(current.join(VAULTS_FILE).is_file(), "trotzdem uebernommen");
        assert_eq!(
            std::fs::read_to_string(current.join("cookies")).unwrap(),
            "neue Kekse",
            "the webview profile stays untouched"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A registry that cannot be read must not prevent the takeover —
    /// otherwise the user would find an empty journal instead of a copy they can
    /// fix by hand.
    #[test]
    fn an_unreadable_registry_still_gets_copied() {
        let root = scratch();
        let previous = root.join(PREVIOUS_IDENTIFIER);
        let current = root.join("com.emerald.app");
        write(&previous.join(VAULTS_FILE), "{ das ist kein JSON");
        write(&previous.join("images").join("a.jpg"), "bild");

        adopt_into(&current).unwrap();

        assert_eq!(
            std::fs::read_to_string(current.join(VAULTS_FILE)).unwrap(),
            "{ das ist kein JSON"
        );
        assert!(current.join("images").join("a.jpg").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_a_volume_that_cannot_flush_is_forgiven() {
        use std::io::{Error, ErrorKind};
        assert!(sync_refusal_is_harmless(&Error::from(ErrorKind::Unsupported)));
        assert!(sync_refusal_is_harmless(&Error::from(ErrorKind::InvalidInput)));
        for kind in [ErrorKind::StorageFull, ErrorKind::QuotaExceeded, ErrorKind::PermissionDenied, ErrorKind::Other] {
            assert!(!sync_refusal_is_harmless(&Error::from(kind)), "{kind:?}");
        }

        // The operating system codes themselves — they depend on how std maps
        // them to `ErrorKind`, and that should turn red here, not at the user's.
        let harmless = |code: i32| sync_refusal_is_harmless(&Error::from_raw_os_error(code));
        #[cfg(unix)]
        {
            // ENOTTY, EINVAL — and not: EIO, ENOSPC.
            assert!(harmless(25) && harmless(22));
            assert!(!harmless(5) && !harmless(28));
        }
        #[cfg(target_os = "macos")]
        assert!(harmless(45) && harmless(102)); // ENOTSUP, EOPNOTSUPP
        #[cfg(target_os = "linux")]
        assert!(harmless(95) && harmless(38)); // EOPNOTSUPP, ENOSYS
        #[cfg(windows)]
        {
            // ERROR_INVALID_FUNCTION, ERROR_NOT_SUPPORTED, ERROR_CALL_NOT_IMPLEMENTED —
            // and not: ERROR_DISK_FULL, ERROR_NETNAME_DELETED.
            assert!(harmless(1) && harmless(50) && harmless(120));
            assert!(!harmless(112) && !harmless(64));
        }
    }

    #[test]
    fn prune_keeps_only_the_newest_migration_backup() {
        let dir = scratch();
        for name in ["emerald.db.pre-v33.bak", "emerald.db.pre-v9.bak", "emerald.db.pre-v42.bak"] {
            write(&dir.join(name), "db");
        }
        // Not this pattern, or no file name in order: stays.
        for name in ["emerald.db", "emerald.db.pre-vx.bak", "other.db.pre-v50.bak", "emerald.db.pre-v50.bak.old"] {
            write(&dir.join(name), "keep");
        }
        std::fs::create_dir_all(dir.join("emerald.db.pre-v60.bak")).unwrap();

        assert_eq!(prune_migration_backups_in(&dir).unwrap(), 2);
        assert!(dir.join("emerald.db.pre-v42.bak").is_file());
        assert!(!dir.join("emerald.db.pre-v33.bak").exists());
        assert!(!dir.join("emerald.db.pre-v9.bak").exists());
        for name in ["emerald.db", "emerald.db.pre-vx.bak", "other.db.pre-v50.bak", "emerald.db.pre-v50.bak.old"] {
            assert!(dir.join(name).is_file(), "{name}");
        }
        assert!(dir.join("emerald.db.pre-v60.bak").is_dir());
        assert_eq!(prune_migration_backups_in(&dir.join("missing")).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
