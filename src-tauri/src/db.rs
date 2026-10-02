//! The SQLite connection pools the frontend runs its SQL through.
//!
//! This replaces `tauri-plugin-sql`. The plugin opened any `sqlite:` path the
//! webview named and offered no hook to key a connection, so it could not open
//! an encrypted vault. Here a database is named by vault id plus one of the
//! files that live in a vault ([`DbFile`]), never by path, and the connection
//! options are built in Rust.
//!
//! The query interface is the plugin's, kept on purpose: `execute` returns
//! `(rowsAffected, lastInsertId)`, `select` returns rows as JSON objects in
//! column order, and values bind and decode the way the plugin did them (see
//! [`bind_all`] and [`to_json`]). Hundreds of call sites rely on exactly that.
//! Like the plugin, each pool hands every statement to whichever connection is
//! free — a transaction only holds within a single `execute` string.
//!
//! An encrypted vault's databases open with a key derived from the vault key
//! as SQLCipher's raw key (`PRAGMA key = "x'…'"`), which sqlx runs first on
//! every connection of the pool. A locked vault does not open at all, and only
//! an encrypted vault may create a database: a plain one would have to exist
//! already.
//!
//! Every connection also gets an authorizer ([`authorize`]) that refuses
//! SQLCipher's key pragmas and `sqlcipher_export` — the webview runs arbitrary
//! SQL here, and those would let it re-key the vault out from under `vault.key`
//! or write a plaintext copy anywhere.

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use sqlx::query::Query;
use sqlx::sqlite::{Sqlite, SqliteArguments, SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteValueRef};
use sqlx::{Column, ConnectOptions, Executor, Row, TypeInfo, Value, ValueRef};
use std::collections::HashMap;
use std::path::Path;
use std::ffi::{c_char, c_int, c_void, CStr};
use tauri::Manager;
use tokio::sync::RwLock;
use zeroize::Zeroizing;

use crate::crypto::{self, Purpose};
use crate::{keys, vault};

/// The open pools, by handle (`{vaultId}/{file}`).
#[derive(Default)]
pub struct Databases(RwLock<HashMap<String, SqlitePool>>);

/// The database files a vault holds. The frontend names one of these; the
/// path comes from the vault registry.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DbFile {
    /// `emerald.db`
    Main,
    /// `emerald.db.import`, the working copy of a backup import.
    ImportStaging,
}

impl DbFile {
    fn name(self) -> &'static str {
        match self {
            DbFile::Main => vault::DB_FILE,
            DbFile::ImportStaging => vault::IMPORT_STAGING_FILE,
        }
    }
}

fn handle(vault_id: &str, file: DbFile) -> String {
    format!("{vault_id}/{}", file.name())
}

/// Opens (creating if needed) one of a vault's databases and returns the
/// handle the other commands take. Loading a handle that is already open
/// replaces its pool.
#[tauri::command]
pub async fn db_load(
    app: tauri::AppHandle,
    dbs: tauri::State<'_, Databases>,
    vault_id: String,
    file: DbFile,
) -> Result<String, String> {
    let dir = vault::vault_dir(&app, &vault_id)?;
    // Nur verschlüsselte Vaults: ein Vault ohne `vault.key` wird erst
    // verschlüsselt (`reencrypt.rs`), nie im Klartext geöffnet — auch
    // dann nicht, wenn jemand `vault.key` gelöscht und eine Klartext-Datenbank
    // untergeschoben hat.
    let vault_key = keys::key_for(&app, &vault_id)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
    // Der Schlüssel im Speicher muss zu diesem Ordner gehören: zeigt die Id
    // inzwischen woandershin, entstünde sonst eine Datenbank unter einem
    // Schlüssel, den dessen `vault.key` nicht kennt.
    if !keys::read_key_file(&dir)?.is_some_and(|file| file.accepts(&vault_key)) {
        return Err(keys::VAULT_LOCKED.to_string());
    }
    let key = crypto::subkey(&vault_key, Purpose::Database);
    let options = SqliteConnectOptions::new()
        .filename(dir.join(file.name()))
        .create_if_missing(true)
        .disable_statement_logging()
        .pragma("key", sqlcipher_key(&key).to_string())
        // SQLCipher entschlüsselt eine Seite, wenn sie in den Seiten-Cache
        // kommt. Mit SQLites 2 MB verdrängt ein Durchlauf über `entries` seine
        // eigenen Seiten, und jeder weitere entschlüsselt alles neu (gemessen:
        // 2000 Einträge 238 statt 40 ms). 32 MB pro Verbindung; belegt wird
        // nur, was gelesen wurde.
        .pragma("cache_size", "-32768");
    let pool = connect(options, &dir).await?;

    let handle = handle(&vault_id, file);
    let mut map = dbs.0.write().await;
    // Unter der Sperre noch einmal: ein `vault_lock` während des Verbindens
    // hat den Schlüssel entfernt, und dieser Pool überlebte es sonst.
    if app.state::<keys::VaultKeys>().get(&vault_id).is_none() {
        drop(map);
        pool.close().await;
        return Err(keys::VAULT_LOCKED.to_string());
    }
    let previous = map.insert(handle.clone(), pool);
    drop(map);
    // Im Hintergrund: `close` wartet, bis jede laufende Abfrage des alten
    // Pools fertig ist — nach einem Neuladen der Seite etwa das Nachladen
    // aller Einträge (`fetchEntries`, zweite Stufe). Der neue Pool braucht den
    // alten nicht zu, und wer die Dateien wirklich frei braucht, schließt
    // ausdrücklich (`db_close`, `close_vault`).
    if let Some(previous) = previous {
        tauri::async_runtime::spawn(async move { previous.close().await });
    }
    Ok(handle)
}

