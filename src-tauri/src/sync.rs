//! The way to a sync server: connection, sealing, images.
//!
//! What goes to the server is sealed here, under the vault key, which the
//! webview never sees. The token stays here too, and so does the network: like
//! the updater, this keeps the app's CSP closed. The webview hands in rows as
//! text and decides when to sync (`lib/sync/engine.ts`); what is merged how is
//! not this file's business.
//!
//! `{appDataDir}/sync.json` holds the one server this installation talks to and
//! each vault's place on it. Like `update.json` it belongs to the installation,
//! not to a vault: a vault's backup must not bring a server along. The token and
//! the names key go to the OS keychain. With no keychain, or one that said no, they
//! stay in this file, sealed under a key built into the app: that keeps them from
//! lying there in plain sight, but anyone with the file and Emerald's source opens
//! them. The connect form warns of that beforehand, and the Sync page says so while
//! it is the case.

use std::collections::HashMap;
use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use zeroize::Zeroizing;

use crate::crypto::{self, Context, Key, Purpose};
use crate::{images, keys, vault};

pub(crate) const SETTINGS_FILE: &str = "sync.json";
pub(crate) const SETTINGS_TEMP_FILE: &str = "sync.json.tmp";
/// Where a `sync.json` that does not parse is moved, instead of being overwritten.
pub(crate) const BAD_FILE: &str = "sync.json.bad";

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The vault on the server is under a key this device does not have.
const PASSWORD_CHANGED: &str = "SYNC_PASSWORD_CHANGED";
const UNREACHABLE: &str = "SYNC_UNREACHABLE";
const INSECURE: &str = "SYNC_INSECURE";
const NOT_CONNECTED: &str = "SYNC_NOT_CONNECTED";
const NEEDS_LOGIN: &str = "SYNC_NEEDS_LOGIN";
const LOCKED: &str = "SYNC_VAULT_LOCKED";
/// The server speaks no protocol this build does, or cannot take a proof in
/// place of the key (before 0.1.1).
const SERVER_OUTDATED: &str = "SYNC_SERVER_OUTDATED";
/// The server speaks only protocols newer than this build's.
const APP_OUTDATED: &str = "SYNC_APP_OUTDATED";

/// The protocols this build speaks with a server, oldest first: Emerald-Server's
/// `Documentation/api.md`, under Handshake. Only moves when a request or an
/// answer changes in a way the other side would misread; what it can ignore
/// does not need it.
const PROTOCOLS: RangeInclusive<u32> = 1..=1;
const PROTOCOL_HEADER: &str = "emerald-protocol";

/// The one server this installation talks to, as `sync.json` has it.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredServer {
    url: String,
    device: String,
}

/// What opens it.
#[derive(Clone, Serialize, Deserialize)]
struct Credentials {
    token: String,
    /// Derived from the sync key, so that devices can read vault names without
    /// any vault's password, and the server, which only has the key's hash, cannot.
    names_key: String,
}

impl Drop for Credentials {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.token.zeroize();
        self.names_key.zeroize();
    }
}

/// The server with what opens it.
struct Server {
    url: String,
    device: String,
    token: String,
    names_key: String,
}

/// A vault's place on the server. Stays when the vault is disconnected, so it
/// can be connected again.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Link {
    remote: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    paused: bool,
    /// The password changed here and the server has not heard yet.
    #[serde(default)]
    rekeyed: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct SyncFile {
    #[serde(default)]
    server: Option<StoredServer>,
    /// Only when the keychain would not take them. A field of its own: a build
    /// from before reads `credentials` as a plain object, and a sealed string
    /// there would make it throw the whole file away.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "obscured")]
    credentials_sealed: Option<Credentials>,
    /// Where earlier builds put them, in the clear or sealed. Read, never written.
    #[serde(default, rename = "credentials", skip_serializing, deserialize_with = "obscured::deserialize")]
    legacy_credentials: Option<Credentials>,
    #[serde(default)]
    links: HashMap<String, Link>,
    /// Which server the links belong to, also while none is connected: a hash
    /// of the address and what its key derives.
    #[serde(default)]
    links_for: Option<String>,
}

/// Credentials in `sync.json`, sealed under a key every copy of Emerald has. Not a
/// secret: it only keeps the token from being readable at a glance, or by a tool
/// that looks for tokens in files.
mod obscured {
    use super::{Credentials, B64};
    use crate::crypto::{self, Context, Key};
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use zeroize::Zeroizing;

    const KEY: [u8; 32] = *b"emerald/sync.json/not-a-secret/1";

    pub fn serialize<S: Serializer>(value: &Option<Credentials>, out: S) -> Result<S::Ok, S::Error> {
        let Some(credentials) = value else { return out.serialize_none() };
        let text = Zeroizing::new(serde_json::to_vec(credentials).map_err(serde::ser::Error::custom)?);
        B64.encode(crypto::seal(&Key::new(KEY), Context::SyncCredentials, &text)).serialize(out)
    }

    /// What does not open counts as not there, so that it costs a login and not the
    /// rest of the file. Earlier builds wrote them in the clear; those still read.
    pub fn deserialize<'de, D: Deserializer<'de>>(input: D) -> Result<Option<Credentials>, D::Error> {
        Ok(match serde_json::Value::deserialize(input)? {
            serde_json::Value::String(text) => B64
                .decode(text)
                .ok()
                .and_then(|sealed| crypto::open(&Key::new(KEY), Context::SyncCredentials, &sealed).ok())
                .and_then(|plain| serde_json::from_slice(&plain).ok()),
            other => serde_json::from_value(other).ok(),
        })
    }
}

