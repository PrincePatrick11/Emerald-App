//! Putting a vault under a new key: encrypting one from before encryption,
//! and changing the password — which replaces the vault key, so that an old
//! copy of `vault.key` (cloud version history) plus the old password opens
//! nothing written since.
//!
//! Nothing in the vault is touched until a complete, checked copy under the
//! new key sits next to it. In order:
//!
//! 1. **Prepare** — `vault.key.pending`; the database exported into
//!    `emerald.db.reencrypting` (`sqlcipher_export`); every image sealed under
//!    its new keyed name into `images.reencrypting/`; every image name inside
//!    the copy rewritten; `drafts.json.reencrypting`. Then the copy is
//!    checked: `integrity_check`, and the same row count in every table as
//!    the original.
//! 2. **Commit** — the marker `vault.reencrypting` is written, naming the
//!    images to keep. Then database, `vault.key`, drafts and images are
//!    swapped in.
//! 3. **Clean up** — the old database, its migration backups, the import
//!    staging copy and every image not named in the marker are deleted, then
//!    the marker.
//!
//! [`recover_interrupted`] makes a crash anywhere safe. Without the marker
//! the original is untouched: the half-made copy is thrown away. With it, the
//! swap is finished — every step of it can run again.
//!
//! Image names are rewritten wherever they occur, in every text column of
//! every table: a name is 64 hex digits and an image extension, unique enough
//! that no schema knowledge is needed.

use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection, Executor, Row};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::crypto::{self, Context, Key, Purpose};
use crate::keys::{self, KdfParams, KeyFile};
use crate::{images, vault};

const MARKER: &str = "vault.reencrypting";
const MARKER_TEMP: &str = "vault.reencrypting.tmp";
const PENDING_KEY: &str = "vault.key.pending";
const PENDING_KEY_TEMP: &str = "vault.key.pending.tmp";
const DB_NEW: &str = "emerald.db.reencrypting";
const DB_OLD: &str = "emerald.db.old";
const DRAFTS_NEW: &str = "drafts.json.reencrypting";
const DRAFTS_NEW_TEMP: &str = "drafts.json.reencrypting.tmp";
const IMAGES_NEW: &str = "images.reencrypting";

/// SQLite's companions of a database file.
const DB_SIDE_FILES: [&str; 3] = ["-journal", "-wal", "-shm"];

/// What the vault is under now.
#[derive(Clone, Copy)]
enum Source<'a> {
    Plain,
    Key(&'a Key),
}

fn remove_db_file(dir: &Path, name: &str) {
    for suffix in std::iter::once("").chain(DB_SIDE_FILES) {
        std::fs::remove_file(dir.join(format!("{name}{suffix}"))).ok();
    }
}

fn rename_if_present(dir: &Path, from: &str, to: &str) -> Result<(), String> {
    match std::fs::rename(dir.join(from), dir.join(to)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("rename {from} → {to}: {e}")),
        _ => Ok(()),
    }
}

/// The image files in `dir` — only names an image can have.
fn image_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| images::is_valid_image_name(name))
        .collect()
}

/// Brings a vault directory back to a consistent state after a crash during
/// a re-encryption. Cheap when there is nothing to do.
pub fn recover_interrupted(dir: &Path) -> Result<(), String> {
    if dir.join(MARKER).exists() {
        return finish_commit(dir);
    }
    // Ohne Marker ist das Original unberührt: nur wegräumen, was Schritt 1
    // angelegt haben kann.
    remove_db_file(dir, DB_NEW);
    for name in [PENDING_KEY, PENDING_KEY_TEMP, DRAFTS_NEW, DRAFTS_NEW_TEMP, MARKER_TEMP] {
        std::fs::remove_file(dir.join(name)).ok();
    }
    match std::fs::remove_dir_all(dir.join(IMAGES_NEW)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("remove {IMAGES_NEW}: {e}")),
        _ => Ok(()),
    }
}