/// The vault folder an authorizer allows `ATTACH` in, as a lowercase string
/// with `/` separators. One leaked allocation per vault folder for the life
/// of the process — SQLite holds the pointer as long as a connection lives.
fn attach_scope(dir: &Path) -> &'static String {
    static SCOPES: std::sync::Mutex<Vec<&'static String>> = std::sync::Mutex::new(Vec::new());
    let normal = normalize_path(&dir.to_string_lossy());
    let mut scopes = SCOPES.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(found) = scopes.iter().find(|s| ***s == normal) {
        return found;
    }
    let leaked: &'static String = Box::leak(Box::new(normal));
    scopes.push(leaked);
    leaked
}

pub(crate) fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// The copies of its own database SQL may attach: the backup import's
/// working copy, and the migration backups `VACUUM INTO` writes (SQLite
/// attaches its target internally). Both stay under the vault key — an
/// `ATTACH` without `KEY` inherits it.
fn may_attach(scope: &str, filename: &str) -> bool {
    // `VACUUM` ohne Ziel hängt eine leere, temporäre Datenbank an.
    if filename.is_empty() {
        return true;
    }
    let file = normalize_path(filename);
    let Some((parent, name)) = file.rsplit_once('/') else { return false };
    parent == scope
        && (name == vault::IMPORT_STAGING_FILE || vault::migration_backup_version(name).is_some())
}

/// A pool whose every connection carries [`authorize`], scoped to `vault_dir`.
async fn connect(options: SqliteConnectOptions, vault_dir: &Path) -> Result<SqlitePool, String> {
    let scope = attach_scope(vault_dir);
    SqlitePoolOptions::new()
        // Jede Verbindung hat ihren eigenen Seiten-Cache; wenige Verbindungen
        // heißen wärmere Caches und begrenzten Speicher.
        .max_connections(4)
        .after_connect(move |conn, _| {
            Box::pin(async move {
                let mut handle = conn.lock_handle().await?;
                // SAFETY: the handle is locked for the duration of the call;
                // the user data is a `'static` string the callback only reads.
                unsafe {
                    libsqlite3_sys::sqlite3_set_authorizer(
                        handle.as_raw_handle().as_ptr(),
                        Some(authorize),
                        scope as *const String as *mut c_void,
                    );
                }
                Ok(())
            })
        })
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())
}

/// Refuses what would let SQL from the webview undo the encryption: the key
/// pragmas (`key`, `rekey` and their variants), SQLCipher's settings pragmas
/// (`cipher_*`, `kdf_iter`, …), `sqlcipher_export`, and `ATTACH` of anything
/// but the vault's own copies ([`may_attach`]) — an `ATTACH … KEY ''` would
/// otherwise take a plaintext copy anywhere. `cipher_version` only reads, and
/// stays allowed.
unsafe extern "C" fn authorize(
    scope: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    arg2: *const c_char,
    _: *const c_char,
    _: *const c_char,
) -> c_int {
    let name = |p: *const c_char| {
        if p.is_null() {
            String::new()
        } else {
            // SAFETY: SQLite passes NUL-terminated strings or NULL.
            unsafe { CStr::from_ptr(p) }.to_string_lossy().to_ascii_lowercase()
        }
    };
    let denied = match action {
        libsqlite3_sys::SQLITE_PRAGMA => {
            let pragma = name(arg1);
            matches!(
                pragma.as_str(),
                "key" | "rekey" | "hexkey" | "hexrekey" | "textkey" | "textrekey" | "kdf_iter" | "fast_kdf_iter"
            ) || pragma.starts_with("hmac_")
                || (pragma.starts_with("cipher") && pragma != "cipher_version")
        }
        libsqlite3_sys::SQLITE_FUNCTION => name(arg2) == "sqlcipher_export",
        libsqlite3_sys::SQLITE_ATTACH => {
            // SAFETY: `connect` passes a `&'static String` as user data.
            let scope = unsafe { &*(scope as *const String) };
            !may_attach(scope, &name(arg1))
        }
        _ => false,
    };
    if denied {
        libsqlite3_sys::SQLITE_DENY
    } else {
        libsqlite3_sys::SQLITE_OK
    }
}

