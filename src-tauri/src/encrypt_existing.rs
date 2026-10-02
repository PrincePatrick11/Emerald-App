//! Encrypting a vault that was created before encryption existed.
//!
//! Nothing in the vault is touched until a complete, checked encrypted copy
//! sits next to it. In order:
//!
//! 1. **Prepare** — `vault.key.pending`, the database exported into
//!    `emerald.db.encrypting` (`sqlcipher_export`), every plain image sealed
//!    under its new keyed name next to the old file, every image name inside
//!    the copy rewritten, `drafts.json.encrypting`. Then the copy is checked:
//!    `integrity_check`, and the same row count in every table as the
//!    original.
//! 2. **Commit** — the marker `vault.encrypting` is written, then the files
//!    are swapped in: database, `vault.key`, drafts.
//! 3. **Clean up** — the plain database, its migration backups, the import
//!    staging copy and the plain images are deleted, then the marker.
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
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use crate::crypto::{self, Context, Key, Purpose};
use crate::keys::{self, KdfParams, KeyFile};
use crate::{images, vault};

const MARKER: &str = "vault.encrypting";
const MARKER_TEMP: &str = "vault.encrypting.tmp";
const PENDING_KEY: &str = "vault.key.pending";
const PENDING_KEY_TEMP: &str = "vault.key.pending.tmp";
const DB_ENCRYPTING: &str = "emerald.db.encrypting";
const DB_PLAIN: &str = "emerald.db.plain";
const DRAFTS_ENCRYPTING: &str = "drafts.json.encrypting";
const DRAFTS_ENCRYPTING_TEMP: &str = "drafts.json.encrypting.tmp";

/// SQLite's companions of a database file.
const DB_SIDE_FILES: [&str; 3] = ["-journal", "-wal", "-shm"];

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

/// Every image file in the vault, with whether it is sealed.
fn image_files(dir: &Path) -> Vec<(String, bool)> {
    let Ok(entries) = std::fs::read_dir(dir.join(vault::IMAGES_SUBDIR)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if !images::is_valid_image_name(&name) || !entry.file_type().ok()?.is_file() {
                return None;
            }
            // Nur der Kopf: ob versiegelt, steht in den ersten Bytes.
            let file = std::fs::File::open(entry.path()).ok()?;
            let mut head = Vec::with_capacity(crypto::HEADER_LEN);
            file.take(crypto::HEADER_LEN as u64).read_to_end(&mut head).ok()?;
            Some((name, crypto::is_sealed(&head)))
        })
        .collect()
}

fn remove_images(dir: &Path, sealed: bool) {
    for (name, is_sealed) in image_files(dir) {
        if is_sealed == sealed {
            std::fs::remove_file(dir.join(vault::IMAGES_SUBDIR).join(name)).ok();
        }
    }
}

/// Brings a vault directory back to a consistent state after a crash during
/// [`encrypt_dir`]. Cheap when there is nothing to do.
pub fn recover_interrupted(dir: &Path) -> Result<(), String> {
    if dir.join(MARKER).exists() {
        finish_commit(dir)
    } else {
        // Nur aufräumen, was Schritt 1 angelegt haben kann. Versiegelte
        // Bilder gibt es in einem Vault ohne `vault.key` sonst nicht.
        if dir.join(PENDING_KEY).exists() || dir.join(DB_ENCRYPTING).exists() {
            remove_db_file(dir, DB_ENCRYPTING);
            for name in [PENDING_KEY, PENDING_KEY_TEMP, DRAFTS_ENCRYPTING, DRAFTS_ENCRYPTING_TEMP] {
                std::fs::remove_file(dir.join(name)).ok();
            }
            if !keys::is_encrypted_dir(dir) {
                remove_images(dir, true);
            }
        }
        Ok(())
    }
}