/// Serializes the settings file; what a running sync holds in memory.
#[derive(Default)]
pub struct SyncState {
    /// Where each frame of a fetched snapshot lies in its file.
    frames: Mutex<HashMap<String, Vec<(u64, u32)>>>,
    /// The vault listening for news from its server. One at a time: only the open vault syncs.
    watcher: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    file: Mutex<()>,
    /// What the file or the keychain answered, once: it is asked for nothing every two seconds,
    /// and a question it refused is not put to the user over and over.
    credentials: Mutex<Option<Option<Credentials>>>,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

impl SyncFile {
    /// What the file holds, under either name.
    fn stored_credentials(&self) -> Option<&Credentials> {
        self.credentials_sealed.as_ref().or(self.legacy_credentials.as_ref())
    }

    fn set_credentials(&mut self, credentials: Option<Credentials>) {
        self.credentials_sealed = credentials;
        self.legacy_credentials = None;
    }
}

fn read_file(app: &tauri::AppHandle) -> Result<SyncFile, String> {
    read_file_in(&data_dir(app)?)
}

/// A file that does not parse is moved aside as `sync.json.bad` rather than
/// read as empty: the next write would otherwise replace server, links and
/// their identity with nothing. What is left is a fresh start that costs a
/// login, and the old file to look at.
fn read_file_in(dir: &std::path::Path) -> Result<SyncFile, String> {
    let path = dir.join(SETTINGS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(file) => Ok(file),
            Err(e) => {
                eprintln!("[sync] {} does not parse ({e}); moved aside", path.display());
                std::fs::rename(&path, dir.join(BAD_FILE)).map_err(|e| e.to_string())?;
                Ok(SyncFile::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SyncFile::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn change_file(app: &tauri::AppHandle, change: impl FnOnce(&mut SyncFile)) -> Result<(), String> {
    let state = app.state::<SyncState>();
    let _guard = state.file.lock().map_err(|_| "sync settings unavailable".to_string())?;
    let mut file = read_file(app)?;
    change(&mut file);
    let text = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // It may hold the token.
    vault::write_atomic_private(&dir, SETTINGS_FILE, SETTINGS_TEMP_FILE, &text)?;
    Ok(())
}

/// A dev instance driven by the test tools stays out of the keychain: a rebuilt
/// binary would put up a dialog nobody is there to answer. Compiled out of release builds.
fn keychain_allowed() -> bool {
    #[cfg(debug_assertions)]
    if std::env::var_os("EMERALD_DEV_SEED_VAULT").is_some() {
        return false;
    }
    true
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(keys::keyring_service(), "sync-server").map_err(|e| e.to_string())
}

/// Into the keychain, or into `sync.json` if it will not take them. A refusal must
/// not lose the connection.
fn store_credentials(app: &tauri::AppHandle, credentials: Credentials) -> Result<(), String> {
    let in_keychain = keychain_allowed()
        && serde_json::to_string(&credentials)
            .map_err(|e| e.to_string())
            .and_then(|text| keychain_entry()?.set_password(&Zeroizing::new(text)).map_err(|e| e.to_string()))
            .map_err(|e| eprintln!("[sync] keychain: {e}"))
            .is_ok();
    change_file(app, |file| file.set_credentials((!in_keychain).then(|| credentials.clone())))?;
    if let Ok(mut held) = app.state::<SyncState>().credentials.lock() {
        *held = Some(Some(credentials));
    }
    Ok(())
}

fn forget_credentials(app: &tauri::AppHandle) {
    if keychain_allowed() {
        match keychain_entry().and_then(|entry| match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }) {
            Ok(()) => {}
            Err(e) => eprintln!("[sync] keychain: {e}"),
        }
    }
    if let Ok(mut held) = app.state::<SyncState>().credentials.lock() {
        *held = Some(None);
    };
}

fn credentials(app: &tauri::AppHandle) -> Option<Credentials> {
    let state = app.state::<SyncState>();
    let mut held = state.credentials.lock().ok()?;
    if held.is_none() {
        // The file first: where they lie there, the keychain has already said no.
        let found = read_file(app).ok()?.stored_credentials().cloned().or_else(|| {
            keychain_allowed()
                .then(keychain_entry)?
                .ok()?
                .get_password()
                .ok()
                .map(Zeroizing::new)
                .and_then(|text| serde_json::from_str::<Credentials>(&text).ok())
        });
        *held = Some(found);
    }
    let answer = held.clone().flatten();
    drop(held);
    answer
}

fn server(app: &tauri::AppHandle) -> Result<Server, String> {
    let stored = read_file(app)?.server.ok_or_else(|| NEEDS_LOGIN.to_string())?;
    let credentials = credentials(app).ok_or_else(|| NEEDS_LOGIN.to_string())?;
    Ok(Server {
        url: stored.url,
        device: stored.device,
        token: credentials.token.clone(),
        names_key: credentials.names_key.clone(),
    })
}

/// After a password change: the next round publishes the vault under the new key.
pub fn note_rekeyed(app: &tauri::AppHandle, vault_id: &str) -> Result<(), String> {
    change_file(app, |file| {
        if let Some(link) = file.links.get_mut(vault_id) {
            link.rekeyed = true;
        }
    })
}

/// Forgets a vault's link along with its local files. What is on the server stays.
pub fn forget(app: &tauri::AppHandle, vault_id: &str) {
    stop_watching(app);
    if let Ok(dir) = vault::vault_dir(app, vault_id) {
        for name in [UPLOAD_FILE, DOWNLOAD_FILE] {
            std::fs::remove_file(dir.join(name)).ok();
        }
    }
    if let Err(e) = change_file(app, |file| {
        file.links.remove(vault_id);
    }) {
        eprintln!("[sync] forgetting the link failed: {e}");
    }
}

/// Case and whatever separates the groups do not matter, as on the server.
fn clean_sync_key(sync_key: &str) -> Zeroizing<String> {
    Zeroizing::new(sync_key.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_uppercase).collect())
}

fn names_key_from(sync_key: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::new().chain_update(b"emerald/sync-names\0").chain_update(clean_sync_key(sync_key).as_bytes()).finalize();
    B64.encode(digest)
}

/// What pairing sends instead of the key, as `proof_of` on the server: derived
/// apart from the names key, so the server can open neither from it.
fn proof_from(sync_key: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::new().chain_update(b"emerald/sync-auth\0").chain_update(clean_sync_key(sync_key).as_bytes()).finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether `/health` names a version that takes a proof: 0.1.1 or later.
/// 0.1.0, the only one before, names none.
fn takes_proof(version: Option<&str>) -> bool {
    let Some(version) = version else { return false };
    let mut parts = version.split(['.', '-', '+']).map(|p| p.parse::<u64>().ok());
    match (parts.next().flatten(), parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor), Some(patch)) => (major, minor, patch) >= (0, 1, 1),
        _ => false,
    }
}

/// What a server and this build agreed on.
#[derive(Clone, Debug, PartialEq)]
struct Handshake {
    protocol: u32,
    features: Vec<String>,
}

impl Handshake {
    fn has(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }
}

/// Reads a server's `/health`: the highest protocol both sides speak and what
/// the server offers beyond it. A server from before the handshake names no
/// protocol and speaks the first; one from 0.1.1 takes a proof.
fn agree(health: &Value) -> Result<Handshake, String> {
    let (min, max, features) = match health.get("protocol") {
        Some(range) => {
            let bound = |name: &str| range[name].as_u64().and_then(|n| u32::try_from(n).ok());
            let (Some(min), Some(max)) = (bound("min"), bound("max")) else { return Err(UNREACHABLE.to_string()) };
            let features = health["features"].as_array().map(|list| list.iter().filter_map(|f| f.as_str().map(str::to_owned)).collect()).unwrap_or_default();
            (min, max, features)
        }
        None => {
            let features = if takes_proof(health["version"].as_str()) { vec!["proof".to_string()] } else { Vec::new() };
            (1, 1, features)
        }
    };
    if max < *PROTOCOLS.start() {
        return Err(SERVER_OUTDATED.to_string());
    }
    if min > *PROTOCOLS.end() {
        return Err(APP_OUTDATED.to_string());
    }
    Ok(Handshake { protocol: max.min(*PROTOCOLS.end()), features })
}

/// Handshakes by server address, for as long as the app runs. A server updated
/// meanwhile answers `protocol_unsupported`, which starts a new one.
fn handshakes() -> std::sync::MutexGuard<'static, HashMap<String, Handshake>> {
    static HANDSHAKES: OnceLock<Mutex<HashMap<String, Handshake>>> = OnceLock::new();
    HANDSHAKES.get_or_init(Default::default).lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn handshake(url: &str) -> Result<Handshake, String> {
    if let Some(known) = handshakes().get(url) {
        return Ok(known.clone());
    }
    let response = send(request(url, Method::GET, "/health", SHORT)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let health: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let agreed = agree(&health)?;
    handshakes().insert(url.to_string(), agreed.clone());
    Ok(agreed)
}

/// The server with what opens it, once it is clear which protocol to speak.
async fn connected(app: &tauri::AppHandle) -> Result<Server, String> {
    let server = server(app)?;
    handshake(&server.url).await?;
    Ok(server)
}

fn names_key(server: &Server) -> Result<Key, String> {
    let bytes = B64.decode(&server.names_key).map_err(|_| NEEDS_LOGIN.to_string())?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| NEEDS_LOGIN.to_string())?;
    Ok(Zeroizing::new(bytes))
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

/// A request in the protocol agreed with that server; before any handshake,
/// in the oldest this build speaks, which `/health` answers in any case.
fn request(url: &str, method: Method, path: &str, timeout: Duration) -> Result<RequestBuilder, String> {
    let protocol = handshakes().get(url).map_or(*PROTOCOLS.start(), |h| h.protocol);
    Ok(client()?.request(method, format!("{url}/api/v1{path}")).timeout(timeout).header(PROTOCOL_HEADER, protocol))
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
    let url = response.url().as_str().split_once("/api/v1").map(|(base, _)| base.to_string());
    let code = response.json::<Value>().await.ok().and_then(|v| v["code"].as_str().map(str::to_owned));
    if status == StatusCode::UNAUTHORIZED {
        return NEEDS_LOGIN.to_string();
    }
    // The server changed since the handshake: agree anew, and say why if that fails.
    if let (Some(url), Some("protocol_unsupported")) = (url, code.as_deref()) {
        handshakes().remove(&url);
        if let Err(err) = Box::pin(handshake(&url)).await {
            return err;
        }
    }
    format!("SYNC_SERVER:{}", code.unwrap_or_else(|| status.as_u16().to_string()))
}

/// Compressed, then sealed: encrypted data does not compress.
fn seal_packed(key: &Key, text: &str) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::new(3));
    encoder.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    let packed = encoder.finish().map_err(|e| e.to_string())?;
    Ok(crypto::seal(key, Context::Sync, &packed))
}

/// Inflating stops here: a sealed frame comes from this vault's own devices, but
/// nothing is gained by trusting its size.
const MAX_UNPACKED: u64 = 1 << 30;

fn open_packed(key: &Key, data: &[u8]) -> Result<String, String> {
    use std::io::Read;
    let packed = crypto::open(key, Context::Sync, data).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    let mut text = String::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .take(MAX_UNPACKED)
        .read_to_string(&mut text)
        .map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    Ok(text)
}

const UPLOAD_FILE: &str = "sync-upload.tmp";
const DOWNLOAD_FILE: &str = "sync-download.tmp";

/// A frame: its length, then the sealed bytes. The server sees one opaque file.
fn frame_offsets(path: &std::path::Path) -> Result<Vec<(u64, u32)>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let (mut at, mut offsets) = (0u64, Vec::new());
    while at < size {
        let mut length = [0u8; 4];
        file.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
        file.read_exact(&mut length).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
        let length = u32::from_le_bytes(length);
        if at + 4 + u64::from(length) > size {
            return Err("SYNC_CANNOT_OPEN".to_string());
        }
        offsets.push((at + 4, length));
        at += 4 + u64::from(length);
    }
    Ok(offsets)
}