/// The key as SQLCipher's raw-key pragma value. Raw means SQLCipher skips its
/// own PBKDF2 — the key is already random.
pub(crate) fn sqlcipher_key(key: &crypto::Key) -> Zeroizing<String> {
    let mut value = Zeroizing::new(String::with_capacity(70));
    value.push_str("\"x'");
    for b in key.iter() {
        value.push_str(&format!("{b:02X}"));
    }
    value.push_str("'\"");
    value
}

/// Closes every pool of one vault — when it is locked.
pub async fn close_vault(app: &tauri::AppHandle, vault_id: &str) {
    let prefix = format!("{vault_id}/");
    let pools: Vec<SqlitePool> = {
        let dbs = app.state::<Databases>();
        let mut map = dbs.0.write().await;
        let handles: Vec<String> = map.keys().filter(|h| h.starts_with(&prefix)).cloned().collect();
        handles.iter().filter_map(|h| map.remove(h)).collect()
    };
    for pool in pools {
        pool.close().await;
    }
}

/// Closes one pool. An unknown handle is an error, as it was in the plugin.
#[tauri::command]
pub async fn db_close(dbs: tauri::State<'_, Databases>, db: String) -> Result<bool, String> {
    let pool = dbs
        .0
        .write()
        .await
        .remove(&db)
        .ok_or_else(|| format!("database {db} not loaded"))?;
    pool.close().await;
    Ok(true)
}

async fn pool(dbs: &Databases, db: &str) -> Result<SqlitePool, String> {
    dbs.0
        .read()
        .await
        .get(db)
        .cloned()
        .ok_or_else(|| format!("database {db} not loaded"))
}

/// Binds the frontend's values the way the plugin did: strings as text, every
/// number as a float (SQLite stores an integral float in an INTEGER column as
/// an integer), `null` as NULL, and anything else — booleans, arrays,
/// objects — as JSON.
fn bind_all<'q>(mut query: Query<'q, Sqlite, SqliteArguments<'q>>, values: Vec<JsonValue>) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    for value in values {
        query = match value {
            JsonValue::Null => query.bind(None::<JsonValue>),
            JsonValue::String(s) => query.bind(s),
            JsonValue::Number(n) => query.bind(n.as_f64().unwrap_or_default()),
            other => query.bind(other),
        };
    }
    query
}

#[tauri::command]
pub async fn db_execute(
    dbs: tauri::State<'_, Databases>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<(u64, i64), String> {
    execute_on(&pool(&dbs, &db).await?, &query, values).await
}

async fn execute_on(pool: &SqlitePool, query: &str, values: Vec<JsonValue>) -> Result<(u64, i64), String> {
    let result = pool
        .execute(bind_all(sqlx::query(query), values))
        .await
        .map_err(|e| e.to_string())?;
    Ok((result.rows_affected(), result.last_insert_rowid()))
}

#[tauri::command]
pub async fn db_select(
    dbs: tauri::State<'_, Databases>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    select_on(&pool(&dbs, &db).await?, &query, values).await
}

async fn select_on(pool: &SqlitePool, query: &str, values: Vec<JsonValue>) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    let rows = pool
        .fetch_all(bind_all(sqlx::query(query), values))
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            let mut object = IndexMap::with_capacity(row.columns().len());
            for (i, column) in row.columns().iter().enumerate() {
                let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
                object.insert(column.name().to_string(), to_json(raw)?);
            }
            Ok(object)
        })
        .collect()
}