/// Steps 2 and 3. Each one checks what is still to do, so a second run after
/// a crash picks up where the first stopped.
fn finish_commit(dir: &Path) -> Result<(), String> {
    let marker = std::fs::read_to_string(dir.join(MARKER)).map_err(|e| format!("read {MARKER}: {e}"))?;
    let keep: HashSet<String> = serde_json::from_str::<Vec<String>>(&marker)
        .map_err(|e| format!("{MARKER}: {e}"))?
        .into_iter()
        .collect();

    if dir.join(DB_NEW).exists() {
        if dir.join(vault::DB_FILE).exists() && !dir.join(DB_OLD).exists() {
            rename_if_present(dir, vault::DB_FILE, DB_OLD)?;
        }
        remove_db_file(dir, vault::DB_FILE);
        rename_if_present(dir, DB_NEW, vault::DB_FILE)?;
    }
    rename_if_present(dir, PENDING_KEY, keys::KEY_FILE)?;
    rename_if_present(dir, DRAFTS_NEW, vault::DRAFTS_FILE)?;

    let images = dir.join(vault::IMAGES_SUBDIR);
    let staged = dir.join(IMAGES_NEW);
    if staged.exists() {
        std::fs::create_dir_all(&images).map_err(|e| format!("create {}: {e}", images.display()))?;
        for name in image_names(&staged) {
            let target = images.join(&name);
            if target.exists() {
                std::fs::remove_file(staged.join(&name)).ok();
            } else {
                std::fs::rename(staged.join(&name), &target).map_err(|e| format!("move {name}: {e}"))?;
            }
        }
        std::fs::remove_dir_all(&staged).ok();
    }

    // Ab hier steht der Vault unter dem neuen Schlüssel; was folgt, ist der
    // alte Stand — Klartext, oder unter einem Schlüssel, den es nicht mehr gibt.
    for name in image_names(&images) {
        if !keep.contains(&name) {
            std::fs::remove_file(images.join(name)).ok();
        }
    }
    remove_db_file(dir, DB_OLD);
    remove_db_file(dir, vault::IMPORT_STAGING_FILE);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_str().and_then(vault::migration_backup_version).is_some() {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }
    std::fs::remove_file(dir.join(MARKER)).map_err(|e| format!("remove {MARKER}: {e}"))
}