fn read_frame(path: &std::path::Path, key: &Key, offset: u64, length: u32) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; length as usize];
    file.read_exact(&mut bytes).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    open_packed(key, &bytes)
}

/// The server's snapshot, written to a file as it comes rather than held in memory.
async fn download_snapshot(target: &Remote, path: &std::path::Path) -> Result<(i64, i64, i64), String> {
    use tokio::io::AsyncWriteExt;
    let mut response = send(target.call(Method::GET, "/snapshot", LONG)?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let number = |name: &str| -> i64 {
        response.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0)
    };
    let meta = (number("x-snapshot-seq"), number("x-epoch"), number("x-schema"));
    let mut file = tokio::fs::File::create(path).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|_| UNREACHABLE.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(meta)
}

struct Remote {
    url: String,
    remote: String,
    token: Zeroizing<String>,
}

async fn remote(app: &tauri::AppHandle, vault_id: &str) -> Result<Remote, String> {
    let server = connected(app).await?;
    let file = read_file(app)?;
    let link = file.links.get(vault_id).ok_or_else(|| NOT_CONNECTED.to_string())?;
    Ok(Remote { url: server.url, remote: link.remote.clone(), token: Zeroizing::new(server.token) })
}

impl Remote {
    fn call(&self, method: Method, path: &str, timeout: Duration) -> Result<RequestBuilder, String> {
        Ok(request(&self.url, method, &format!("/vaults/{}{path}", self.remote), timeout)?.bearer_auth(self.token.as_str()))
    }
}

