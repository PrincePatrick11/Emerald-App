//! Vault storage layout.
//!
//! A vault is a directory the user picked. Inside it live `emerald.db`, an
//! `images/` folder, and a `backup/` folder.
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
pub const IMAGES_SUBDIR: &str = "images";
/// Where a vault migrated from the pre-0.2.1 layout lives: `{appDataDir}/vaults/`.
pub const VAULTS_SUBDIR: &str = "vaults";
/// The folder new vaults are offered in, inside the user's documents directory.
pub const VAULT_HOME_DIR: &str = "Emerald Vaults";
/// Where the database export offers to write its `.emeralddb`, inside the vault.
pub const BACKUP_SUBDIR: &str = "backup";
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

// ── Uebernahme aus dem Verzeichnis des vorigen Identifiers ───────────────────

/// Der Identifier vor 0.2.1.
///
/// Eingefrorene Geschichte, kein Konfigurationswert: unter diesem Namen liefen
/// die zehn Releases bis v0.1.3.6, und so heissen deren Verzeichnisse bis
/// heute. Wird der Identifier je erneut gewechselt, kommt eine weitere Stufe
/// dazu — dieser Wert bleibt, was er ist.
const PREVIOUS_IDENTIFIER: &str = "com.emerald.magical-journal";

/// So tief, wie hier je etwas liegen kann (`vaults/{id}/images/`), mit
/// reichlich Luft. Die Grenze ist kein Geschmack, sondern der Boden unter der
/// Rekursion: ein Stack-Overflow ist ein `abort` und kein `Err`, den
/// [`adopt_previous_identifier_dirs`] auffangen koennte.
const MAX_COPY_DEPTH: u32 = 16;

/// Das Verzeichnis, das derselben Installation unter dem vorigen Identifier
/// entspraeche.
///
/// Abgeleitet aus dem Namen des aktuellen und nicht aus einer zweiten
/// Konstante: so steht der jetzige Identifier hier nirgends, und der naechste
/// Wechsel fasst diese Zeile nicht an. Das `.dev` des Dev-Builds wandert mit,
/// damit der nicht aus dem Produktivordner schoepft.
fn previous_dir(current: &Path) -> Option<PathBuf> {
    let name = current.file_name()?.to_str()?;
    let suffix = if name.ends_with(".dev") { ".dev" } else { "" };
    Some(current.with_file_name(format!("{PREVIOUS_IDENTIFIER}{suffix}")))
}

/// Was von der alten Installation ueberhaupt uebernommen wird, am Namen
/// erkannt.
///
/// Eine Liste und nicht "alles, was dort liegt", weil in diesem Verzeichnis
/// nicht nur unsere Daten liegen. Auf Linux ist `app_data_dir` zugleich das
/// Webview-Profil: `dirs::data_local_dir()` ist dort dieselbe Funktion wie
/// `data_dir()`, und Tauri legt das Profil unter `LocalData/{identifier}` an.
/// Der alte Ordner enthaelt dort also auch Cookies und den `localStorage` der
/// Altinstallation — die haben im Profil der neuen nichts verloren, schon gar
/// nicht, waehrend WebKitGTK es geoeffnet haelt.
///
/// Dieselbe Liste beantwortet die Frage, ob hier schon uebernommen wurde.
/// Kommt ein weiteres eigenes Artefakt hinzu, gehoert es hierher.
fn is_own_data(name: &str) -> bool {
    name == VAULTS_FILE
        || name == IMAGES_SUBDIR
        || name == VAULTS_SUBDIR
        // `emerald.db`, die flachen `emerald-{uuid}.db` des Alt-Layouts, ihre
        // `-journal`-Beilagen und die `.pre-vNN.bak`-Sicherungen.
        || name.starts_with("emerald")
}

/// Ob in `dir` noch nichts von uns liegt.
///
/// Bewusst nicht "das Verzeichnis ist leer". Auf Linux legt Tauri es an, bevor
/// das erste Fenster steht, und WebKitGTK schreibt hinein; auf Windows und
/// macOS koennen `desktop.ini` und `.DS_Store` darin auftauchen. Ein leerer
/// Ordner waere also die falsche Frage — die richtige ist, ob eine fruehere
/// Uebernahme oder ein Start der neuen Version hier schon etwas hinterlassen
/// hat.
fn holds_no_data_yet(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(entries) => !entries
            .flatten()
            .any(|e| e.file_name().to_str().is_some_and(is_own_data)),
        // `read_dir` wirft fuer "gibt es nicht" und "darf ich nicht" denselben
        // Fehler, `metadata` unterscheidet sie. Nicht da heisst frei; alles
        // andere heisst: nichts anfassen.
        Err(_) => matches!(
            std::fs::metadata(dir),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound
        ),
    }
}