/// Replaces every known image name in `text`. `None` when nothing changed.
fn rewrite_image_names(text: &str, renamed: &HashMap<String, String>) -> Option<String> {
    const EXTS: [&str; 6] = ["jpeg", "webp", "png", "jpg", "gif", "svg"];
    let bytes = text.as_bytes();
    let is_hex = |b: u8| b.is_ascii_digit() || (b'a'..=b'f').contains(&b);
    let mut out = String::new();
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        if !is_hex(bytes[i]) || (i > 0 && bytes[i - 1].is_ascii_alphanumeric()) {
            i += 1;
            continue;
        }
        let run = bytes[i..].iter().take_while(|&&b| is_hex(b)).count();
        let dot = i + run;
        if run == 64 && bytes.get(dot) == Some(&b'.') {
            let found = EXTS.iter().find(|ext| {
                let end = dot + 1 + ext.len();
                text.get(dot + 1..end) == Some(**ext) && !bytes.get(end).is_some_and(|b| b.is_ascii_alphanumeric())
            });
            if let Some(ext) = found {
                let end = dot + 1 + ext.len();
                if let Some(new) = renamed.get(&text[i..end]) {
                    out.push_str(&text[copied..i]);
                    out.push_str(new);
                    copied = end;
                }
                i = end;
                continue;
            }
        }
        i += run;
    }
    (copied > 0).then(|| {
        out.push_str(&text[copied..]);
        out
    })
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn quote_str(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

async fn tables(conn: &mut SqliteConnection) -> Result<Vec<String>, String> {
    let rows = conn
        .fetch_all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

async fn row_counts(conn: &mut SqliteConnection) -> Result<Vec<(String, i64)>, String> {
    let mut counts = Vec::new();
    for table in tables(conn).await? {
        let n: i64 = conn
            .fetch_one(format!("SELECT COUNT(*) FROM {}", quote_ident(&table)).as_str())
            .await
            .map_err(|e| e.to_string())?
            .get(0);
        counts.push((table, n));
    }
    Ok(counts)
}

/// Rewrites image names in every text value of every table, in one transaction.
async fn rewrite_database(conn: &mut SqliteConnection, renamed: &HashMap<String, String>) -> Result<(), String> {
    if renamed.is_empty() {
        return Ok(());
    }
    conn.execute("BEGIN").await.map_err(|e| e.to_string())?;
    for table in tables(conn).await? {
        let columns: Vec<String> = conn
            .fetch_all(format!("PRAGMA table_info({})", quote_ident(&table)).as_str())
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        for column in columns {
            let select = format!(
                "SELECT rowid, {col} FROM {t} WHERE typeof({col}) = 'text'",
                col = quote_ident(&column),
                t = quote_ident(&table)
            );
            let rows = conn.fetch_all(select.as_str()).await.map_err(|e| e.to_string())?;
            for row in rows {
                let rowid: i64 = row.get(0);
                let value: String = row.get(1);
                if let Some(new) = rewrite_image_names(&value, renamed) {
                    let update = format!("UPDATE {} SET {} = ? WHERE rowid = ?", quote_ident(&table), quote_ident(&column));
                    sqlx::query(&update)
                        .bind(new)
                        .bind(rowid)
                        .execute(&mut *conn)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    conn.execute("COMMIT").await.map_err(|e| e.to_string())?;
    Ok(())
}

/// A connection without the authorizer `db.rs` puts on the webview's pools —
/// this one runs `sqlcipher_export`. `create_if_missing` although the file
/// exists (checked before): an `ATTACH` inherits the connection's open flags,
/// and without it SQLite would not create the new copy.
async fn open_source(file: &Path, source: Source<'_>) -> Result<SqliteConnection, String> {
    let mut options = SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(true)
        .disable_statement_logging();
    if let Source::Key(vault_key) = source {
        let db_key = crypto::subkey(vault_key, Purpose::Database);
        options = options.pragma("key", crate::db::sqlcipher_key(&db_key).to_string());
    }
    SqliteConnection::connect_with(&options).await.map_err(|e| e.to_string())
}

async fn open_keyed(file: &Path, key: &Key) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(file)
        .disable_statement_logging()
        .pragma("key", crate::db::sqlcipher_key(key).to_string());
    SqliteConnection::connect_with(&options).await.map_err(|e| e.to_string())
}

/// A file's plaintext: opened under the source key when sealed, as it is
/// when not (a plain vault, or the shared pre-0.2.1 pool's leftovers).
fn plaintext(bytes: Vec<u8>, source: Source<'_>, context: Context<'_>) -> Result<Vec<u8>, String> {
    if !crypto::is_sealed(&bytes) {
        return Ok(bytes);
    }
    match source {
        Source::Key(vault_key) => crypto::open(&crypto::subkey(vault_key, Purpose::Files), context, &bytes)
            .map(|plain| plain.to_vec())
            .map_err(|e| e.to_string()),
        Source::Plain => Err("sealed file in an unencrypted vault".into()),
    }
}

/// Step 1: everything next to the vault, nothing in it. Returns the names of
/// the images the vault keeps.
async fn prepare(dir: &Path, source: Source<'_>, new_key: &Key) -> Result<Vec<String>, String> {
    let db_key = crypto::subkey(new_key, Purpose::Database);

    // Die Datenbank.
    let new_file = dir.join(DB_NEW);
    let mut old = open_source(&dir.join(vault::DB_FILE), source).await?;
    let attach = format!(
        "ATTACH DATABASE {} AS reencrypted KEY {}",
        quote_str(&new_file.to_string_lossy()),
        crate::db::sqlcipher_key(&db_key).as_str()
    );
    old.execute(attach.as_str()).await.map_err(|e| e.to_string())?;
    old.execute("SELECT sqlcipher_export('reencrypted')").await.map_err(|e| e.to_string())?;
    old.execute("DETACH DATABASE reencrypted").await.map_err(|e| e.to_string())?;
    let expected = row_counts(&mut old).await?;
    old.close().await.map_err(|e| e.to_string())?;

    // Die Bilder: unter neuem Namen in den eigenen Ordner.
    let images = dir.join(vault::IMAGES_SUBDIR);
    let staged = dir.join(IMAGES_NEW);
    std::fs::create_dir_all(&staged).map_err(|e| format!("create {IMAGES_NEW}: {e}"))?;
    let mut renamed = HashMap::new();
    for name in image_names(&images) {
        let bytes = std::fs::read(images.join(&name)).map_err(|e| format!("read {name}: {e}"))?;
        let bytes = plaintext(bytes, source, Context::Image(&name))?;
        let ext = name.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("png");
        let (new_name, contents) = images::seal_for_vault(new_key, &bytes, ext);
        let target = staged.join(&new_name);
        if !target.exists() {
            std::fs::write(&target, contents).map_err(|e| format!("write {new_name}: {e}"))?;
        }
        renamed.insert(name, new_name);
    }

    // Die Verweise in der Kopie, dann die Prüfung.
    let mut new_db = open_keyed(&new_file, &db_key).await?;
    rewrite_database(&mut new_db, &renamed).await?;
    let check: String = new_db
        .fetch_one("PRAGMA integrity_check")
        .await
        .map_err(|e| e.to_string())?
        .get(0);
    if check != "ok" {
        return Err(format!("new copy failed its integrity check: {check}"));
    }
    let actual = row_counts(&mut new_db).await?;
    new_db.close().await.map_err(|e| e.to_string())?;
    if actual != expected {
        return Err("new copy does not match the original".into());
    }

    // Die Entwürfe.
    let drafts = dir.join(vault::DRAFTS_FILE);
    if drafts.is_file() {
        let bytes = std::fs::read(&drafts).map_err(|e| format!("read drafts: {e}"))?;
        let text = String::from_utf8(plaintext(bytes, source, Context::Drafts)?).map_err(|e| format!("drafts: {e}"))?;
        let text = rewrite_image_names(&text, &renamed).unwrap_or(text);
        let files_key = crypto::subkey(new_key, Purpose::Files);
        let sealed = crypto::seal(&files_key, Context::Drafts, text.as_bytes());
        vault::write_atomic(dir, DRAFTS_NEW, DRAFTS_NEW_TEMP, &sealed)?;
    }

    let mut keep: Vec<String> = renamed.into_values().collect();
    keep.sort();
    keep.dedup();
    Ok(keep)
}

/// The whole run under a fresh vault key. Returns it and the recovery key.
async fn reencrypt(
    dir: &Path,
    source: Source<'_>,
    password: &str,
    kdf: KdfParams,
) -> Result<(Key, zeroize::Zeroizing<String>), String> {
    let (file, new_key, recovery) = KeyFile::create(password, kdf)?;
    vault::write_atomic(dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes())?;

    let keep = match prepare(dir, source, &new_key).await {
        Ok(keep) => keep,
        Err(e) => {
            recover_interrupted(dir).ok();
            return Err(e);
        }
    };

    let marker = serde_json::to_string(&keep).map_err(|e| e.to_string())?;
    vault::write_atomic(dir, MARKER, MARKER_TEMP, marker.as_bytes())?;
    finish_commit(dir)?;
    Ok((new_key, recovery))
}

/// Encrypts an existing plain vault in `dir`.
pub async fn encrypt_dir(dir: &Path, password: &str, kdf: KdfParams) -> Result<(Key, zeroize::Zeroizing<String>), String> {
    recover_interrupted(dir)?;
    if keys::is_encrypted_dir(dir) {
        return Err(keys::VAULT_ALREADY_ENCRYPTED.into());
    }
    if !dir.join(vault::DB_FILE).is_file() {
        return Err("no database to encrypt".into());
    }
    reencrypt(dir, Source::Plain, password, kdf).await
}

/// Moves an encrypted vault in `dir` from `old_key` to a new vault key under
/// `password`. The recovery key is new as well.
pub async fn rekey_dir(dir: &Path, old_key: &Key, password: &str, kdf: KdfParams) -> Result<(Key, zeroize::Zeroizing<String>), String> {
    recover_interrupted(dir)?;
    if !keys::read_key_file(dir)?.is_some_and(|file| file.accepts(old_key)) {
        return Err(keys::VAULT_LOCKED.into());
    }
    reencrypt(dir, Source::Key(old_key), password, kdf).await
}

/// One re-encryption at a time — across awaits, so not the `std` mutex.
static RUNNING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Remembers the new key where the old one was remembered, or as asked.
async fn remember_new(vault_id: &str, key: &Key, wanted: Option<bool>) -> bool {
    let (id, key) = (vault_id.to_string(), key.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let wanted = wanted.or_else(|| keys::is_remembered(&id).then_some(true));
        keys::apply_remember(&id, &key, wanted)
    })
    .await
    .unwrap_or(false)
}

/// Encrypts an existing plain vault and unlocks it. Closes the vault's pools
/// first: the export reads the database file itself.
#[tauri::command]
pub async fn vault_encrypt_existing(
    app: tauri::AppHandle,
    vault_id: String,
    password: zeroize::Zeroizing<String>,
    remember_key: Option<bool>,
) -> Result<keys::CreatedKey, String> {
    use tauri::Manager;
    let _guard = RUNNING.lock().await;
    let dir = vault::vault_dir(&app, &vault_id)?;
    vault::directory_state(&dir)?;
    crate::db::close_vault(&app, &vault_id).await;
    let (vault_key, recovery_key) = encrypt_dir(&dir, &password, keys::DEFAULT_KDF).await?;
    let remembered = remember_new(&vault_id, &vault_key, remember_key).await;
    app.state::<keys::VaultKeys>().insert(&vault_id, vault_key);
    Ok(keys::CreatedKey { recovery_key, remembered })
}

/// Changes the password: checks the current one, then re-encrypts the vault
/// under a new vault key with a new recovery key. A remembered key is
/// replaced by the new one. The vault's pools are closed for the run; the
/// frontend reopens them.
#[tauri::command]
pub async fn vault_change_password(
    app: tauri::AppHandle,
    vault_id: String,
    current_password: zeroize::Zeroizing<String>,
    new_password: zeroize::Zeroizing<String>,
) -> Result<keys::CreatedKey, String> {
    use tauri::Manager;
    let _guard = RUNNING.lock().await;
    let dir = vault::vault_dir(&app, &vault_id)?;
    let old_key = {
        let dir = dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let file = keys::read_key_file(&dir)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
            file.unlock_with_password(&current_password)
        })
        .await
        .map_err(|e| e.to_string())??
    };
    // Erst das neue Passwort prüfen, bevor irgendetwas geschlossen wird.
    keys::check_password(&new_password)?;
    crate::db::close_vault(&app, &vault_id).await;
    let (vault_key, recovery_key) = rekey_dir(&dir, &old_key, &new_password, keys::DEFAULT_KDF).await?;
    let remembered = remember_new(&vault_id, &vault_key, None).await;
    app.state::<keys::VaultKeys>().insert(&vault_id, vault_key);
    Ok(keys::CreatedKey { recovery_key, remembered })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nnot really a png";

    fn plain_name(bytes: &[u8], ext: &str) -> String {
        format!("{:x}.{ext}", Sha256::digest(bytes))
    }

    /// A plain vault: a database whose content and a column refer to an
    /// image, the image itself, drafts, and a migration backup.
    async fn plain_vault() -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("emerald-enc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join(vault::IMAGES_SUBDIR)).unwrap();
        let image = plain_name(PNG, "png");
        std::fs::write(dir.join(vault::IMAGES_SUBDIR).join(&image), PNG).unwrap();

        let options = SqliteConnectOptions::new().filename(dir.join(vault::DB_FILE)).create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        conn.execute("CREATE TABLE entries (id TEXT PRIMARY KEY, content TEXT, cover TEXT, n INTEGER)").await.unwrap();
        conn.execute("CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT)").await.unwrap();
        sqlx::query("INSERT INTO entries VALUES ('e1', ?, ?, 7)")
            .bind(format!("<p>GEHEIM-MIGRATION</p><img src=\"{image}\"><img src=\"{image}\">"))
            .bind(image.clone())
            .execute(&mut conn)
            .await
            .unwrap();
        conn.execute("INSERT INTO entries VALUES ('e2', 'no image', NULL, 1)").await.unwrap();
        conn.execute("INSERT INTO tags VALUES ('t1', 'Ritual')").await.unwrap();
        conn.close().await.unwrap();

        std::fs::write(dir.join(vault::DRAFTS_FILE), format!("{{\"img\":\"{image}\",\"text\":\"GEHEIM-ENTWURF\"}}")).unwrap();
        std::fs::copy(dir.join(vault::DB_FILE), dir.join("emerald.db.pre-v50.bak")).unwrap();
        (dir, image)
    }

    fn contains(file: &Path, needle: &str) -> bool {
        std::fs::read(file).unwrap().windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    fn stored_images(dir: &Path) -> Vec<String> {
        image_names(&dir.join(vault::IMAGES_SUBDIR))
    }

    /// The cover column of e1, opened under `vault_key`.
    async fn cover(dir: &Path, vault_key: &Key) -> Result<String, String> {
        let db_key = crypto::subkey(vault_key, Purpose::Database);
        let mut conn = open_keyed(&dir.join(vault::DB_FILE), &db_key).await?;
        let cover = conn
            .fetch_one("SELECT cover FROM entries WHERE id = 'e1'")
            .await
            .map_err(|e| e.to_string())?
            .get(0);
        conn.close().await.ok();
        Ok(cover)
    }

    fn assert_no_leftovers(dir: &Path) {
        let names: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        for leftover in [MARKER, PENDING_KEY, DB_NEW, DB_OLD, DRAFTS_NEW, IMAGES_NEW, "emerald.db.pre-v50.bak"] {
            assert!(!names.iter().any(|n| n == leftover), "{leftover} left behind: {names:?}");
        }
    }

    #[tokio::test]
    async fn a_plain_vault_ends_up_fully_encrypted() {
        let (dir, image) = plain_vault().await;
        let (vault_key, recovery) = encrypt_dir(&dir, "correct horse", TEST_KDF).await.unwrap();

        // vault.key opens with password and recovery key alike.
        let file = keys::read_key_file(&dir).unwrap().unwrap();
        assert!(file.accepts(&vault_key));
        assert_eq!(*file.unlock_with_recovery_key(&recovery).unwrap(), *vault_key);

        // Nothing plain is left.
        assert_no_leftovers(&dir);
        assert!(!contains(&dir.join(vault::DB_FILE), "GEHEIM-MIGRATION"));
        assert!(!contains(&dir.join(vault::DRAFTS_FILE), "GEHEIM-ENTWURF"));
        let stored = stored_images(&dir);
        assert_eq!(stored.len(), 1);
        let new_name = &stored[0];
        assert_ne!(new_name, &image, "image kept its plain hash name");
        assert!(crypto::is_sealed(&std::fs::read(dir.join(vault::IMAGES_SUBDIR).join(new_name)).unwrap()));

        // The database opens with the key, and every reference follows the image.
        let db_key = crypto::subkey(&vault_key, Purpose::Database);
        let mut conn = open_keyed(&dir.join(vault::DB_FILE), &db_key).await.unwrap();
        let row = conn.fetch_one("SELECT content, cover, n FROM entries WHERE id = 'e1'").await.unwrap();
        let content: String = row.get(0);
        let cover: String = row.get(1);
        assert_eq!(content.matches(new_name.as_str()).count(), 2);
        assert!(!content.contains(&image));
        assert_eq!(&cover, new_name);
        assert_eq!(row.get::<i64, _>(2), 7);
        let tags: i64 = conn.fetch_one("SELECT COUNT(*) FROM tags").await.unwrap().get(0);
        assert_eq!(tags, 1);
        conn.close().await.unwrap();

        // Drafts follow too.
        let files_key = crypto::subkey(&vault_key, Purpose::Files);
        let drafts = crypto::open(&files_key, Context::Drafts, &std::fs::read(dir.join(vault::DRAFTS_FILE)).unwrap()).unwrap();
        let drafts = String::from_utf8(drafts.to_vec()).unwrap();
        assert!(drafts.contains(new_name.as_str()) && drafts.contains("GEHEIM-ENTWURF"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_new_password_means_a_new_key_for_everything() {
        let (dir, _) = plain_vault().await;
        let (old_key, old_recovery) = encrypt_dir(&dir, "correct horse", TEST_KDF).await.unwrap();
        let old_file = keys::read_key_file(&dir).unwrap().unwrap();
        let old_image = stored_images(&dir).remove(0);

        let (new_key, new_recovery) = rekey_dir(&dir, &old_key, "battery staple", TEST_KDF).await.unwrap();
        assert_ne!(*new_key, *old_key);
        assert_no_leftovers(&dir);

        // The old vault.key — say, from cloud history — no longer opens anything.
        assert!(cover(&dir, &old_file.unlock_with_password("correct horse").unwrap()).await.is_err());
        let file = keys::read_key_file(&dir).unwrap().unwrap();
        assert!(file.unlock_with_password("correct horse").is_err());
        assert!(file.unlock_with_recovery_key(&old_recovery).is_err());
        assert_eq!(*file.unlock_with_recovery_key(&new_recovery).unwrap(), *new_key);

        // Images moved to new names, references with them, drafts resealed.
        let images = stored_images(&dir);
        assert_eq!(images.len(), 1);
        assert_ne!(images[0], old_image);
        assert_eq!(cover(&dir, &new_key).await.unwrap(), images[0]);
        let files_key = crypto::subkey(&new_key, Purpose::Files);
        let drafts = crypto::open(&files_key, Context::Drafts, &std::fs::read(dir.join(vault::DRAFTS_FILE)).unwrap()).unwrap();
        assert!(String::from_utf8(drafts.to_vec()).unwrap().contains(images[0].as_str()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_crash_before_the_commit_leaves_the_original() {
        let (dir, image) = plain_vault().await;
        let (file, new_key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        vault::write_atomic(&dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes()).unwrap();
        prepare(&dir, Source::Plain, &new_key).await.unwrap();
        // Absturz hier: kein Marker. Beim nächsten Öffnen wird aufgeräumt.
        recover_interrupted(&dir).unwrap();
        assert!(!keys::is_encrypted_dir(&dir));
        assert_no_leftovers_except_backup(&dir);
        assert_eq!(stored_images(&dir), vec![image]);
        assert!(contains(&dir.join(vault::DB_FILE), "GEHEIM-MIGRATION"));
        // Und es lässt sich danach ganz normal verschlüsseln.
        encrypt_dir(&dir, "correct horse", TEST_KDF).await.unwrap();
        assert!(keys::is_encrypted_dir(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn assert_no_leftovers_except_backup(dir: &Path) {
        for leftover in [MARKER, PENDING_KEY, DB_NEW, DRAFTS_NEW, IMAGES_NEW] {
            assert!(!dir.join(leftover).exists(), "{leftover} left behind");
        }
    }

    #[tokio::test]
    async fn a_crash_during_the_commit_is_finished_on_recovery() {
        let (dir, _) = plain_vault().await;
        let (file, new_key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        vault::write_atomic(&dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes()).unwrap();
        let keep = prepare(&dir, Source::Plain, &new_key).await.unwrap();
        vault::write_atomic(&dir, MARKER, MARKER_TEMP, serde_json::to_string(&keep).unwrap().as_bytes()).unwrap();
        // Absturz mitten im Tausch: die Datenbank ist schon beiseite gelegt.
        std::fs::rename(dir.join(vault::DB_FILE), dir.join(DB_OLD)).unwrap();
        recover_interrupted(&dir).unwrap();
        assert!(keys::read_key_file(&dir).unwrap().unwrap().accepts(&new_key));
        assert_no_leftovers(&dir);
        assert_eq!(stored_images(&dir), keep);
        assert_eq!(cover(&dir, &new_key).await.unwrap(), keep[0]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn image_names_are_rewritten_only_where_whole() {
        let old = format!("{}.png", "a".repeat(64));
        let new = format!("{}.png", "b".repeat(64));
        let map = HashMap::from([(old.clone(), new.clone())]);
        assert_eq!(rewrite_image_names(&format!("src=\"{old}\" x {old}"), &map), Some(format!("src=\"{new}\" x {new}")));
        // Längere Hex-Folgen, andere Endungen und unbekannte Namen bleiben.
        assert_eq!(rewrite_image_names(&format!("f{old}"), &map), None);
        assert_eq!(rewrite_image_names(&format!("{}.pngx", "a".repeat(64)), &map), None);
        assert_eq!(rewrite_image_names(&format!("{}.png", "c".repeat(64)), &map), None);
        assert_eq!(rewrite_image_names("nothing here", &map), None);
    }
}