/// One vault's standing. `connected` means it syncs.
#[tauri::command]
pub async fn sync_status(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let file = read_file(&app)?;
    let link = file.links.get(&vault_id);
    Ok(json!({
        "connected": file.server.is_some() && credentials(&app).is_some() && link.is_some_and(|l| !l.paused),
        "url": file.server.as_ref().map(|s| s.url.clone()),
        "hasServer": file.server.is_some(),
        "hasRemote": link.is_some(),
        "paused": link.is_some_and(|l| l.paused),
        "rekeyed": link.is_some_and(|l| l.rekeyed),
        "remote": link.map(|l| l.remote.clone()),
        "name": link.map(|l| l.name.clone()),
    }))
}

/// What the app is connected to, and each local vault's link.
#[tauri::command]
pub async fn sync_server_status(app: tauri::AppHandle) -> Result<Value, String> {
    let file = read_file(&app)?;
    let links: HashMap<String, Value> = file
        .links
        .iter()
        .map(|(id, l)| (id.clone(), json!({ "remote": l.remote, "paused": l.paused })))
        .collect();
    let has_credentials = credentials(&app).is_some();
    Ok(json!({
        "needsKey": file.server.is_some() && !has_credentials,
        "unencrypted": file.stored_credentials().is_some(),
        "url": file.server.map(|s| s.url),
        "links": links,
    }))
}