/// One column value as JSON, following the plugin's `decode/sqlite.rs`. The
/// date and time branches return the text as stored; the plugin reformatted
/// it through the `time` crate, but nothing in this schema declares those
/// types.
fn to_json(value: SqliteValueRef) -> Result<JsonValue, String> {
    if value.is_null() {
        return Ok(JsonValue::Null);
    }
    let owned = ValueRef::to_owned(&value);
    let json = match value.type_info().name() {
        "TEXT" | "DATE" | "TIME" | "DATETIME" => owned.try_decode::<String>().map(JsonValue::String).unwrap_or(JsonValue::Null),
        "REAL" => owned.try_decode::<f64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => owned.try_decode::<i64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "BOOLEAN" => owned.try_decode::<bool>().map(JsonValue::Bool).unwrap_or(JsonValue::Null),
        "BLOB" => owned
            .try_decode::<Vec<u8>>()
            .map(|bytes| JsonValue::Array(bytes.into_iter().map(JsonValue::from).collect()))
            .unwrap_or(JsonValue::Null),
        "NULL" => JsonValue::Null,
        other => return Err(format!("unsupported datatype: {other}")),
    };
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn memory_pool() -> SqlitePool {
        // One connection: every connection to `:memory:` is its own database.
        sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().in_memory(true))
            .await
            .unwrap()
    }

    fn scratch_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("emerald-db-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn keyed(file: &std::path::Path, key: &crypto::Key) -> SqliteConnectOptions {
        SqliteConnectOptions::new()
            .filename(file)
            .create_if_missing(true)
            .pragma("key", sqlcipher_key(key).to_string())
    }

    fn is_plain_sqlite(file: &std::path::Path) -> bool {
        std::fs::read(file).unwrap().starts_with(b"SQLite format 3")
    }

    #[tokio::test]
    async fn values_bind_and_decode_like_the_plugin() {
        let pool = memory_pool().await;
        execute_on(&pool, "CREATE TABLE t (i INTEGER, r REAL, s TEXT, n TEXT, j TEXT)", vec![]).await.unwrap();
        let (affected, rowid) = execute_on(
            &pool,
            "INSERT INTO t VALUES ($1, $2, $3, $4, $5)",
            vec![json!(42), json!(1.5), json!("text"), JsonValue::Null, json!({"a": [1, true]})],
        )
        .await
        .unwrap();
        assert_eq!((affected, rowid), (1, 1));

        let rows = select_on(&pool, "SELECT i, r, s, n, j FROM t", vec![]).await.unwrap();
        let row = &rows[0];
        // Numbers bind as floats; an INTEGER column stores the integral one as an integer.
        assert_eq!(row["i"], json!(42));
        assert_eq!(row["r"], json!(1.5));
        assert_eq!(row["s"], json!("text"));
        assert_eq!(row["n"], JsonValue::Null);
        assert_eq!(row["j"], json!(r#"{"a":[1,true]}"#));
        // Column order is the query's.
        assert_eq!(row.keys().collect::<Vec<_>>(), ["i", "r", "s", "n", "j"]);
    }

    #[tokio::test]
    async fn expressions_decode_by_value_type() {
        let pool = memory_pool().await;
        let rows = select_on(&pool, "SELECT 1 + 1 AS two, 'x' || 'y' AS xy, 0.5 AS half, NULL AS empty", vec![]).await.unwrap();
        assert_eq!(rows[0]["two"], json!(2));
        assert_eq!(rows[0]["xy"], json!("xy"));
        assert_eq!(rows[0]["half"], json!(0.5));
        assert_eq!(rows[0]["empty"], JsonValue::Null);
    }

    #[tokio::test]
    async fn errors_keep_the_sqlite_message() {
        // `isAlreadyAppliedError` in db.ts matches on this text.
        let pool = memory_pool().await;
        execute_on(&pool, "CREATE TABLE t (a TEXT)", vec![]).await.unwrap();
        let err = execute_on(&pool, "ALTER TABLE t ADD COLUMN a TEXT", vec![]).await.unwrap_err();
        assert!(err.contains("duplicate column name"), "{err}");
    }

    #[tokio::test]
    async fn a_keyed_database_is_unreadable_without_its_key() {
        let dir = std::env::temp_dir().join(format!("emerald-db-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("keyed.db");
        let key = crate::crypto::random_key();
        let keyed = keyed(&file, &key);

        let pool = SqlitePool::connect_with(keyed.clone()).await.unwrap();
        execute_on(&pool, "CREATE TABLE t (s TEXT)", vec![]).await.unwrap();
        execute_on(&pool, "INSERT INTO t VALUES ('GEHEIM-1234')", vec![]).await.unwrap();
        pool.close().await;

        let bytes = std::fs::read(&file).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(!bytes.windows(11).any(|w| w == b"GEHEIM-1234"));

        let pool = SqlitePool::connect_with(keyed).await.unwrap();
        assert_eq!(select_on(&pool, "SELECT s FROM t", vec![]).await.unwrap()[0]["s"], serde_json::json!("GEHEIM-1234"));
        pool.close().await;

        let other = SqliteConnectOptions::new().filename(&file).pragma("key", sqlcipher_key(&crate::crypto::random_key()).to_string());
        let failed = match SqlitePool::connect_with(other).await {
            Ok(pool) => select_on(&pool, "SELECT s FROM t", vec![]).await.is_err(),
            Err(_) => true,
        };
        assert!(failed, "opened with the wrong key");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn copies_of_a_keyed_database_stay_encrypted() {
        // `backupDatabaseFile` and the import staging copy are `VACUUM INTO`;
        // the import swap `ATTACH`es the copy without a KEY clause.
        let dir = scratch_dir();
        let key = crypto::random_key();
        let pool = connect(keyed(&dir.join("main.db"), &key), &dir).await.unwrap();
        execute_on(&pool, "CREATE TABLE t (s TEXT)", vec![]).await.unwrap();
        execute_on(&pool, "INSERT INTO t VALUES ('x')", vec![]).await.unwrap();
        let copy = dir.join("emerald.db.pre-v99.bak");
        execute_on(&pool, &format!("VACUUM INTO '{}'", copy.display()), vec![]).await.unwrap();
        assert!(!is_plain_sqlite(&copy));

        let attached = dir.join(vault::IMPORT_STAGING_FILE);
        execute_on(&pool, &format!("ATTACH DATABASE '{}' AS a; CREATE TABLE a.u (s TEXT); INSERT INTO a.u VALUES ('y'); DETACH DATABASE a", attached.display()), vec![]).await.unwrap();
        pool.close().await;
        assert!(!is_plain_sqlite(&attached));

        let reopened = connect(keyed(&copy, &key), &dir).await.unwrap();
        assert_eq!(select_on(&reopened, "SELECT s FROM t", vec![]).await.unwrap()[0]["s"], json!("x"));
        reopened.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn the_authorizer_keeps_the_key_out_of_reach() {
        let dir = scratch_dir();
        let key = crypto::random_key();
        let pool = connect(keyed(&dir.join("main.db"), &key), &dir).await.unwrap();
        execute_on(&pool, "CREATE TABLE t (s TEXT)", vec![]).await.unwrap();
        // Ein ATTACH außerhalb der eigenen Kopien, verschlüsselt oder nicht.
        let elsewhere = dir.join("anywhere.db");
        assert!(execute_on(&pool, &format!("ATTACH DATABASE '{}' AS p KEY ''", elsewhere.display()), vec![]).await.is_err());
        assert!(execute_on(&pool, &format!("VACUUM INTO '{}'", elsewhere.display()), vec![]).await.is_err());
        assert!(execute_on(&pool, "VACUUM", vec![]).await.is_ok());
        for sql in [
            "PRAGMA rekey = 'other'",
            "PRAGMA key = 'other'",
            "PRAGMA hexrekey = '00'",
            "PRAGMA cipher_plaintext_header_size = 32",
            "PRAGMA kdf_iter = 1",
        ] {
            assert!(execute_on(&pool, sql, vec![]).await.is_err(), "{sql} went through");
        }
        let plain = dir.join("plain.db");
        let export = format!("ATTACH DATABASE '{}' AS p KEY ''; SELECT sqlcipher_export('p')", plain.display());
        assert!(execute_on(&pool, &export, vec![]).await.is_err());
        // Das ATTACH darf die Datei anlegen — gefüllt wird sie nicht.
        assert!(!plain.exists() || !is_plain_sqlite(&plain));
        // Was erlaubt bleibt.
        assert!(select_on(&pool, "PRAGMA cipher_version", vec![]).await.is_ok());
        assert!(select_on(&pool, "PRAGMA table_info(t)", vec![]).await.is_ok());
        assert!(execute_on(&pool, "PRAGMA foreign_keys = ON", vec![]).await.is_ok());
        pool.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn the_driver_is_sqlcipher() {
        let pool = memory_pool().await;
        let rows = select_on(&pool, "PRAGMA cipher_version", vec![]).await.unwrap();
        assert!(!rows.is_empty(), "SQLCipher not linked");
    }
}