/// Steps 2 and 3. Each one checks what is still to do, so a second run after
/// a crash picks up where the first stopped.
fn finish_commit(dir: &Path) -> Result<(), String> {
    if dir.join(DB_ENCRYPTING).exists() {
        if dir.join(vault::DB_FILE).exists() && !dir.join(DB_PLAIN).exists() {
            rename_if_present(dir, vault::DB_FILE, DB_PLAIN)?;
        }
        remove_db_file(dir, vault::DB_FILE);
        rename_if_present(dir, DB_ENCRYPTING, vault::DB_FILE)?;
    }
    rename_if_present(dir, PENDING_KEY, keys::KEY_FILE)?;
    rename_if_present(dir, DRAFTS_ENCRYPTING, vault::DRAFTS_FILE)?;

    // Ab hier ist der Vault verschlüsselt; was folgt, ist Klartext, der weg muss.
    remove_db_file(dir, DB_PLAIN);
    remove_db_file(dir, vault::IMPORT_STAGING_FILE);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_str().and_then(vault::migration_backup_version).is_some() {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }
    remove_images(dir, false);
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

/// The plain database, for the export. `create_if_missing` although it exists
/// (checked before): an `ATTACH` inherits the connection's open flags, and
/// without it SQLite would not create the encrypted copy.
async fn open_plain(file: &Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(true)
        .disable_statement_logging();
    SqliteConnection::connect_with(&options).await.map_err(|e| e.to_string())
}

async fn open_keyed(file: &Path, key: &Key) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(file)
        .disable_statement_logging()
        .pragma("key", crate::db::sqlcipher_key(key).to_string());
    SqliteConnection::connect_with(&options).await.map_err(|e| e.to_string())
}

/// Step 1: everything next to the vault, nothing in it.
async fn prepare(dir: &Path, vault_key: &Key) -> Result<(), String> {
    let db_key = crypto::subkey(vault_key, Purpose::Database);

    // Die Datenbank.
    let plain_file = dir.join(vault::DB_FILE);
    let encrypted_file = dir.join(DB_ENCRYPTING);
    let mut plain = open_plain(&plain_file).await?;
    let attach = format!(
        "ATTACH DATABASE {} AS encrypted KEY {}",
        quote_str(&encrypted_file.to_string_lossy()),
        crate::db::sqlcipher_key(&db_key).as_str()
    );
    plain.execute(attach.as_str()).await.map_err(|e| e.to_string())?;
    plain
        .execute("SELECT sqlcipher_export('encrypted')")
        .await
        .map_err(|e| e.to_string())?;
    plain.execute("DETACH DATABASE encrypted").await.map_err(|e| e.to_string())?;
    let expected = row_counts(&mut plain).await?;
    plain.close().await.map_err(|e| e.to_string())?;

    // Die Bilder: versiegelt unter neuem Namen neben die alten.
    let mut renamed = HashMap::new();
    let images_dir = dir.join(vault::IMAGES_SUBDIR);
    for (name, sealed) in image_files(dir) {
        if sealed {
            continue;
        }
        let bytes = std::fs::read(images_dir.join(&name)).map_err(|e| format!("read {name}: {e}"))?;
        let ext = name.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("png");
        let (new_name, contents) = images::seal_for_vault(vault_key, &bytes, ext);
        let target = images_dir.join(&new_name);
        if !target.exists() {
            std::fs::write(&target, contents).map_err(|e| format!("write {new_name}: {e}"))?;
        }
        renamed.insert(name, new_name);
    }

    // Die Verweise in der Kopie, dann die Prüfung.
    let mut encrypted = open_keyed(&encrypted_file, &db_key).await?;
    rewrite_database(&mut encrypted, &renamed).await?;
    let check: String = encrypted
        .fetch_one("PRAGMA integrity_check")
        .await
        .map_err(|e| e.to_string())?
        .get(0);
    if check != "ok" {
        return Err(format!("encrypted copy failed its integrity check: {check}"));
    }
    let actual = row_counts(&mut encrypted).await?;
    encrypted.close().await.map_err(|e| e.to_string())?;
    if actual != expected {
        return Err("encrypted copy does not match the original".into());
    }

    // Die Entwürfe.
    let drafts = dir.join(vault::DRAFTS_FILE);
    if drafts.is_file() {
        let text = std::fs::read_to_string(&drafts).map_err(|e| format!("read drafts: {e}"))?;
        let text = rewrite_image_names(&text, &renamed).unwrap_or(text);
        let files_key = crypto::subkey(vault_key, Purpose::Files);
        let sealed = crypto::seal(&files_key, Context::Drafts, text.as_bytes());
        vault::write_atomic(dir, DRAFTS_ENCRYPTING, DRAFTS_ENCRYPTING_TEMP, &sealed)?;
    }
    Ok(())
}

/// Encrypts an existing plain vault in `dir`. Returns the new key file, the
/// vault key and the recovery key for display.
pub async fn encrypt_dir(dir: &Path, password: &str, kdf: KdfParams) -> Result<(Key, zeroize::Zeroizing<String>), String> {
    recover_interrupted(dir)?;
    if keys::is_encrypted_dir(dir) {
        return Err(keys::VAULT_ALREADY_ENCRYPTED.into());
    }
    if !dir.join(vault::DB_FILE).is_file() {
        return Err("no database to encrypt".into());
    }
    let (file, vault_key, recovery) = KeyFile::create(password, kdf)?;
    vault::write_atomic(dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes())?;

    if let Err(e) = prepare(dir, &vault_key).await {
        recover_interrupted(dir).ok();
        return Err(e);
    }

    vault::write_atomic(dir, MARKER, MARKER_TEMP, b"commit")?;
    finish_commit(dir)?;
    Ok((vault_key, recovery))
}