/// Trades a proof of the sync key for a token of this device's own. The key
/// neither travels nor is kept. Never the key itself, not even after a refusal:
/// a server that refuses the proof must not get the key that way. A server too
/// old for the proof is told apart first.
/// Another server than before means the old links lead nowhere.
#[tauri::command]
pub async fn sync_pair(app: tauri::AppHandle, url: String, key: Zeroizing<String>) -> Result<(), String> {
    let url = clean_url(&url)?;
    // A new start: the server behind the address may have changed.
    handshakes().remove(&url);
    if !handshake(&url).await?.has("proof") {
        return Err(SERVER_OUTDATED.to_string());
    }
    let device = gethostname::gethostname().to_string_lossy().split('.').next().unwrap_or_default().to_string();
    let body = json!({ "proof": proof_from(&key), "device": device });
    let response = send(request(&url, Method::POST, "/pair", SHORT)?.json(&body)).await?;
    if !response.status().is_success() {
        return Err(match refused(response).await.as_str() {
            NEEDS_LOGIN => "SYNC_WRONG_KEY".to_string(),
            other => other.to_string(),
        });
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let token = answer["token"].as_str().unwrap_or_default().to_string();
    let device = answer["device"].as_str().unwrap_or_default().to_string();
    let names_key = names_key_from(&key);
    stop_watching(&app);
    change_file(&app, |file| {
        use sha2::{Digest, Sha256};
        let identity = B64.encode(Sha256::new().chain_update(&url).chain_update(b"\0").chain_update(&names_key).finalize());
        if file.links_for.as_deref() != Some(identity.as_str()) {
            file.links.clear();
        }
        file.links_for = Some(identity);
        file.server = Some(StoredServer { url, device });
    })?;
    store_credentials(&app, Credentials { token, names_key })
}

/// This device leaves the server. Vaults stay there, and their links stay here,
/// in case the same server is connected again.
#[tauri::command]
pub async fn sync_unpair(app: tauri::AppHandle) -> Result<(), String> {
    stop_watching(&app);
    if let Ok(server) = server(&app) {
        if let Ok(builder) = request(&server.url, Method::POST, "/unpair", SHORT) {
            // Best effort: being offline must not stop anybody from disconnecting.
            let _ = builder.bearer_auth(&server.token).send().await;
        }
    }
    forget_credentials(&app);
    change_file(&app, |file| {
        file.server = None;
        file.set_credentials(None);
    })
}

async fn server_get(server: &Server, path: &str) -> Result<Value, String> {
    let response = send(request(&server.url, Method::GET, path, SHORT)?.bearer_auth(&server.token)).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    response.json().await.map_err(|_| UNREACHABLE.to_string())
}

#[tauri::command]
pub async fn sync_devices(app: tauri::AppHandle) -> Result<Value, String> {
    server_get(&connected(&app).await?, "/devices").await
}

/// Takes a device's token. Whoever still knows the sync key can connect again.
#[tauri::command]
pub async fn sync_remove_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let server = connected(&app).await?;
    // An id from the server's own list, but it ends up in a path.
    if uuid::Uuid::parse_str(&device_id).is_err() {
        return Err("invalid device id".to_string());
    }
    let path = format!("/devices/{device_id}");
    let response = send(request(&server.url, Method::DELETE, &path, SHORT)?.bearer_auth(&server.token)).await?;
    if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
        return Err(refused(response).await);
    }
    Ok(())
}

/// The vaults on the server, with the names this device can open.
#[tauri::command]
pub async fn sync_remote_vaults(app: tauri::AppHandle) -> Result<Value, String> {
    let server = connected(&app).await?;
    let key = names_key(&server)?;
    let vaults = server_get(&server, "/vaults").await?;
    let list = vaults.as_array().map_or(&[][..], Vec::as_slice).iter().map(|v| {
        let name = B64
            .decode(v["meta"].as_str().unwrap_or_default())
            .ok()
            .and_then(|bytes| open(&key, &bytes).ok())
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|meta| meta["name"].as_str().map(str::to_owned));
        json!({
            "id": v["id"],
            "name": name,
            "storedBytes": v["stored_bytes"],
            "images": v["images"],
            "hasSnapshot": v["has_snapshot"],
        })
    });
    Ok(Value::Array(list.collect()))
}

/// Makes this vault's place on the server. Its `vault.key` goes along: still
/// wrapped by the password, it is what lets another device unlock the vault.
#[tauri::command]
pub async fn sync_create_remote(app: tauri::AppHandle, vault_id: String, name: String) -> Result<(), String> {
    let server = connected(&app).await?;
    let dir = vault::vault_dir(&app, &vault_id)?;
    let key_file = keys::read_key_file(&dir)?.ok_or_else(|| LOCKED.to_string())?;
    let meta = seal(&names_key(&server)?, &json!({ "name": name }).to_string());
    let body = json!({ "meta": B64.encode(meta), "key_file": B64.encode(key_file.to_json()) });
    let builder = request(&server.url, Method::POST, "/vaults", SHORT)?.bearer_auth(&server.token).json(&body);
    let response = send(builder).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let answer: Value = response.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let remote = answer["id"].as_str().unwrap_or_default().to_string();
    change_file(&app, |file| {
        file.links.insert(vault_id, Link { remote, name, ..Link::default() });
    })
}

/// Ties a new, empty local vault to one on the server and fetches its
/// `vault.key`, so that the usual question for the password can open it.
#[tauri::command]
pub async fn sync_adopt_remote(app: tauri::AppHandle, vault_id: String, remote_id: String, name: String) -> Result<(), String> {
    let server = connected(&app).await?;
    let dir = vault::vault_dir(&app, &vault_id)?;
    if keys::read_key_file(&dir)?.is_some() {
        return Err("SYNC_VAULT_NOT_EMPTY".to_string());
    }
    if uuid::Uuid::parse_str(&remote_id).is_err() {
        return Err("invalid vault id".to_string());
    }
    let answer = server_get(&server, &format!("/vaults/{remote_id}")).await?;
    let bytes = B64.decode(answer["key_file"].as_str().unwrap_or_default()).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "SYNC_CANNOT_OPEN".to_string())?;
    let file = keys::KeyFile::from_json(&text)?;
    keys::store_key_file(&dir, &file)?;
    change_file(&app, |sync| {
        sync.links.insert(vault_id, Link { remote: remote_id, name, ..Link::default() });
    })
}

/// Stops or resumes syncing a vault. Its place on the server stays either way.
#[tauri::command]
pub async fn sync_set_paused(app: tauri::AppHandle, vault_id: String, paused: bool) -> Result<(), String> {
    stop_watching(&app);
    change_file(&app, |file| {
        if let Some(link) = file.links.get_mut(&vault_id) {
            link.paused = paused;
        }
    })
}

/// A vault's place is gone from the server: the local vault simply is local again.
#[tauri::command]
pub async fn sync_forget_link(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    stop_watching(&app);
    change_file(&app, |file| {
        file.links.remove(&vault_id);
    })
}

