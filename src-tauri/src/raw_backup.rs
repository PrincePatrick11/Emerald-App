//! Raw backups: a vault's files as they lie on the disk, packed into a
//! `.vault.emerald` of the kind `raw` (`emerald_file.rs`) — the database, its
//! `vault.key`, its settings, its pictures and icons. Everything in it is
//! encrypted already, so no password is asked when one is written; it opens
//! only with that vault's password or recovery key.
//!
//! What goes in is never a half-written state:
//!
//! - **Open vault** (its key is in memory): the database is copied with
//!   `VACUUM INTO` on a connection of its own — a read transaction, so the
//!   copy is one consistent state while the app goes on writing. SQLCipher
//!   writes the copy under the same key. The copy lies beside the database
//!   (`emerald.db.snapshot`) until it is packed, and goes afterwards.
//! - **Closed vault**: nothing can write without the key, so the database is
//!   packed as it lies. Should the vault be unlocked and changed meanwhile,
//!   the size or time of the database, its journal or its `vault.key` differ
//!   afterwards, and the backup is thrown away before it comes into place
//!   ([`BUSY`]: the scheduler tries again).
//!
//! Database first, pictures after: a picture the copy names was stored before
//! it. A re-encryption (password change) and the deletion of a vault's files
//! wait for a running backup, and a backup for them (`reencrypt::RUNNING`).
//! The vault's own `backups/` folder is never packed.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Executor};
use tauri::Manager;

use crate::crypto::{self, Key, Purpose};
use crate::emerald_file::{self, RawContents, RawMember, RAW_JOURNAL};
use crate::images::{self, Store};
use crate::keys::{self, KeyFile};
use crate::vault;

/// The vault changed while it was copied, or a re-encryption is running: try again.
pub const BUSY: &str = "RAW_BACKUP_BUSY";
/// A password change of the vault was cut short; it finishes when the vault is opened.
pub const INTERRUPTED: &str = "RAW_BACKUP_INTERRUPTED";

/// Size and time of a file — `None` while there is none.
fn stamp(path: &Path) -> Option<(u64, Option<SystemTime>)> {
    let md = std::fs::symlink_metadata(path).ok()?;
    md.is_file().then(|| (md.len(), md.modified().ok()))
}

/// What a closed vault's copy must find unchanged afterwards.
#[derive(PartialEq, Debug)]
struct Fingerprint {
    database: Option<(u64, Option<SystemTime>)>,
    journal: Option<(u64, Option<SystemTime>)>,
    key_file: Vec<u8>,
}

fn fingerprint(dir: &Path) -> Fingerprint {
    Fingerprint {
        database: stamp(&dir.join(vault::DB_FILE)),
        journal: stamp(&dir.join(RAW_JOURNAL)),
        key_file: std::fs::read(dir.join(keys::KEY_FILE)).unwrap_or_default(),
    }
}

/// The pictures and icons in the vault's folders: regular files under names
/// of this app, nothing else.
fn pictures(dir: &Path) -> Vec<(Store, String, PathBuf)> {
    let mut found = Vec::new();
    for store in [Store::Images, Store::Icons] {
        let Ok(entries) = std::fs::read_dir(dir.join(store.subdir())) else { continue };
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
            if images::is_valid_image_name(&name) && entry.file_type().is_ok_and(|t| t.is_file()) {
                found.push((store, name, entry.path()));
            }
        }
    }
    found.sort_by(|a, b| a.1.cmp(&b.1));
    found
}

/// The vault's own files for the archive, the database from `database`.
fn vault_files(dir: &Path, database: PathBuf, with_journal: bool) -> Vec<(RawMember, PathBuf)> {
    let mut files = vec![(RawMember::Database, database), (RawMember::KeyFile, dir.join(keys::KEY_FILE))];
    if with_journal && stamp(&dir.join(RAW_JOURNAL)).is_some() {
        files.push((RawMember::Journal, dir.join(RAW_JOURNAL)));
    }
    // A settings file as the app reads one: regular, not oversized.
    let settings = dir.join(vault::SETTINGS_FILE);
    if stamp(&settings).is_some_and(|(len, _)| len <= vault::SETTINGS_MAX_BYTES) {
        files.push((RawMember::Settings, settings));
    }
    files
}

fn manifest(vault_id: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "format": "emerald",
        "version": emerald_file::FORMAT_VERSION,
        "kind": "raw",
        "vaultId": vault_id,
        "createdAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
    .expect("serialisable")
}

