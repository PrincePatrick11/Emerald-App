//! The way to a sync server: connection, sealing, images.
//!
//! What goes to the server is sealed here, under the vault key, which the
//! webview never sees. The token stays here too, and so does the network: like
//! the updater, this keeps the app's CSP closed. The webview hands in rows as
//! text and decides when to sync (`lib/sync/engine.ts`); what is merged how is
//! not this file's business.
//!
//! `{appDataDir}/sync.json` says which vault is connected where. The token in it
//! is sealed under the vault key. Until a vault has its key (one being fetched
//! from the server) the token waits in memory.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;
use zeroize::Zeroizing;

use crate::crypto::{self, Context, Key, Purpose};
use crate::{images, keys, vault};

const SETTINGS_FILE: &str = "sync.json";
const SETTINGS_TEMP_FILE: &str = "sync.json.tmp";

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The vault on the server is under a key this device does not have.
const PASSWORD_CHANGED: &str = "SYNC_PASSWORD_CHANGED";
const UNREACHABLE: &str = "SYNC_UNREACHABLE";
const INSECURE: &str = "SYNC_INSECURE";
const NOT_CONNECTED: &str = "SYNC_NOT_CONNECTED";
const NEEDS_LOGIN: &str = "SYNC_NEEDS_LOGIN";
const LOCKED: &str = "SYNC_VAULT_LOCKED";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Connection {
    url: String,
    username: String,
    #[serde(default)]
    remote: Option<String>,
    #[serde(default)]
    device: Option<String>,
    /// Base64 of the token, sealed under the vault key.
    #[serde(default)]
    token: Option<String>,
    /// The password changed here and the server has not heard yet.
    #[serde(default)]
    rekeyed: bool,
}

type Connections = HashMap<String, Connection>;