/// Removes a vault from the server. Copies on devices are not touched.
#[tauri::command]
pub async fn sync_delete_remote(app: tauri::AppHandle, remote_id: String) -> Result<(), String> {
    let server = connected(&app).await?;
    if uuid::Uuid::parse_str(&remote_id).is_err() {
        return Err("invalid vault id".to_string());
    }
    let path = format!("/vaults/{remote_id}");
    let response = send(request(&server.url, Method::DELETE, &path, LONG)?.bearer_auth(&server.token)).await?;
    if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
        return Err(refused(response).await);
    }
    change_file(&app, |file| file.links.retain(|_, link| link.remote != remote_id))
}

/// The vault was renamed here: the list on the server follows.
#[tauri::command]
pub async fn sync_rename(app: tauri::AppHandle, vault_id: String, name: String) -> Result<(), String> {
    let server = connected(&app).await?;
    let target = remote(&app, &vault_id).await?;
    let current = send(target.call(Method::GET, "", SHORT)?).await?;
    if !current.status().is_success() {
        return Err(refused(current).await);
    }
    let current: Value = current.json().await.map_err(|_| UNREACHABLE.to_string())?;
    let meta = seal(&names_key(&server)?, &json!({ "name": name }).to_string());
    let body = json!({ "meta": B64.encode(meta), "key_file": current["key_file"] });
    let response = send(target.call(Method::PUT, "", SHORT)?.json(&body)).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    change_file(&app, |file| {
        if let Some(link) = file.links.get_mut(&vault_id) {
            link.name = name;
        }
    })
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
    let target = remote(&app, &vault_id).await?;
    let key = files_key(&app, &vault_id)?;
    let payload = B64.encode(seal_packed(&key, &changes)?);
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
    let target = remote(&app, &vault_id).await?;
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
        changes.push(json!({ "seq": change["seq"], "changes": open_packed(&key, &sealed)? }));
    }
    Ok(json!({ "status": "ok", "changes": changes, "more": answer["more"] }))
}

/// The server's position, which publishing a snapshot has to name.
#[tauri::command]
pub async fn sync_remote_state(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id).await?;
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
        "snapshotSeq": answer["snapshot_seq"],
    }))
}

/// Starts a snapshot on disk, next to the vault it is made of.
#[tauri::command]
pub async fn sync_snapshot_begin(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let path = vault::vault_dir(&app, &vault_id)?.join(UPLOAD_FILE);
    tokio::fs::write(path, b"").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_snapshot_add(app: tauri::AppHandle, vault_id: String, frame: String) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let sealed = seal_packed(&files_key(&app, &vault_id)?, &frame)?;
    let path = vault::vault_dir(&app, &vault_id)?.join(UPLOAD_FILE);
    let mut file = tokio::fs::OpenOptions::new().append(true).open(path).await.map_err(|e| e.to_string())?;
    file.write_all(&(sealed.len() as u32).to_le_bytes()).await.map_err(|e| e.to_string())?;
    file.write_all(&sealed).await.map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_snapshot_put(
    app: tauri::AppHandle,
    vault_id: String,
    base: i64,
    epoch: i64,
    schema: i64,
) -> Result<Value, String> {
    let target = remote(&app, &vault_id).await?;
    let rekeyed = read_file(&app)?.links.get(&vault_id).is_some_and(|l| l.rekeyed);
    // A device that missed a password change must not put the old key back.
    if !rekeyed && !same_key_as_server(&app, &vault_id, &target).await? {
        return Err(PASSWORD_CHANGED.to_string());
    }
    let dir = vault::vault_dir(&app, &vault_id)?;
    let key_file = keys::read_key_file(&dir)?.ok_or_else(|| LOCKED.to_string())?;
    let path = dir.join(UPLOAD_FILE);
    let file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let length = file.metadata().await.map_err(|e| e.to_string())?.len();
    let builder = target
        .call(Method::PUT, "/snapshot", LONG)?
        .header("x-base-seq", base)
        .header("x-epoch", epoch)
        .header("x-schema", schema)
        .header("x-key-file", B64.encode(key_file.to_json()))
        .header(reqwest::header::CONTENT_LENGTH, length)
        .body(reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file)));
    let response = send(builder).await;
    tokio::fs::remove_file(&path).await.ok();
    let response = response?;
    if response.status().is_success() {
        return Ok(json!({ "status": "ok" }));
    }
    protocol_answer(response).await
}

/// Fetches the snapshot to disk and proves its first frame opens. The frames
/// follow one by one through `sync_snapshot_frame`.
#[tauri::command]
pub async fn sync_snapshot_fetch(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id).await?;
    let path = vault::vault_dir(&app, &vault_id)?.join(DOWNLOAD_FILE);
    let (seq, epoch, schema) = download_snapshot(&target, &path).await?;
    let offsets = frame_offsets(&path)?;
    if let Some((offset, length)) = offsets.first() {
        if let Err(err) = read_frame(&path, &files_key(&app, &vault_id)?, *offset, *length) {
            tokio::fs::remove_file(&path).await.ok();
            return Err(if same_key_as_server(&app, &vault_id, &target).await? { err } else { PASSWORD_CHANGED.to_string() });
        }
    }
    let frames = offsets.len();
    app.state::<SyncState>().frames.lock().map_err(|_| "sync state unavailable".to_string())?.insert(vault_id, offsets);
    Ok(json!({ "seq": seq, "epoch": epoch, "schema": schema, "frames": frames }))
}