fn sql_string(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

/// `VACUUM INTO` the snapshot file, on a connection of its own under the
/// vault's database key. Read-only: the copy is all it does.
async fn snapshot(dir: &Path, vault_key: &Key) -> Result<PathBuf, String> {
    let target = dir.join(vault::SNAPSHOT_FILE);
    emerald_file::remove_sqlite_files(dir, vault::SNAPSHOT_FILE);
    // `VACUUM INTO` refuses a target that is there; one a virus scanner or a
    // sync client still holds is gone in a while.
    if target.exists() {
        return Err(BUSY.into());
    }
    let key = crypto::subkey(vault_key, Purpose::Database);
    let result = async {
        let mut conn = SqliteConnectOptions::new()
            .filename(dir.join(vault::DB_FILE))
            .read_only(true)
            .disable_statement_logging()
            .pragma("key", crate::db::sqlcipher_key(&key).to_string())
            .connect()
            .await
            .map_err(|e| e.to_string())?;
        let done = conn.execute(format!("VACUUM INTO {}", sql_string(&target)).as_str()).await.map(|_| ()).map_err(|e| e.to_string());
        conn.close().await.ok();
        done
    }
    .await;
    match result {
        Ok(()) => Ok(target),
        Err(e) => {
            emerald_file::remove_sqlite_files(dir, vault::SNAPSHOT_FILE);
            Err(e)
        }
    }
}

/// Writes a raw backup of the vault in `dir` to `target`. `vault_key` is the
/// vault's key when it is unlocked — then the database is snapshotted;
/// without it the files are packed as they lie, checked afterwards.
/// `still_closed` says whether the vault's database is still not open.
pub(crate) async fn write(
    dir: &Path,
    vault_id: &str,
    vault_key: Option<&Key>,
    target: &Path,
    still_closed: impl Fn() -> bool + Send + 'static,
) -> Result<(), String> {
    // A password change swaps database and `vault.key`: never in the middle of it.
    let Ok(_running) = crate::reencrypt::RUNNING.try_lock() else {
        return Err(BUSY.into());
    };
    write_unguarded(dir, vault_id, vault_key, target, still_closed).await
}

/// [`write`] without the wait for re-encryptions — for the tests, which run
/// beside those of `reencrypt.rs`.
async fn write_unguarded(
    dir: &Path,
    vault_id: &str,
    vault_key: Option<&Key>,
    target: &Path,
    still_closed: impl Fn() -> bool + Send + 'static,
) -> Result<(), String> {
    vault::directory_state(dir)?;
    // A password change cut short: database and `vault.key` may not belong
    // together until the vault is opened and the change finished. Such a
    // backup could never be restored — and would push good ones out.
    if crate::reencrypt::interrupted(dir) {
        return Err(INTERRUPTED.into());
    }
    let key_file_text = std::fs::read_to_string(dir.join(keys::KEY_FILE)).map_err(|_| keys::VAULT_NOT_ENCRYPTED.to_string())?;
    let key_file = KeyFile::from_json(&key_file_text)?;
    let manifest = manifest(vault_id);
    let target = target.to_path_buf();

    match vault_key.filter(|key| key_file.accepts(key)) {
        Some(key) => {
            let database = snapshot(dir, key).await?;
            let (dir, files) = (dir.to_path_buf(), vault_files(dir, database, false));
            tauri::async_runtime::spawn_blocking(move || {
                let pictures = pictures(&dir);
                let done = emerald_file::place_raw(&target, RawContents { key_file, manifest, files, pictures }, || Ok(()));
                emerald_file::remove_sqlite_files(&dir, vault::SNAPSHOT_FILE);
                done
            })
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            let dir = dir.to_path_buf();
            tauri::async_runtime::spawn_blocking(move || {
                let before = fingerprint(&dir);
                if before.database.is_none() {
                    return Err(format!("no database in {}", dir.display()));
                }
                let files = vault_files(&dir, dir.join(vault::DB_FILE), true);
                let pictures = pictures(&dir);
                let unchanged = || {
                    if still_closed() && fingerprint(&dir) == before {
                        Ok(())
                    } else {
                        Err(BUSY.to_string())
                    }
                };
                emerald_file::place_raw(&target, RawContents { key_file, manifest, files, pictures }, unchanged)
            })
            .await
            .map_err(|e| e.to_string())?
        }
    }
}

/// The key of an unlocked vault, if it is.
pub(crate) fn key_in_memory(app: &tauri::AppHandle, vault_id: &str) -> Option<Key> {
    app.state::<keys::VaultKeys>().get(vault_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KdfParams;
    use sqlx::sqlite::SqliteConnection;
    use sqlx::Row;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch() -> PathBuf {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("emerald-raw-backup-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn open_db(path: &Path, key: &Key, create: bool) -> SqliteConnection {
        let key = crypto::subkey(key, Purpose::Database);
        SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(create)
            .pragma("key", crate::db::sqlcipher_key(&key).to_string())
            .pragma("journal_mode", "DELETE")
            .connect()
            .await
            .unwrap()
    }

    /// An encrypted vault folder: a database with `rows` notes, its key file,
    /// settings, a sealed picture and a backup in `backups/` that must stay out.
    async fn vault(rows: usize) -> (PathBuf, Key) {
        let dir = scratch();
        let (key_file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        std::fs::write(dir.join(keys::KEY_FILE), key_file.to_json()).unwrap();
        std::fs::write(dir.join(vault::SETTINGS_FILE), r#"{"theme":"x"}"#).unwrap();
        let mut db = open_db(&dir.join(vault::DB_FILE), &key, true).await;
        db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)").await.unwrap();
        for i in 0..rows {
            sqlx::query("INSERT INTO notes (text) VALUES (?)").bind(format!("note {i}")).execute(&mut db).await.unwrap();
        }
        db.close().await.unwrap();
        std::fs::create_dir_all(dir.join(vault::IMAGES_SUBDIR)).unwrap();
        let (name, sealed) = images::seal_for_vault(&key, Store::Images, b"png bytes", "png");
        std::fs::write(dir.join(vault::IMAGES_SUBDIR).join(name), sealed).unwrap();
        std::fs::create_dir_all(dir.join(vault::BACKUP_SUBDIR)).unwrap();
        std::fs::write(dir.join(vault::BACKUP_SUBDIR).join("old.vault.emerald"), b"older backup").unwrap();
        (dir, key)
    }

    /// The backup's members by name, and its database's notes as read under the key.
    async fn unpack(backup: &Path, key: &Key) -> (Vec<String>, i64) {
        let bytes = std::fs::read(backup).unwrap();
        let start = 4 + 1 + 4 + u32::from_le_bytes(bytes[5..9].try_into().unwrap()) as usize;
        let header: serde_json::Value = serde_json::from_slice(&bytes[9..start]).unwrap();
        assert_eq!(header["kind"], "raw");
        assert_eq!(header["protection"]["type"], "none");
        assert!(KeyFile::from_json(&header["keyFile"].to_string()).unwrap().accepts(key));
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes[start..].to_vec())).unwrap();
        let names: Vec<String> = zip.file_names().map(str::to_string).collect();
        let out = scratch().join("restored.db");
        std::io::copy(&mut zip.by_name(vault::DB_FILE).unwrap(), &mut std::fs::File::create(&out).unwrap()).unwrap();
        let mut db = open_db(&out, key, false).await;
        let count: i64 = sqlx::query("SELECT count(*) AS n FROM notes").fetch_one(&mut db).await.unwrap().get("n");
        db.close().await.unwrap();
        (names, count)
    }

    #[tokio::test]
    async fn a_closed_vault_is_packed_as_it_lies() {
        let (dir, key) = vault(25).await;
        let target = scratch().join("closed.vault.emerald");
        write_unguarded(&dir, "v1", None, &target, || true).await.unwrap();
        let (names, count) = unpack(&target, &key).await;
        assert_eq!(count, 25);
        for name in ["manifest.json", "emerald.db", "vault.key", "settings.json"] {
            assert!(names.iter().any(|n| n == name), "{name} in {names:?}");
        }
        assert!(names.iter().any(|n| n.starts_with("images/")));
        assert!(!names.iter().any(|n| n.contains("backups") || n.contains("old.vault")), "{names:?}");
    }

    #[tokio::test]
    async fn an_open_vault_is_snapshotted_while_it_is_written() {
        let (dir, key) = vault(200).await;
        // Another connection writes all along — as the app does.
        let writer_dir = dir.clone();
        let writer_key = key.clone();
        let writer = tokio::spawn(async move {
            let mut db = open_db(&writer_dir.join(vault::DB_FILE), &writer_key, false).await;
            // Every write goes through: the copy only reads, and SQLite's
            // busy wait covers the moment it holds its read lock.
            for i in 0..300 {
                sqlx::query("INSERT INTO notes (text) VALUES (?)").bind(format!("later {i}")).execute(&mut db).await.unwrap();
            }
            db.close().await.unwrap();
        });
        let target = scratch().join("open.vault.emerald");
        write_unguarded(&dir, "v1", Some(&key), &target, || false).await.unwrap();
        writer.await.unwrap();
        let (names, count) = unpack(&target, &key).await;
        // One state of the database: never fewer than at the start, never more than at the end.
        assert!((200..=500).contains(&count), "{count}");
        assert!(names.iter().any(|n| n == "emerald.db"));
        assert!(!dir.join(vault::SNAPSHOT_FILE).exists(), "the snapshot is gone");
    }

    #[tokio::test]
    async fn a_closed_vault_changed_during_the_copy_is_not_placed() {
        let (dir, _) = vault(3).await;
        let target = scratch().join("changed.vault.emerald");
        let err = write_unguarded(&dir, "v1", None, &target, || false).await.unwrap_err();
        assert_eq!(err, BUSY);
        assert!(!target.exists());
    }

    #[tokio::test]
    async fn a_vault_with_a_password_change_cut_short_is_not_packed() {
        let (dir, _) = vault(1).await;
        std::fs::write(dir.join("vault.reencrypting"), b"{}").unwrap();
        let target = scratch().join("interrupted.vault.emerald");
        assert_eq!(write_unguarded(&dir, "v1", None, &target, || true).await.unwrap_err(), INTERRUPTED);
        assert!(!target.exists());
    }

    #[tokio::test]
    async fn a_running_reencryption_is_waited_for() {
        let (dir, _) = vault(1).await;
        let target = scratch().join("busy.vault.emerald");
        let _running = crate::reencrypt::RUNNING.lock().await;
        assert_eq!(write(&dir, "v1", None, &target, || true).await.unwrap_err(), BUSY);
    }
}