/// One migration at a time — across awaits, so not the `std` mutex.
static ENCRYPTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    let _guard = ENCRYPTING.lock().await;
    let dir = vault::vault_dir(&app, &vault_id)?;
    vault::directory_state(&dir)?;
    crate::db::close_vault(&app, &vault_id).await;
    let (vault_key, recovery_key) = encrypt_dir(&dir, &password, keys::DEFAULT_KDF).await?;
    let remembered = {
        let (id, key) = (vault_id.clone(), vault_key.clone());
        tauri::async_runtime::spawn_blocking(move || keys::apply_remember(&id, &key, remember_key))
            .await
            .unwrap_or(false)
    };
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

    #[tokio::test]
    async fn a_plain_vault_ends_up_fully_encrypted() {
        let (dir, image) = plain_vault().await;
        let (vault_key, recovery) = encrypt_dir(&dir, "correct horse", TEST_KDF).await.unwrap();

        // vault.key opens with password and recovery key alike.
        let file = keys::read_key_file(&dir).unwrap().unwrap();
        assert!(file.accepts(&vault_key));
        assert_eq!(*file.unlock_with_recovery_key(&recovery).unwrap(), *vault_key);

        // Nothing plain is left.
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        for leftover in [MARKER, PENDING_KEY, DB_ENCRYPTING, DB_PLAIN, DRAFTS_ENCRYPTING, "emerald.db.pre-v50.bak"] {
            assert!(!names.iter().any(|n| n == leftover), "{leftover} left behind: {names:?}");
        }
        assert!(!contains(&dir.join(vault::DB_FILE), "GEHEIM-MIGRATION"));
        assert!(!contains(&dir.join(vault::DRAFTS_FILE), "GEHEIM-ENTWURF"));
        let stored = image_files(&dir);
        assert_eq!(stored.len(), 1);
        let (new_name, sealed) = &stored[0];
        assert!(sealed);
        assert_ne!(new_name, &image, "image kept its plain hash name");

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
    async fn a_crash_before_the_commit_leaves_the_original() {
        let (dir, image) = plain_vault().await;
        let (file, vault_key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        vault::write_atomic(&dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes()).unwrap();
        prepare(&dir, &vault_key).await.unwrap();
        // Absturz hier: kein Marker. Beim nächsten Öffnen wird aufgeräumt.
        recover_interrupted(&dir).unwrap();
        assert!(!keys::is_encrypted_dir(&dir));
        assert!(!dir.join(DB_ENCRYPTING).exists() && !dir.join(PENDING_KEY).exists() && !dir.join(DRAFTS_ENCRYPTING).exists());
        assert_eq!(image_files(&dir), vec![(image, false)]);
        assert!(contains(&dir.join(vault::DB_FILE), "GEHEIM-MIGRATION"));
        // Und es lässt sich danach ganz normal verschlüsseln.
        encrypt_dir(&dir, "correct horse", TEST_KDF).await.unwrap();
        assert!(keys::is_encrypted_dir(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_crash_during_the_commit_is_finished_on_recovery() {
        let (dir, _) = plain_vault().await;
        let (file, vault_key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        vault::write_atomic(&dir, PENDING_KEY, PENDING_KEY_TEMP, file.to_json().as_bytes()).unwrap();
        prepare(&dir, &vault_key).await.unwrap();
        vault::write_atomic(&dir, MARKER, MARKER_TEMP, b"commit").unwrap();
        // Absturz mitten im Tausch: die Datenbank ist schon beiseite gelegt.
        std::fs::rename(dir.join(vault::DB_FILE), dir.join(DB_PLAIN)).unwrap();
        recover_interrupted(&dir).unwrap();
        assert!(keys::read_key_file(&dir).unwrap().unwrap().accepts(&vault_key));
        assert!(!dir.join(MARKER).exists() && !dir.join(DB_PLAIN).exists());
        let db_key = crypto::subkey(&vault_key, Purpose::Database);
        let mut conn = open_keyed(&dir.join(vault::DB_FILE), &db_key).await.unwrap();
        let n: i64 = conn.fetch_one("SELECT COUNT(*) FROM entries").await.unwrap().get(0);
        assert_eq!(n, 2);
        conn.close().await.unwrap();
        assert!(image_files(&dir).iter().all(|(_, sealed)| *sealed));
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