#[tauri::command]
pub async fn sync_snapshot_frame(app: tauri::AppHandle, vault_id: String, index: usize) -> Result<String, String> {
    let (offset, length) = app
        .state::<SyncState>()
        .frames
        .lock()
        .map_err(|_| "sync state unavailable".to_string())?
        .get(&vault_id)
        .and_then(|offsets| offsets.get(index).copied())
        .ok_or_else(|| "SYNC_CANNOT_OPEN".to_string())?;
    let key = files_key(&app, &vault_id)?;
    let path = vault::vault_dir(&app, &vault_id)?.join(DOWNLOAD_FILE);
    tauri::async_runtime::spawn_blocking(move || read_frame(&path, &key, offset, length)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_snapshot_done(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    if let Ok(mut frames) = app.state::<SyncState>().frames.lock() {
        frames.remove(&vault_id);
    }
    let path = vault::vault_dir(&app, &vault_id)?.join(DOWNLOAD_FILE);
    tokio::fs::remove_file(path).await.ok();
    Ok(())
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
    let target = remote(&app, &vault_id).await?;
    let file = server_key_file(&target).await?;
    let key = {
        let file = file.clone();
        tauri::async_runtime::spawn_blocking(move || file.unlock_with_password(&password)).await.map_err(|e| e.to_string())??
    };
    let dir = vault::vault_dir(&app, &vault_id)?;
    let path = dir.join(DOWNLOAD_FILE);
    download_snapshot(&target, &path).await?;
    let proof = frame_offsets(&path).and_then(|offsets| match offsets.first() {
        Some((offset, length)) => read_frame(&path, &crypto::subkey(&key, Purpose::Files), *offset, *length).map(|_| ()),
        None => Err("SYNC_CANNOT_OPEN".to_string()),
    });
    tokio::fs::remove_file(&path).await.ok();
    proof?;

    vault::remove_vault_content(&dir)?;
    keys::store_key_file(&dir, &file)?;
    let remembered = keys::is_remembered(&vault_id);
    if remembered {
        keys::apply_remember(&vault_id, &key, Some(true));
    }
    app.state::<keys::VaultKeys>().insert(&vault_id, key);
    Ok(())
}

/// The new key is on the server. Images still under old names are of no use to
/// anybody now; the server drops them after its grace period.
#[tauri::command]
pub async fn sync_rekey_done(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    let target = remote(&app, &vault_id).await?;
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
    change_file(&app, |file| {
        if let Some(link) = file.links.get_mut(&vault_id) {
            link.rekeyed = false;
        }
    })
}

/// Images are sealed and named by a keyed hash already, so they travel as they
/// are: what the server lacks goes up, what this device lacks comes down.
#[tauri::command]
pub async fn sync_images(app: tauri::AppHandle, vault_id: String) -> Result<Value, String> {
    let target = remote(&app, &vault_id).await?;
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
        // Another device removed it since the list: this says nothing about the vault.
        if response.status() == StatusCode::NOT_FOUND {
            continue;
        }
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
    let target = remote(&app, &vault_id).await?;
    for name in names.iter().filter(|name| images::is_valid_image_name(name)) {
        let response = send(target.call(Method::DELETE, &format!("/blobs/{name}"), SHORT)?).await?;
        if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
            return Err(refused(response).await);
        }
    }
    Ok(())
}

fn stop_watching(app: &tauri::AppHandle) {
    if let Ok(mut watcher) = app.state::<SyncState>().watcher.lock() {
        if let Some(task) = watcher.take() {
            task.abort();
        }
    }
}

/// What a stream of server-sent events has so far: the `data` of each finished
/// event, with the rest left in the buffer for the next chunk.
fn take_events(buffer: &mut String) -> Vec<String> {
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let block: String = buffer.drain(..end + 2).collect();
        for line in block.lines() {
            if let Some(data) = line.strip_prefix("data:") {
                events.push(data.trim().to_string());
            }
        }
    }
    events
}

/// One connection to the server's event stream, until it breaks.
async fn listen_once(app: &tauri::AppHandle, vault_id: &str) -> Result<(), String> {
    let target = remote(app, vault_id).await?;
    let own = server(app)?.device;
    // Only an upper bound on one connection: its keep-alives pass the read timeout.
    let mut response = send(target.call(Method::GET, "/events", Duration::from_secs(86_400))?).await?;
    if !response.status().is_success() {
        return Err(refused(response).await);
    }
    let mut buffer = String::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| UNREACHABLE.to_string())? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        for data in take_events(&mut buffer) {
            let device = serde_json::from_str::<Value>(&data).ok().and_then(|v| v["device"].as_str().map(str::to_owned));
            // The first event says where the server stands, and this device's
            // own changes are nothing new to it.
            if device.as_deref() != Some(own.as_str()) {
                let _ = app.emit("sync-remote-changed", json!({ "vaultId": vault_id }));
            }
        }
    }
    Ok(())
}