/// Tokens of vaults that cannot seal them yet. Also serializes the settings file.
#[derive(Default)]
pub struct SyncState {
    waiting: Mutex<HashMap<String, Zeroizing<String>>>,
    file: Mutex<()>,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn read_all(app: &tauri::AppHandle) -> Result<Connections, String> {
    match std::fs::read_to_string(data_dir(app)?.join(SETTINGS_FILE)) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Connections::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn change_all(app: &tauri::AppHandle, change: impl FnOnce(&mut Connections)) -> Result<(), String> {
    let state = app.state::<SyncState>();
    let _guard = state.file.lock().map_err(|_| "sync settings unavailable".to_string())?;
    let mut all = read_all(app)?;
    change(&mut all);
    let text = serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?;
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    vault::write_atomic(&dir, SETTINGS_FILE, SETTINGS_TEMP_FILE, &text)
}

fn connection(app: &tauri::AppHandle, vault_id: &str) -> Result<Connection, String> {
    read_all(app)?.remove(vault_id).ok_or_else(|| NOT_CONNECTED.to_string())
}

/// Before a password change: the sealed token would not open under the new key,
/// so it waits in memory and is sealed again by the next `token()`.
pub fn hold_token(app: &tauri::AppHandle, vault_id: &str, old_key: &Key) -> Result<(), String> {
    let Some(sealed) = read_all(app)?.remove(vault_id).and_then(|c| c.token) else {
        return Ok(());
    };
    let files = crypto::subkey(old_key, Purpose::Files);
    if let Some(token) = B64.decode(sealed).ok().and_then(|bytes| open(&files, &bytes).ok()) {
        let state = app.state::<SyncState>();
        state.waiting.lock().map_err(|_| "sync state unavailable".to_string())?.insert(vault_id.to_string(), Zeroizing::new(token));
    }
    Ok(())
}

/// After a password change: the next round publishes the vault under the new key.
pub fn note_rekeyed(app: &tauri::AppHandle, vault_id: &str) -> Result<(), String> {
    if !is_connected(app, vault_id) {
        return Ok(());
    }
    change_all(app, |all| {
        if let Some(c) = all.get_mut(vault_id) {
            c.rekeyed = true;
        }
    })?;
    token(app, vault_id).map(|_| ())
}

pub fn is_connected(app: &tauri::AppHandle, vault_id: &str) -> bool {
    read_all(app).is_ok_and(|all| all.contains_key(vault_id))
}

/// Forgets the connection along with a vault's local files.
pub fn forget(app: &tauri::AppHandle, vault_id: &str) {
    if is_connected(app, vault_id) {
        if let Err(e) = change_all(app, |all| {
            all.remove(vault_id);
        }) {
            eprintln!("[sync] forgetting the connection failed: {e}");
        }
    }
    if let Ok(mut waiting) = app.state::<SyncState>().waiting.lock() {
        waiting.remove(vault_id);
    }
}

fn files_key(app: &tauri::AppHandle, vault_id: &str) -> Result<Key, String> {
    let key = keys::key_for(app, vault_id)?.ok_or_else(|| LOCKED.to_string())?;
    Ok(crypto::subkey(&key, Purpose::Files))
}

fn seal(key: &Key, text: &str) -> Vec<u8> {
    crypto::seal(key, Context::Sync, text.as_bytes())
}

fn open(key: &Key, data: &[u8]) -> Result<String, String> {
    let plain = crypto::open(key, Context::Sync, data).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    String::from_utf8(plain.to_vec()).map_err(|_| "SYNC_CANNOT_OPEN".to_string())
}

/// The token, from memory or sealed in the settings. One waiting in memory is
/// sealed as soon as the vault has its key.
fn token(app: &tauri::AppHandle, vault_id: &str) -> Result<Zeroizing<String>, String> {
    let state = app.state::<SyncState>();
    let waiting = state.waiting.lock().map_err(|_| "sync state unavailable".to_string())?.get(vault_id).cloned();
    if let Some(token) = waiting {
        if let Ok(key) = files_key(app, vault_id) {
            let sealed = B64.encode(seal(&key, &token));
            change_all(app, |all| {
                if let Some(c) = all.get_mut(vault_id) {
                    c.token = Some(sealed);
                }
            })?;
            state.waiting.lock().map_err(|_| "sync state unavailable".to_string())?.remove(vault_id);
        }
        return Ok(token);
    }
    let sealed = connection(app, vault_id)?.token.ok_or_else(|| NEEDS_LOGIN.to_string())?;
    let key = files_key(app, vault_id)?;
    let bytes = B64.decode(sealed).map_err(|_| NEEDS_LOGIN.to_string())?;
    open(&key, &bytes).map(Zeroizing::new).map_err(|_| NEEDS_LOGIN.to_string())
}

/// `https`, or `http` where the traffic does not cross an open network: this
/// machine, a private address, a tailnet. Passwords and tokens travel here.
pub(crate) fn clean_url(raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| INSECURE.to_string())?;
    let safe = match (url.scheme(), url.host()) {
        ("https", Some(_)) => true,
        ("http", Some(url::Host::Domain(host))) => {
            host == "localhost" || host.ends_with(".localhost") || host.ends_with(".ts.net")
        }
        ("http", Some(url::Host::Ipv4(ip))) => {
            let carrier_grade = ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]);
            ip.is_loopback() || ip.is_private() || carrier_grade
        }
        ("http", Some(url::Host::Ipv6(ip))) => ip.is_loopback(),
        _ => false,
    };
    if !safe {
        return Err(INSECURE.to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // A server that went away does not always say so. Without these a
        // request on a dead connection waits out the long timeout below, and
        // sync stands still for that long.
        .read_timeout(Duration::from_secs(45))
        .pool_idle_timeout(Duration::from_secs(20))
        .tcp_keepalive(Duration::from_secs(15))
        // A redirect has no business taking the token somewhere else.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

fn request(url: &str, method: Method, path: &str, timeout: Duration) -> Result<RequestBuilder, String> {
    Ok(client()?.request(method, format!("{url}/api/v1{path}")).timeout(timeout))
}

const SHORT: Duration = Duration::from_secs(60);
/// A snapshot or a large image on a slow line.
const LONG: Duration = Duration::from_secs(1800);

async fn send(builder: RequestBuilder) -> Result<Response, String> {
    builder.send().await.map_err(|e| {
        eprintln!("[sync] request failed: {e}");
        UNREACHABLE.to_string()
    })
}

/// The server's own word for why it refused, as `SYNC_` + what it said.
async fn refused(response: Response) -> String {
    let status = response.status();
    let code = response.json::<Value>().await.ok().and_then(|v| v["code"].as_str().map(str::to_owned));
    if status == StatusCode::UNAUTHORIZED {
        return NEEDS_LOGIN.to_string();
    }
    format!("SYNC_SERVER:{}", code.unwrap_or_else(|| status.as_u16().to_string()))
}

struct Remote {
    url: String,
    remote: String,
    token: Zeroizing<String>,
}

fn remote(app: &tauri::AppHandle, vault_id: &str) -> Result<Remote, String> {
    let c = connection(app, vault_id)?;
    Ok(Remote {
        token: token(app, vault_id)?,
        remote: c.remote.ok_or_else(|| NOT_CONNECTED.to_string())?,
        url: c.url,
    })
}

impl Remote {
    fn call(&self, method: Method, path: &str, timeout: Duration) -> Result<RequestBuilder, String> {
        Ok(request(&self.url, method, &format!("/vaults/{}{path}", self.remote), timeout)?.bearer_auth(self.token.as_str()))
    }
}

#[tauri::command]
pub async fn sync_status(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let Some(c) = read_all(&app)?.remove(&vault_id) else {
        return Ok(json!({ "connected": false }));
    };
    let needs_login = matches!(token(&app, &vault_id), Err(e) if e == NEEDS_LOGIN);
    Ok(json!({
        "connected": true,
        "url": c.url,
        "username": c.username,
        "hasRemote": c.remote.is_some(),
        "needsLogin": needs_login,
        "rekeyed": c.rekeyed,
    }))
}

/// Logs in, or makes the account, and remembers the connection for this vault.
/// Nothing about the vault has reached the server yet.
#[tauri::command]
pub async fn sync_login(
    app: tauri::AppHandle,
    vault_id: String,
    url: String,
    username: String,
    password: Zeroizing<String>,
    signup: bool,
    device: String,
) -> Result<(), String> {
    let url = clean_url(&url)?;
    let path = if signup { "/signup" } else { "/login" };
    let body = json!({ "username": username, "password": password.as_str(), "device": device });
    let response = send(request(&url, Method::POST, path, SHORT)?.json(&body)).await?;
    if !response.status().is_success() {
        // A wrong password is not "log in again".
        return Err(match refused(response).await.as_str() {
            NEEDS_LOGIN => "SYNC_WRONG_LOGIN".to_string(),
            other => other.to_string(),
        });
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let token = Zeroizing::new(answer["token"].as_str().unwrap_or_default().to_string());
    let device_id = answer["device"].as_str().map(str::to_owned);

    let state = app.state::<SyncState>();
    state.waiting.lock().map_err(|_| "sync state unavailable".to_string())?.insert(vault_id.clone(), token);
    change_all(&app, |all| {
        let previous = all.remove(&vault_id).filter(|c| c.url == url);
        all.insert(
            vault_id.clone(),
            Connection {
                url,
                username,
                rekeyed: previous.as_ref().is_some_and(|c| c.rekeyed),
                remote: previous.and_then(|c| c.remote),
                device: device_id,
                token: None,
            },
        );
    })?;
    // Seals it right away if the vault is unlocked.
    self::token(&app, &vault_id).map(|_| ())
}

/// The vaults this account has on the server, for opening one on a new device.
#[tauri::command]
pub async fn sync_remote_vaults(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let c = connection(&app, &vault_id)?;
    let token = token(&app, &vault_id)?;
    let response = send(request(&c.url, Method::GET, "/vaults", SHORT)?.bearer_auth(token.as_str())).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let vaults: Vec<Value> = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    Ok(Value::Array(
        vaults
            .iter()
            .map(|v| json!({ "id": v["id"], "head": v["head"], "hasSnapshot": v["has_snapshot"] }))
            .collect(),
    ))
}

/// Makes this vault's place on the server. Its `vault.key` goes along: still
/// wrapped by the password, it is what lets another device unlock the vault.
#[tauri::command]
pub async fn sync_create_remote(app: tauri::AppHandle, vault_id: String, name: String) -> Result<(), String> {
    let c = connection(&app, &vault_id)?;
    let token = token(&app, &vault_id)?;
    let dir = vault::vault_dir(&app, &vault_id)?;
    let key_file = keys::read_key_file(&dir)?.ok_or_else(|| LOCKED.to_string())?;
    let meta = seal(&files_key(&app, &vault_id)?, &json!({ "name": name }).to_string());
    let body = json!({ "meta": B64.encode(meta), "key_file": B64.encode(key_file.to_json()) });
    let builder = request(&c.url, Method::POST, "/vaults", SHORT)?.bearer_auth(token.as_str()).json(&body);
    let response = send(builder).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let id = answer["id"].as_str().map(str::to_owned);
    change_all(&app, |all| {
        if let Some(c) = all.get_mut(&vault_id) {
            c.remote = id;
        }
    })
}

/// Ties a new, empty local vault to one on the server and fetches its
/// `vault.key`, so that the usual question for the password can open it.
#[tauri::command]
pub async fn sync_adopt_remote(app: tauri::AppHandle, vault_id: String, remote_id: String) -> Result<(), String> {
    let c = connection(&app, &vault_id)?;
    let token = token(&app, &vault_id)?;
    let dir = vault::vault_dir(&app, &vault_id)?;
    if keys::read_key_file(&dir)?.is_some() {
        return Err("SYNC_VAULT_NOT_EMPTY".to_string());
    }
    let path = format!("/vaults/{remote_id}");
    let response = send(request(&c.url, Method::GET, &path, SHORT)?.bearer_auth(token.as_str())).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let bytes = B64.decode(answer["key_file"].as_str().unwrap_or_default()).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    let file = keys::KeyFile::from_json(&text)?;
    keys::store_key_file(&dir, &file)?;
    change_all(&app, |all| {
        if let Some(c) = all.get_mut(&vault_id) {
            c.remote = Some(remote_id);
        }
    })
}

/// Ends the connection on this device. What is on the server stays, for the
/// other devices.
#[tauri::command]
pub async fn sync_disconnect(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    if let (Ok(c), Ok(token)) = (connection(&app, &vault_id), token(&app, &vault_id)) {
        if let Ok(builder) = request(&c.url, Method::POST, "/logout", SHORT) {
            // Best effort: being offline must not stop anybody from disconnecting.
            let _ = builder.bearer_auth(token.as_str()).send().await;
        }
    }
    forget(&app, &vault_id);
    Ok(())
}

/// Sealed and sent. `behind`, `epoch_changed` and the like are answers for the
/// caller to act on, so they come back as a status rather than an error.
#[tauri::command]
pub async fn sync_push(
    app: tauri::AppHandle,
    vault_id: String,
    base: i64,
    epoch: i64,
    schema: i64,
    batch_id: String,
    changes: String,
) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let key = files_key(&app, &vault_id)?;
    let payload = B64.encode(seal(&key, &changes));
    let body = json!({ "base": base, "epoch": epoch, "schema": schema, "batch_id": batch_id, "payload": payload });
    let response = send(target.call(Method::POST, "/changes", LONG)?.json(&body)).await?;
    if response.status().is_success() {
        let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
        return Ok(json!({ "status": "ok", "seq": answer["seq"] }));
    }
    protocol_answer(response).await
}

/// The refusals the protocol has words for; anything else is an error.
async fn protocol_answer(response: Response) -> Result<Value, String> {
    let error = refused(response).await;
    match error.strip_prefix("SYNC_SERVER:") {
        Some(code @ ("behind" | "epoch_changed" | "snapshot_required" | "client_outdated")) => Ok(json!({ "status": code })),
        _ => Err(error),
    }
}

#[tauri::command]
pub async fn sync_pull(app: tauri::AppHandle, vault_id: String, after: i64, epoch: i64, schema: i64) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let path = format!("/changes?after={after}&epoch={epoch}&schema={schema}");
    let response = send(target.call(Method::GET, &path, LONG)?).await?;
    if !response.status().is_success() {
        return protocol_answer(response).await;
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let key = files_key(&app, &vault_id)?;
    let mut changes = Vec::new();
    for change in answer["changes"].as_array().map_or(&[][..], Vec::as_slice) {
        let sealed = B64.decode(change["payload"].as_str().unwrap_or_default()).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
        changes.push(json!({ "seq": change["seq"], "changes": open(&key, &sealed)? }));
    }
    Ok(json!({ "status": "ok", "changes": changes, "more": answer["more"] }))
}

/// The server's position, which publishing a snapshot has to name.
#[tauri::command]
pub async fn sync_remote_state(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let response = send(target.call(Method::GET, "", SHORT)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    Ok(json!({
        "head": answer["head"],
        "epoch": answer["epoch"],
        "schema": answer["schema"],
        "hasSnapshot": answer["has_snapshot"],
    }))
}

#[tauri::command]
pub async fn sync_snapshot_put(
    app: tauri::AppHandle,
    vault_id: String,
    base: i64,
    epoch: i64,
    schema: i64,
    rows: String,
) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let rekeyed = connection(&app, &vault_id)?.rekeyed;
    // A device that missed a password change must not put the old key back.
    if !rekeyed && !same_key_as_server(&app, &vault_id, &target).await? {
        return Err(PASSWORD_CHANGED.to_string());
    }
    let dir = vault::vault_dir(&app, &vault_id)?;
    let key_file = keys::read_key_file(&dir)?.ok_or_else(|| LOCKED.to_string())?;
    let sealed = seal(&files_key(&app, &vault_id)?, &rows);
    let builder = target
        .call(Method::PUT, "/snapshot", LONG)?
        .header("x-base-seq", base)
        .header("x-epoch", epoch)
        .header("x-schema", schema)
        .header("x-key-file", B64.encode(key_file.to_json()))
        .body(sealed);
    let response = send(builder).await?;
    if response.status().is_success() {
        return Ok(json!({ "status": "ok" }));
    }
    protocol_answer(response).await
}

#[tauri::command]
pub async fn sync_snapshot_get(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let response = send(target.call(Method::GET, "/snapshot", LONG)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let number = |name: &str| -> i64 {
        response.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0)
    };
    let (seq, epoch, schema) = (number("x-snapshot-seq"), number("x-epoch"), number("x-schema"));
    let bytes = response.bytes().await.map_err(|_| UNREACHABLE.to_string())?;
    let rows = match open(&files_key(&app, &vault_id)?, &bytes) {
        Ok(rows) => rows,
        Err(err) => {
            return Err(if same_key_as_server(&app, &vault_id, &target).await? { err } else { PASSWORD_CHANGED.to_string() });
        }
    };
    Ok(json!({ "seq": seq, "epoch": epoch, "schema": schema, "rows": rows }))
}

async fn server_key_file(target: &Remote) -> Result<keys::KeyFile, String> {
    let response = send(target.call(Method::GET, "", SHORT)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let bytes = B64.decode(answer["key_file"].as_str().unwrap_or_default()).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    keys::KeyFile::from_json(&String::from_utf8(bytes).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?)
}

async fn same_key_as_server(app: &tauri::AppHandle, vault_id: &str, target: &Remote) -> Result<bool, String> {
    let dir = vault::vault_dir(app, vault_id)?;
    let local = keys::read_key_file(&dir)?.ok_or_else(|| LOCKED.to_string())?;
    Ok(server_key_file(target).await?.check() == local.check())
}

/// The password changed on another device. Its vault is under a new key, so the
/// copy here starts over: the old one goes once the new password has been proven
/// to open what is on the server. The database closes first, so a crash leaves
/// a vault that asks again, never one whose key does not fit.
#[tauri::command]
pub async fn sync_adopt_new_password(app: tauri::AppHandle, vault_id: String, password: Zeroizing<String>) -> Result<(), String> {
    let target = remote(&app, &vault_id)?;
    let file = server_key_file(&target).await?;
    let key = {
        let file = file.clone();
        tauri::async_runtime::spawn_blocking(move || file.unlock_with_password(&password)).await.map_err(|e| e.to_string())??
    };
    let response = send(target.call(Method::GET, "/snapshot", LONG)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let snapshot = response.bytes().await.map_err(|_| UNREACHABLE.to_string())?;
    open(&crypto::subkey(&key, Purpose::Files), &snapshot)?;

    let old = keys::key_for(&app, &vault_id)?.ok_or_else(|| LOCKED.to_string())?;
    hold_token(&app, &vault_id, &old)?;
    let dir = vault::vault_dir(&app, &vault_id)?;
    vault::remove_vault_content(&dir)?;
    keys::store_key_file(&dir, &file)?;
    let remembered = keys::is_remembered(&vault_id);
    if remembered {
        keys::apply_remember(&vault_id, &key, Some(true));
    }
    app.state::<keys::VaultKeys>().insert(&vault_id, key);
    token(&app, &vault_id).map(|_| ())
}

/// The new key is on the server. Images still under old names are of no use to
/// anybody now; the server drops them after its grace period.
#[tauri::command]
pub async fn sync_rekey_done(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let target = remote(&app, &vault_id)?;
    let folder = vault::vault_dir(&app, &vault_id)?.join("images");
    let response = send(target.call(Method::GET, "/blobs", SHORT)?).await?;
    if response.status().is_success() {
        let listed: Vec<Value> = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
        for name in listed.iter().filter_map(|b| b["name"].as_str()) {
            if images::is_valid_image_name(name) && !folder.join(name).exists() {
                let _ = send(target.call(Method::DELETE, &format!("/blobs/{name}"), SHORT)?).await;
            }
        }
    }
    change_all(&app, |all| {
        if let Some(c) = all.get_mut(&vault_id) {
            c.rekeyed = false;
        }
    })
}

/// Images are sealed and named by a keyed hash already, so they travel as they
/// are: what the server lacks goes up, what this device lacks comes down.
#[tauri::command]
pub async fn sync_images(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id)?;
    let folder = vault::vault_dir(&app, &vault_id)?.join("images");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let response = send(target.call(Method::GET, "/blobs", SHORT)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let listed: Vec<Value> = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let there: std::collections::HashSet<String> =
        listed.iter().filter_map(|b| b["name"].as_str().map(str::to_owned)).collect();
    let here: std::collections::HashSet<String> = std::fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| images::is_valid_image_name(name))
        .collect();

    let (mut uploaded, mut downloaded) = (0, 0);
    for name in here.difference(&there) {
        let bytes = tokio::fs::read(folder.join(name)).await.map_err(|e| e.to_string())?;
        // Only sealed files: a plain one from an old shared pool must not leave.
        if !crypto::is_sealed(&bytes) {
            continue;
        }
        let response = send(target.call(Method::PUT, &format!("/blobs/{name}"), LONG)?.body(bytes)).await?;
        if !response.status().is_success() {
            return Err(refused(response).await);
        }
        uploaded += 1;
    }
    for name in there.difference(&here) {
        // The name decides where the file lands; the server does not get a say.
        if !images::is_valid_image_name(name) {
            continue;
        }
        let response = send(target.call(Method::GET, &format!("/blobs/{name}"), LONG)?).await?;
        if !response.status().is_success() {
            return Err(refused(response).await);
        }
        let bytes = response.bytes().await.map_err(|_| UNREACHABLE.to_string())?;
        if !crypto::is_sealed(&bytes) {
            continue;
        }
        vault::write_atomic(&folder, name, &format!("{name}.tmp"), &bytes)?;
        downloaded += 1;
    }
    Ok(json!({ "uploaded": uploaded, "downloaded": downloaded }))
}

/// Unused images asked to go on the server too. It keeps them for a grace period,
/// and another device that still has one brings it back with its next sync.
#[tauri::command]
pub async fn sync_images_delete(app: tauri::AppHandle, vault_id: String, names: Vec<String>) -> Result<(), String> {
    let target = remote(&app, &vault_id)?;
    for name in names.iter().filter(|name| images::is_valid_image_name(name)) {
        let response = send(target.call(Method::DELETE, &format!("/blobs/{name}"), SHORT)?).await?;
        if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
            return Err(refused(response).await);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clean_url;

    #[test]
    fn plain_http_only_where_no_open_network_is_crossed() {
        for fine in [
            "https://sync.example.com",
            "https://sync.example.com/",
            "http://localhost:9300",
            "http://127.0.0.1:9300",
            "http://192.168.1.5:9300",
            "http://100.100.100.100:9300",
            "http://server.example.ts.net:9300",
            "http://[::1]:9300",
        ] {
            assert!(clean_url(fine).is_ok(), "{fine}");
        }
        for bad in ["http://sync.example.com", "http://8.8.8.8", "ftp://localhost", "file:///etc/passwd", "nonsense", "http://100.200.0.1"] {
            assert!(clean_url(bad).is_err(), "{bad}");
        }
        assert_eq!(clean_url("https://a.example/").unwrap(), "https://a.example");
    }
}
