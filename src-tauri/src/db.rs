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

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use sqlx::query::Query;
use sqlx::sqlite::{Sqlite, SqliteArguments, SqliteConnectOptions, SqlitePool, SqliteValueRef};
use sqlx::{Column, Executor, Row, TypeInfo, Value, ValueRef};
use std::collections::HashMap;
use tokio::sync::RwLock;

use crate::vault;

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
    let path = vault::vault_dir(&app, &vault_id)?.join(file.name());
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await.map_err(|e| e.to_string())?;

    let key = handle(&vault_id, file);
    let previous = dbs.0.write().await.insert(key.clone(), pool);
    if let Some(previous) = previous {
        previous.close().await;
    }
    Ok(key)
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
    async fn the_driver_is_sqlcipher() {
        let pool = memory_pool().await;
        let rows = select_on(&pool, "PRAGMA cipher_version", vec![]).await.unwrap();
        assert!(!rows.is_empty(), "SQLCipher not linked");
    }
}