/// Listens for news on the open vault, reconnecting for as long as it is wanted.
#[tauri::command]
pub async fn sync_watch(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    stop_watching(&app);
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut wait = 2;
        loop {
            let started = std::time::Instant::now();
            let _ = listen_once(&handle, &vault_id).await;
            // A connection that stood for a while says nothing about the next.
            if started.elapsed() > Duration::from_secs(60) {
                wait = 2;
            }
            tokio::time::sleep(Duration::from_secs(wait)).await;
            wait = (wait * 2).min(60);
        }
    });
    if let Ok(mut watcher) = app.state::<SyncState>().watcher.lock() {
        *watcher = Some(task);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_unwatch(app: tauri::AppHandle) -> Result<(), String> {
    stop_watching(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        agree, clean_url, names_key_from, proof_from, read_file_in, take_events, takes_proof, Credentials, SyncFile, BAD_FILE,
        SETTINGS_FILE,
    };

    #[test]
    fn the_proof_is_the_servers_and_not_the_names_key() {
        // The value Emerald-Server's own test of `proof_of` expects.
        assert_eq!(proof_from("abcd-efgh"), "35c556c1df68648bbdcc645ac38537f6f473b8839de5f941d108504a4f8bb7c1");
        assert_eq!(proof_from(" ABCD efgh "), proof_from("abcd-efgh"));
        use base64::Engine;
        let names = base64::engine::general_purpose::STANDARD.decode(names_key_from("abcd-efgh")).unwrap();
        let names_hex: String = names.iter().map(|b| format!("{b:02x}")).collect();
        assert_ne!(names_hex, proof_from("abcd-efgh"));
    }

    #[test]
    fn the_handshake_picks_the_highest_protocol_both_speak() {
        use super::{Handshake, APP_OUTDATED, SERVER_OUTDATED};
        use serde_json::json;
        let agreed = agree(&json!({ "version": "0.1.2", "protocol": { "min": 1, "max": 3 }, "features": ["proof", "later"] })).unwrap();
        assert_eq!(agreed, Handshake { protocol: 1, features: vec!["proof".into(), "later".into()] });
        assert!(agreed.has("proof") && !agreed.has("other"));
        assert_eq!(agree(&json!({ "protocol": { "min": 2, "max": 3 } })), Err(APP_OUTDATED.to_string()));
        assert_eq!(agree(&json!({ "protocol": { "min": 0, "max": 0 } })), Err(SERVER_OUTDATED.to_string()));
        assert!(agree(&json!({ "protocol": { "min": "one" } })).is_err());
        // Before the handshake: 0.1.1 takes a proof, 0.1.0 names no version.
        assert_eq!(agree(&json!({ "status": "ok", "version": "0.1.1" })).unwrap(), Handshake { protocol: 1, features: vec!["proof".into()] });
        assert_eq!(agree(&json!({ "status": "ok" })).unwrap(), Handshake { protocol: 1, features: vec![] });
    }

    #[test]
    fn only_a_server_from_0_1_1_takes_a_proof() {
        assert!(!takes_proof(None));
        assert!(!takes_proof(Some("0.1.0")));
        assert!(!takes_proof(Some("0.1")));
        assert!(!takes_proof(Some("garbage")));
        assert!(takes_proof(Some("0.1.1")));
        assert!(takes_proof(Some("0.1.2-rc.1")));
        assert!(takes_proof(Some("0.2.0")));
        assert!(takes_proof(Some("0.10.0")));
        assert!(takes_proof(Some("1.0.0")));
    }

    #[test]
    fn credentials_in_the_file_are_not_in_plain_sight() {
        let mut file = SyncFile::default();
        file.set_credentials(Some(Credentials { token: "tok-secret".into(), names_key: "names-secret".into() }));
        let text = serde_json::to_string(&file).unwrap();
        assert!(!text.contains("secret"), "{text}");
        assert!(!text.contains("\"credentials\""), "the old name is never written: {text}");
        let back: SyncFile = serde_json::from_str(&text).unwrap();
        assert_eq!(back.stored_credentials().map(|c| c.token.as_str()), Some("tok-secret"));

        let plain: SyncFile =
            serde_json::from_str(r#"{"credentials":{"token":"t","names_key":"n"},"links":{}}"#).unwrap();
        assert_eq!(plain.stored_credentials().map(|c| c.token.clone()), Some("t".into()));
        let damaged: SyncFile =
            serde_json::from_str(r#"{"credentials":"bm9wZQ==","links":{"a":{"remote":"r"}}}"#).unwrap();
        assert!(damaged.stored_credentials().is_none());
        assert_eq!(damaged.links["a"].remote, "r");
    }

    /// What a build from before the sealed field reads: the plain shape.
    #[derive(serde::Deserialize)]
    struct OlderFile {
        #[serde(default)]
        credentials: Option<Credentials>,
        #[serde(default)]
        links: std::collections::HashMap<String, serde_json::Value>,
    }

    #[test]
    fn an_older_build_still_reads_the_file_and_keeps_its_links() {
        let mut file = SyncFile::default();
        file.set_credentials(Some(Credentials { token: "t".into(), names_key: "n".into() }));
        file.links.insert("v".into(), super::Link { remote: "r".into(), ..super::Link::default() });
        let older: OlderFile = serde_json::from_str(&serde_json::to_string(&file).unwrap()).unwrap();
        assert!(older.credentials.is_none(), "a login, not a lost file");
        assert!(older.links.contains_key("v"));
    }

    #[test]
    fn a_file_that_does_not_parse_is_moved_aside_not_emptied() {
        let dir = std::env::temp_dir().join(format!("emerald-sync-bad-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(SETTINGS_FILE), "{ not json").unwrap();
        let file = read_file_in(&dir).unwrap();
        assert!(file.server.is_none() && file.links.is_empty());
        assert!(!dir.join(SETTINGS_FILE).exists());
        assert_eq!(std::fs::read_to_string(dir.join(BAD_FILE)).unwrap(), "{ not json");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn server_sent_events_survive_being_cut_anywhere() {
        let mut buffer = String::from("event: head\ndata: {\"head\":1}\n\n: keep-alive\n\nevent: head\ndata: {\"he");
        assert_eq!(take_events(&mut buffer), ["{\"head\":1}"]);
        buffer.push_str("ad\":2}\n\n");
        assert_eq!(take_events(&mut buffer), ["{\"head\":2}"]);
        assert!(buffer.is_empty());
    }

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