/// Raeumt einen Pfad weg, gleich ob Datei oder Verzeichnis. Was es nicht gibt,
/// ist nichts zu tun.
fn clear(path: &Path) -> Result<(), String> {
    let removed = match std::fs::symlink_metadata(path) {
        Ok(md) if md.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(_) => return Ok(()),
    };
    removed.map_err(|e| format!("clear {}: {e}", path.display()))
}

/// Kopiert einen Verzeichnisbaum. Symlinks bleiben liegen: hier steht keiner,
/// und einem zu folgen hiesse aus einem Verzeichnis zu kopieren, ueber das die
/// App nichts weiss.
fn copy_dir(from: &Path, to: &Path, depth: u32) -> Result<(), String> {
    if depth > MAX_COPY_DEPTH {
        return Err(format!("too deep at {}", from.display()));
    }
    std::fs::create_dir_all(to).map_err(|e| format!("create {}: {e}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        // `file_type` loest Symlinks nicht auf, sie sind hier also weder das
        // eine noch das andere und fallen durch.
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

/// Legt `source` unter `target` ab, ohne dass es dort je halb steht:
/// geschrieben wird daneben, und erst das abschliessende `rename` — im selben
/// Verzeichnis, also ein Namenstausch und keine Kopie — macht es sichtbar.
///
/// Darauf ruht alles Weitere. Ein halb kopiertes `emerald.db` unter seinem
/// richtigen Namen saehe beim naechsten Start wie eine gelungene Uebernahme
/// aus und wuerde nie wiederholt.
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

/// Zieht die Pfade in der kopierten `vaults.json` von `old_root` auf
/// `new_root` um.
///
/// Die Datei speichert je Vault ein absolutes Verzeichnis. Fuer die ueblichen —
/// vom Nutzer gewaehlt, meist unter `Dokumente` — aendert sich dadurch nichts.
/// Ein aus dem Vor-0.2.1-Layout migrierter Vault liegt dagegen unter
/// `{appDataDir}/vaults/{id}`, und damit steckt der alte Identifier in seinem
/// gespeicherten Pfad. Bliebe der stehen, laese und schriebe die neue Version
/// weiter im alten Ordner, waehrend die Kopie daneben still veraltete.
///
/// Eine unlesbare Datei ist kein Fehler. Sie bleibt dann, wie sie ist, und das
/// ist die bessere Haelfte einer schlechten Wahl: die alte Installation stand
/// schon vor derselben Datei, und eine Kopie mit unangetasteter Registry laesst
/// sich von Hand richten — eine ausgefallene Uebernahme sieht dagegen aus wie
/// ein leeres Journal.
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
            // `strip_prefix` und `join` arbeiten rein lexikalisch: ein `..` im
            // gespeicherten Pfad ueberlebte die Umschreibung und zeigte danach
            // aus dem Datenverzeichnis heraus. Anderswo waere das egal, hier
            // nicht — diese Registry kommt aus einem Ordner, den die App nicht
            // verwaltet, und `register_vaults` laesst jeden absoluten Pfad
            // durch. Also nur umschreiben, was ausschliesslich aus
            // gewoehnlichen Namen besteht; alles andere bleibt stehen, wie es
            // war, und faellt dem Nutzer als fehlender Vault auf, statt still
            // woandershin zu zeigen.
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

    // Nichts umgeschrieben heisst: die Datei nicht anfassen. Sonst schriebe
    // diese Funktion sie allein fuer die Formatierung neu — und die aelteste
    // Fassung der Registry, die es noch gibt, kennt `path` gar nicht, sondern
    // `dbName` (siehe `migrate_vault_layout`). Die faellt hier durch, und sie
    // soll unveraendert weiterreisen.
    if !moved_any {
        return Ok(());
    }

    // Beim Neuschreiben sortiert serde_json die Schluessel eines Objekts
    // alphabetisch. Folgenlos — gelesen wird die Datei als JSON —, aber es
    // erklaert, warum sie danach anders aussieht, als sie hineinging.
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| format!("write {}: {e}", file.display()))
}

/// Legt die Registry als letztes ab — kopieren, umschreiben, dann sichtbar
/// machen.
///
/// Die Reihenfolge ist der Grund, warum es diese Funktion getrennt gibt: waere
/// erst die Datei da und danach die Umschreibung, hinterliesse ein Abbruch
/// dazwischen eine Registry, die auf den alten Ordner zeigt und dabei
/// uebernommen aussieht.
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

/// Holt jeden eigenen Eintrag herueber und merkt sich in `placed`, was
/// tatsaechlich abgelegt wurde — das braucht der Aufrufer zum Zuruecknehmen.
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
        // Die Registry zum Schluss, siehe `place_registry`.
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

/// Uebernimmt ein Verzeichnis, wenn es das des Vorgaengers gibt und im eigenen
/// noch nichts von uns liegt.
///
/// **Kopiert, verschiebt nicht.** `previous` wird nur gelesen. Die alte
/// Installation bleibt lauffaehig und ist die Rueckfallebene.
///
/// **Ganz oder gar nicht.** Jeder einzelne Eintrag entsteht neben seinem Platz
/// und wird per `rename` sichtbar; scheitert einer, wird zurueckgenommen, was
/// dieser Lauf abgelegt hat. Danach liegt hier wieder nichts von uns, und der
/// naechste Start versucht es erneut. Das Zuruecknehmen ist gefahrlos, weil
/// die Pruefung oben zusichert, dass vor diesem Lauf nichts von uns hier lag.
///
/// **Nur die eigenen Daten**, siehe [`is_own_data`] — der alte Ordner ist auf
/// Linux zugleich das Webview-Profil der Altinstallation.
fn adopt_into(current: &Path) -> Result<(), String> {
    let Some(previous) = previous_dir(current) else {
        return Ok(());
    };
    // `symlink_metadata` und nicht `is_dir()`: das folgte einem Symlink, und
    // der Wurzelordner ist der einzige, den `copy_dir` nicht selbst
    // ueberspringt. Zeigte er auf einen Vorfahren des Zielordners, kopierte
    // sich der Zwischenordner in sich selbst. Die Metadaten eines Links sind
    // nie die eines Verzeichnisses, die Bedingung faengt also beides.
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

/// Uebernimmt beim ersten Start die Daten aus dem Verzeichnis des vorigen
/// Identifiers.
///
/// Tauri leitet `app_data_dir` und `app_config_dir` aus dem `identifier` ab.
/// Mit dem Wechsel auf `com.emerald.app` schaut die App also woanders nach als
/// jede Installation bis v0.1.3.6 — deren `vaults.json` liegt unversehrt
/// nebenan, und ohne diesen Schritt begruesste die neue Version einen
/// langjaehrigen Nutzer mit einem leeren Journal.
///
/// Was uebernommen wird und unter welchen Zusicherungen, steht an
/// [`adopt_into`]. Hier bleibt das Aeussere:
///
/// **Bricht den Start nicht ab.** Eine misslungene Uebernahme ist ein leeres
/// Journal neben unversehrten Daten und von Hand zu beheben; ein `?` an dieser
/// Stelle waere eine App, die gar nicht erst hochkommt.
///
/// **Laeuft, bevor es ein Fenster gibt** — als Plugin-`setup`, siehe den
/// Aufruf in `lib.rs`. Das Kopieren blockiert dadurch keinen Fensterthread und
/// niemand kann auf eine eingefrorene Oberflaeche sehen.
pub fn adopt_previous_identifier_dirs(app: &tauri::AppHandle) {
    // Auf Windows und macOS sind beide dasselbe Verzeichnis, auf Linux nicht —
    // siehe `migrate_vault_layout`. Doppelt liefe harmlos (der zweite Durchgang
    // faende das Ziel nicht mehr frei), aber die Fehlermeldung waere eine zu
    // viel. Bewusst `contains` und nicht `dedup`: das entfernt nur benachbarte
    // Gleiche und griffe bei einem dritten Eintrag still daneben.
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
    std::fs::create_dir_all(dir.join(IMAGES_SUBDIR)).map_err(|e| e.to_string())?;
    // `backup/` gehoert von Anfang an dazu, nicht erst zum ersten Export — so
    // ist die Struktur eines Vault-Ordners immer dieselbe. Fuer Vaults
    // ausserhalb der erlaubten Wurzeln bleibt er folgenlos leer (der Export
    // bietet ihn dort nicht an, siehe `ensure_backup_dir`), und ein leerer
    // `backup/` steht dem Loeschen des Ordners nicht im Weg.
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
    // Wie ueberall hier: einen verschwundenen Vault-Ordner nicht wiederbeleben
    // (siehe `images_dir`), nur den Unterordner darin anlegen.
    directory_state(&vault)?;

    // Der Dialog ist nur die halbe Strecke: geschrieben wird die Datei danach
    // von `write_file`, und das ist auf die festen Wurzeln begrenzt (siehe
    // `resolve_allowed_roots` — Vault-Verzeichnisse erweitern sie bewusst
    // nicht). Einem Vault ausserhalb — anderes Laufwerk, Ordner ausserhalb von
    // `~` — hier ein Ziel anzubieten, hiesse eines anbieten, das der
    // Schreibbefehl anschliessend verweigert. Der `Err` landet im Frontend im
    // Fallback (blosser Dateiname), bevor ein toter `backup/`-Ordner entsteht.
    let allowed = crate::resolve_allowed_roots(&app)?;
    let canonical = std::fs::canonicalize(&vault).map_err(|e| e.to_string())?;
    if !crate::is_within_allowed_roots(&canonical, &allowed) {
        return Err("vault outside allowed storage roots".to_string());
    }

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

/// Deletes a vault's files — the database, its journal, and its images. Only
/// ever reached through the vault modal's opt-in "delete files" checkbox.
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
/// Ein halb geloeschter Vault kann nicht als leerer wiederauferstehen: der
/// Aufrufer nimmt ihn nach jedem `Ok` aus `vaults.json`, und ein `Err` faellt
/// nur, solange die Datenbank noch liegt (Loeschen gesperrt/verweigert).
#[tauri::command]
pub fn delete_vault_files(app: tauri::AppHandle, vault_id: String) -> Result<bool, String> {
    let dir = vault_dir(&app, &vault_id)?;
    if !dir.join(DB_FILE).is_file() {
        return Err("not a vault directory: no database found".to_string());
    }

    // Die Datenbank zuerst: sie ist das einzige Stueck, das noch gesperrt sein
    // kann, und ein Fehlschlag laesst dann wenigstens die Bilder stehen.
    let journal = format!("{DB_FILE}-journal");
    for name in [DB_FILE, journal.as_str()] {
        let file = dir.join(name);
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|e| format!("remove {}: {e}", file.display()))?;
        }
    }

    // Ab hier kein `?` mehr: die Datenbank ist bereits weg, und der Aufrufer
    // nimmt den Vault nur nach einem `Ok` aus `vaults.json`. Ein Fehler ab
    // dieser Stelle liesse den Eintrag stehen, und das naechste `getDb()`
    // legte in den Ordner eine frische, leere Datenbank — der Zustand, den
    // die Invariante oben ausschliesst. Was sich nicht loeschen laesst,
    // bleibt eben liegen, samt Ordner.
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

    // Ein *leerer* `backup/` — seit `create_vault_dirs` ihn mit anlegt, der
    // Normalfall ohne Export — soll das Entfernen des Ordners nicht
    // verhindern. `remove_dir` scheitert, sobald ein Backup darin liegt, und
    // genau dann bleibt beides stehen.
    std::fs::remove_dir(dir.join(BACKUP_SUBDIR)).ok();

    Ok(std::fs::remove_dir(&dir).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    /// Ein eigenes Elternverzeichnis je Test. `adopt_into` leitet den Quell-
    /// aus dem Zielordner ab und erwartet beide nebeneinander, ein gemeinsamer
    /// Temp-Ordner liesse die Tests einander ins Handwerk pfuschen.
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
        assert!(previous.join(VAULTS_FILE).is_file(), "die Quelle bleibt");
        let leftovers: Vec<_> = std::fs::read_dir(&current)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".adopting"))
            .collect();
        assert!(leftovers.is_empty(), "Reste des Zwischenschritts: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Der Fall, der ueber "einmalig" entscheidet: laeuft die Uebernahme ein
    /// zweites Mal, ueberschriebe sie das, was der Nutzer seither angelegt hat.
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

    /// Nur Pfade, die im alten Verzeichnis lagen, werden umgeschrieben — die
    /// vom Nutzer gewaehlten Vaults liegen woanders und bleiben, wo sie sind.
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

    /// Ein `..` im gespeicherten Pfad ueberlebte `strip_prefix`/`join` und
    /// zeigte danach aus dem Datenverzeichnis heraus. Solche Eintraege bleiben
    /// unangetastet stehen, statt still woandershin zu zeigen.
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

    /// Der Linux-Fall: das Zielverzeichnis ist dort zugleich das
    /// Webview-Profil und existiert schon, bevor das erste Fenster steht.
    /// Fremde Dateien darin duerfen die Uebernahme nicht verhindern — und
    /// unsere duerfen ihre nicht ueberschreiben.
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
            "das Webview-Profil bleibt unberuehrt"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Eine Registry, die sich nicht lesen laesst, darf die Uebernahme nicht
    /// verhindern — sonst faende der Nutzer ein leeres Journal statt einer
    /// Kopie, die er von Hand richten kann.
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
}
