//! Vault keys: `vault.key`, unlocking, and the keys held while a vault is open.
//!
//! Every encrypted vault has one random 256-bit vault key. It encrypts the
//! database (SQLCipher, raw key) and every sealed file (`crypto.rs`). It is
//! never stored in the clear: `vault.key` holds it twice, wrapped
//!
//! - under a key derived from the password with Argon2id, and
//! - under the recovery key, 32 random bytes shown to the user once.
//!
//! Changing the password rewraps the vault key; nothing else is re-encrypted.
//! A `check` value (an HMAC of a fixed label under the vault key) lets a key
//! from the OS keychain be verified before anything is opened with it.
//!
//! The vault key lives only here, in [`VaultKeys`]. Nothing returns it to the
//! webview; commands take a vault id and look the key up.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;
use zeroize::Zeroizing;

use crate::crypto::{self, Context, Key};
use crate::vault;

pub const KEY_FILE: &str = "vault.key";
pub const KEY_TEMP_FILE: &str = "vault.key.tmp";
const KEY_FILE_VERSION: u32 = 1;
const KEY_FILE_MAX_BYTES: u64 = 16 * 1024;
const CHECK_LABEL: &[u8] = b"emerald/key-check";
/// The service name under which a remembered key sits in the OS keychain.
const KEYRING_SERVICE: &str = "Emerald";

/// Errors the frontend tells apart by their text.
pub const WRONG_PASSWORD: &str = "WRONG_PASSWORD";
pub const WRONG_RECOVERY_KEY: &str = "WRONG_RECOVERY_KEY";
pub const VAULT_LOCKED: &str = "VAULT_LOCKED";
pub const VAULT_ALREADY_ENCRYPTED: &str = "VAULT_ALREADY_ENCRYPTED";
pub const VAULT_NOT_ENCRYPTED: &str = "VAULT_NOT_ENCRYPTED";
pub const VAULT_NOT_NEW: &str = "VAULT_NOT_NEW";
pub const PASSWORD_TOO_SHORT: &str = "PASSWORD_TOO_SHORT";

/// The frontend asks for more; this is the floor no caller gets under.
const MIN_PASSWORD_CHARS: usize = 8;

// ── Argon2id ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

/// 64 MiB, three passes: around half a second on a current laptop. The
/// parameters travel in the file, so raising them later leaves existing
/// vaults readable.
pub const DEFAULT_KDF: KdfParams = KdfParams { memory_kib: 64 * 1024, iterations: 3, parallelism: 1 };

/// A file from elsewhere must not be able to make unlocking take minutes or
/// gigabytes. Anything above this is refused as damaged — well above the
/// default, so it can still grow.
const MAX_KDF_MEMORY_KIB: u32 = 256 * 1024;
const MAX_KDF_ITERATIONS: u32 = 8;
const MAX_KDF_PARALLELISM: u32 = 4;

fn derive_key(password: &str, salt: &[u8], params: KdfParams) -> Result<Key, String> {
    if params.memory_kib > MAX_KDF_MEMORY_KIB
        || params.iterations > MAX_KDF_ITERATIONS
        || params.parallelism > MAX_KDF_PARALLELISM
    {
        return Err("vault.key: key derivation parameters out of range".into());
    }
    let argon = argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(params.memory_kib, params.iterations, params.parallelism, Some(32))
            .map_err(|e| format!("vault.key: {e}"))?,
    );
    let mut key = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| format!("key derivation: {e}"))?;
    Ok(key)
}

// ── Recovery key ─────────────────────────────────────────────────────────────

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// 32 bytes as 52 base32 characters in groups of four: `ABCD-EFGH-…`.
fn format_recovery_key(bytes: &[u8; 32]) -> String {
    let mut chars = Vec::with_capacity(52);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            chars.push(BASE32[((buffer >> bits) & 31) as usize]);
        }
    }
    if bits > 0 {
        chars.push(BASE32[((buffer << (5 - bits)) & 31) as usize]);
    }
    chars
        .chunks(4)
        .map(|group| std::str::from_utf8(group).expect("ascii"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Reads a recovery key back, forgiving case, dashes, spaces, and the digits
/// that look like letters (0/O, 1/I, 8/B — base32 has no 0, 1 or 8).
fn parse_recovery_key(text: &str) -> Option<Key> {
    let mut key = Zeroizing::new([0u8; 32]);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    let mut written = 0;
    let mut chars = 0;
    for c in text.chars() {
        let c = match c.to_ascii_uppercase() {
            '-' | ' ' | '\t' | '\n' | '\r' => continue,
            '0' => 'O',
            '1' => 'I',
            '8' => 'B',
            c => c,
        };
        let value = BASE32.iter().position(|&b| b as char == c)? as u32;
        chars += 1;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            if written == 32 {
                return None;
            }
            key[written] = (buffer >> bits) as u8;
            written += 1;
        }
    }
    (chars == 52 && written == 32).then_some(key)
}

// ── vault.key ────────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile {
    version: u32,
    kdf: KdfParams,
    /// base64
    salt: String,
    /// The vault key sealed under the password-derived key, base64.
    password: String,
    /// The vault key sealed under the recovery key, base64.
    recovery: String,
    /// HMAC-SHA256(vault key, CHECK_LABEL), base64.
    check: String,
}

/// The `check` value for a vault key.
fn key_check(key: &Key) -> String {
    B64.encode(crypto::keyed_hash(key, CHECK_LABEL))
}

fn check_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(PASSWORD_TOO_SHORT.into());
    }
    Ok(())
}

fn wrap(kek: &Key, vault_key: &Key) -> String {
    B64.encode(crypto::seal(kek, Context::VaultKey, vault_key.as_ref()))
}

fn unwrap(kek: &Key, wrapped: &str) -> Option<Key> {
    let sealed = B64.decode(wrapped).ok()?;
    let plain = crypto::open(kek, Context::VaultKey, &sealed).ok()?;
    let bytes: [u8; 32] = plain.as_slice().try_into().ok()?;
    Some(Zeroizing::new(bytes))
}

impl KeyFile {
    /// A new vault key with both wraps. Returns the file, the vault key, and
    /// the recovery key formatted for display.
    pub fn create(password: &str, kdf: KdfParams) -> Result<(KeyFile, Key, Zeroizing<String>), String> {
        check_password(password)?;
        let vault_key = crypto::random_key();
        let recovery: [u8; 32] = crypto::random_bytes();
        let recovery_key: Key = Zeroizing::new(recovery);
        let salt: [u8; 16] = crypto::random_bytes();
        let kek = derive_key(password, &salt, kdf)?;
        let file = KeyFile {
            version: KEY_FILE_VERSION,
            kdf,
            salt: B64.encode(salt),
            password: wrap(&kek, &vault_key),
            recovery: wrap(&recovery_key, &vault_key),
            check: key_check(&vault_key),
        };
        let shown = Zeroizing::new(format_recovery_key(&recovery));
        Ok((file, vault_key, shown))
    }

    pub fn unlock_with_password(&self, password: &str) -> Result<Key, String> {
        let salt = B64.decode(&self.salt).map_err(|_| "vault.key: damaged salt".to_string())?;
        let kek = derive_key(password, &salt, self.kdf)?;
        unwrap(&kek, &self.password)
            .filter(|key| self.accepts(key))
            .ok_or_else(|| WRONG_PASSWORD.to_string())
    }

    pub fn unlock_with_recovery_key(&self, recovery_key: &str) -> Result<Key, String> {
        let recovery = parse_recovery_key(recovery_key).ok_or_else(|| WRONG_RECOVERY_KEY.to_string())?;
        unwrap(&recovery, &self.recovery)
            .filter(|key| self.accepts(key))
            .ok_or_else(|| WRONG_RECOVERY_KEY.to_string())
    }

    /// The same file with a new password wrap, under today's parameters — not
    /// the file's, which may come from anywhere. The recovery wrap stays.
    pub fn with_password(&self, vault_key: &Key, password: &str) -> Result<KeyFile, String> {
        check_password(password)?;
        let salt: [u8; 16] = crypto::random_bytes();
        let kek = derive_key(password, &salt, DEFAULT_KDF)?;
        Ok(KeyFile {
            kdf: DEFAULT_KDF,
            salt: B64.encode(salt),
            password: wrap(&kek, vault_key),
            ..self.clone()
        })
    }

    /// Whether `key` is this vault's key.
    pub fn accepts(&self, key: &Key) -> bool {
        // Both sides are public-length base64 of a MAC; a timing difference
        // here tells an attacker nothing they could not compute themselves.
        key_check(key) == self.check
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("serialisable")
    }

    pub fn from_json(text: &str) -> Result<KeyFile, String> {
        let file: KeyFile = serde_json::from_str(text).map_err(|e| format!("vault.key: {e}"))?;
        if file.version != KEY_FILE_VERSION {
            return Err(format!("vault.key: unsupported version {}", file.version));
        }
        Ok(file)
    }
}

/// Reads `vault.key` from a vault directory. `Ok(None)` when there is none —
/// an unencrypted vault.
pub fn read_key_file(dir: &Path) -> Result<Option<KeyFile>, String> {
    let file = dir.join(KEY_FILE);
    match std::fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {KEY_FILE}: {e}")),
        Ok(md) if !md.is_file() || md.len() > KEY_FILE_MAX_BYTES => Err(format!("{KEY_FILE} is not a key file")),
        Ok(_) => {
            let text = std::fs::read_to_string(&file).map_err(|e| format!("read {KEY_FILE}: {e}"))?;
            KeyFile::from_json(&text).map(Some)
        }
    }
}

fn write_key_file(dir: &Path, file: &KeyFile) -> Result<(), String> {
    vault::write_atomic(dir, KEY_FILE, KEY_TEMP_FILE, file.to_json().as_bytes())
}

/// Whether a vault directory holds an encrypted vault. Like [`read_key_file`],
/// a link does not count as `vault.key` — but it does not count as "no key"
/// either, so it is not followed and still reads as encrypted.
pub fn is_encrypted_dir(dir: &Path) -> bool {
    std::fs::symlink_metadata(dir.join(KEY_FILE)).is_ok()
}

// ── Keys held while vaults are unlocked ──────────────────────────────────────

/// `vault id → vault key` for every unlocked vault.
#[derive(Default)]
pub struct VaultKeys(Mutex<HashMap<String, Key>>);

impl VaultKeys {
    fn lock_map(&self) -> std::sync::MutexGuard<'_, HashMap<String, Key>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn get(&self, vault_id: &str) -> Option<Key> {
        self.lock_map().get(vault_id).cloned()
    }

    pub(crate) fn insert(&self, vault_id: &str, key: Key) {
        self.lock_map().insert(vault_id.to_string(), key);
    }

    fn remove(&self, vault_id: &str) {
        self.lock_map().remove(vault_id);
    }
}

/// The vault key of a vault: `Ok(None)` for an unencrypted vault,
/// [`VAULT_LOCKED`] for an encrypted one that is not unlocked. Callers derive
/// what they need from it with [`crypto::subkey`].
pub fn key_for(app: &tauri::AppHandle, vault_id: &str) -> Result<Option<Key>, String> {
    let dir = vault::vault_dir(app, vault_id)?;
    if !is_encrypted_dir(&dir) {
        return Ok(None);
    }
    app.state::<VaultKeys>()
        .get(vault_id)
        .map(Some)
        .ok_or_else(|| VAULT_LOCKED.to_string())
}

// ── OS keychain ──────────────────────────────────────────────────────────────

fn keyring_entry(vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("vault:{vault_id}")).map_err(|e| e.to_string())
}

fn remember(vault_id: &str, key: &Key) -> Result<(), String> {
    let encoded = Zeroizing::new(B64.encode(key.as_ref()));
    keyring_entry(vault_id)?.set_password(&encoded).map_err(|e| e.to_string())
}

fn remembered(vault_id: &str) -> Option<Key> {
    let encoded = Zeroizing::new(keyring_entry(vault_id).ok()?.get_password().ok()?);
    let bytes = Zeroizing::new(B64.decode(encoded.as_bytes()).ok()?);
    let key: [u8; 32] = bytes.as_slice().try_into().ok()?;
    Some(Zeroizing::new(key))
}

/// Removes a remembered key. A missing entry is not an error.
pub fn forget(vault_id: &str) -> Result<(), String> {
    match keyring_entry(vault_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Applies the "remember on this device" switch. `None`: the user left it
/// alone, so the keychain is not touched — a keychain that failed to answer
/// once must not cost a valid entry. Returns whether the key is remembered
/// afterwards, so the dialog can say when the keychain refused.
pub(crate) fn apply_remember(vault_id: &str, key: &Key, wanted: Option<bool>) -> bool {
    match wanted {
        None => false,
        Some(true) => remember(vault_id, key)
            .map_err(|e| eprintln!("[keys] keychain: {e}"))
            .is_ok(),
        Some(false) => {
            forget(vault_id).unwrap_or_else(|e| eprintln!("[keys] keychain: {e}"));
            false
        }
    }
}

/// Forgets a vault's key everywhere — in memory and in the keychain. For a
/// vault whose files are gone.
pub fn discard(app: &tauri::AppHandle, vault_id: &str) {
    app.state::<VaultKeys>().remove(vault_id);
    forget(vault_id).unwrap_or_else(|e| eprintln!("[keys] keychain: {e}"));
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    /// Whether `emerald.db` exists — a vault without one is new.
    has_database: bool,
    encrypted: bool,
    unlocked: bool,
}

/// Where a vault stands. Never touches the keychain — that is
/// [`vault_unlock_remembered`]'s job, once, when it matters. Fails like the
/// other storage commands when the vault's folder is gone.
#[tauri::command]
pub fn vault_key_status(app: tauri::AppHandle, vault_id: String) -> Result<KeyStatus, String> {
    let dir = vault::vault_dir(&app, &vault_id)?;
    vault::directory_state(&dir)?;
    // Eine abgebrochene Verschlüsselung erst zu Ende bringen oder zurücknehmen.
    crate::encrypt_existing::recover_interrupted(&dir)?;
    let encrypted = is_encrypted_dir(&dir);
    Ok(KeyStatus {
        has_database: dir.join(vault::DB_FILE).is_file(),
        encrypted,
        unlocked: encrypted && app.state::<VaultKeys>().get(&vault_id).is_some(),
    })
}

/// Whether this system has a keychain to remember keys in. A Linux desktop
/// without a Secret Service has none; the dialog then does not offer it.
#[tauri::command]
pub async fn keychain_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "probe") else {
            return false;
        };
        matches!(entry.get_password(), Ok(_) | Err(keyring::Error::NoEntry))
    })
    .await
    .unwrap_or(false)
}

/// Serialises key creation: between "is there a key or a database?" and
/// writing `vault.key`, nothing else may create either.
static CREATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedKey {
    /// The recovery key — the only time it ever leaves Rust.
    pub(crate) recovery_key: Zeroizing<String>,
    pub(crate) remembered: bool,
}

/// Creates `vault.key` for a new vault and unlocks it. Refuses a vault that is
/// encrypted already, and one that has a database: that database is plain,
/// and a key would only make it unopenable.
#[tauri::command]
pub async fn vault_create_key(
    app: tauri::AppHandle,
    vault_id: String,
    password: Zeroizing<String>,
    remember_key: Option<bool>,
) -> Result<CreatedKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = vault::vault_dir(&app, &vault_id)?;
        vault::directory_state(&dir)?;
        let _guard = CREATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if is_encrypted_dir(&dir) {
            return Err(VAULT_ALREADY_ENCRYPTED.to_string());
        }
        if dir.join(vault::DB_FILE).exists() {
            return Err(VAULT_NOT_NEW.to_string());
        }
        let (file, vault_key, recovery_key) = KeyFile::create(&password, DEFAULT_KDF)?;
        write_key_file(&dir, &file)?;
        let remembered = apply_remember(&vault_id, &vault_key, remember_key);
        app.state::<VaultKeys>().insert(&vault_id, vault_key);
        Ok(CreatedKey { recovery_key, remembered })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn load_key_file(app: &tauri::AppHandle, vault_id: &str) -> Result<(std::path::PathBuf, KeyFile), String> {
    let dir = vault::vault_dir(app, vault_id)?;
    let file = read_key_file(&dir)?.ok_or_else(|| VAULT_NOT_ENCRYPTED.to_string())?;
    Ok((dir, file))
}

/// Unlocks with the password. Returns whether the key is now remembered.
#[tauri::command]
pub async fn vault_unlock(
    app: tauri::AppHandle,
    vault_id: String,
    password: Zeroizing<String>,
    remember_key: Option<bool>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, file) = load_key_file(&app, &vault_id)?;
        let key = file.unlock_with_password(&password)?;
        let remembered = apply_remember(&vault_id, &key, remember_key);
        app.state::<VaultKeys>().insert(&vault_id, key);
        Ok(remembered)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unlocks with the key remembered in the OS keychain. `false` when there is
/// none or it does not fit this vault (the stale entry is then removed).
/// Off the main thread: a keychain may ask the user first.
#[tauri::command]
pub async fn vault_unlock_remembered(app: tauri::AppHandle, vault_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, file) = load_key_file(&app, &vault_id)?;
        match remembered(&vault_id) {
            Some(key) if file.accepts(&key) => {
                app.state::<VaultKeys>().insert(&vault_id, key);
                Ok(true)
            }
            Some(_) => {
                forget(&vault_id).ok();
                Ok(false)
            }
            None => Ok(false),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sets a new password with the recovery key and unlocks the vault. Returns
/// whether the key is now remembered.
#[tauri::command]
pub async fn vault_recover(
    app: tauri::AppHandle,
    vault_id: String,
    recovery_key: Zeroizing<String>,
    new_password: Zeroizing<String>,
    remember_key: Option<bool>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, file) = load_key_file(&app, &vault_id)?;
        let key = file.unlock_with_recovery_key(&recovery_key)?;
        write_key_file(&dir, &file.with_password(&key, &new_password)?)?;
        let remembered = apply_remember(&vault_id, &key, remember_key);
        app.state::<VaultKeys>().insert(&vault_id, key);
        Ok(remembered)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vault_change_password(
    app: tauri::AppHandle,
    vault_id: String,
    current_password: Zeroizing<String>,
    new_password: Zeroizing<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, file) = load_key_file(&app, &vault_id)?;
        let key = file.unlock_with_password(&current_password)?;
        write_key_file(&dir, &file.with_password(&key, &new_password)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Turns "remember on this device" on or off for an unlocked vault. Returns
/// whether the key is remembered afterwards.
#[tauri::command]
pub async fn vault_set_remembered(app: tauri::AppHandle, vault_id: String, remember_key: bool) -> Result<bool, String> {
    let key = app.state::<VaultKeys>().get(&vault_id).ok_or_else(|| VAULT_LOCKED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || apply_remember(&vault_id, &key, Some(remember_key)))
        .await
        .map_err(|e| e.to_string())
}

/// Drops the vault's key from memory and closes its databases. The key goes
/// first: a `db_load` racing this one then fails instead of opening a pool
/// that outlives the lock (`db_load` checks again before it keeps its pool).
/// The remembered key, if any, stays — locking is not forgetting.
#[tauri::command]
pub async fn vault_lock(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    app.state::<VaultKeys>().remove(&vault_id);
    crate::db::close_vault(&app, &vault_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Small enough that debug-build tests stay fast.
    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };

    #[test]
    fn password_unlocks_and_wrong_password_does_not() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        assert_eq!(*file.unlock_with_password("correct horse").unwrap(), *key);
        assert_eq!(file.unlock_with_password("wrong horse!").unwrap_err(), WRONG_PASSWORD);
    }

    #[test]
    fn recovery_key_unlocks_in_any_reasonable_spelling() {
        let (file, key, recovery) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        assert_eq!(recovery.len(), 52 + 12);
        assert_eq!(*file.unlock_with_recovery_key(&recovery).unwrap(), *key);
        let sloppy = recovery.to_lowercase().replace('-', " ").replace('o', "0");
        assert_eq!(*file.unlock_with_recovery_key(&sloppy).unwrap(), *key);
    }

    #[test]
    fn wrong_recovery_key_fails() {
        let (file, _, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let (_, _, other) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        assert_eq!(file.unlock_with_recovery_key(&other).unwrap_err(), WRONG_RECOVERY_KEY);
        assert_eq!(file.unlock_with_recovery_key("ABCD").unwrap_err(), WRONG_RECOVERY_KEY);
        assert_eq!(file.unlock_with_recovery_key("not base32 at all!").unwrap_err(), WRONG_RECOVERY_KEY);
    }

    #[test]
    fn new_password_keeps_key_and_recovery() {
        let (file, key, recovery) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let changed = file.with_password(&key, "battery staple").unwrap();
        assert_eq!(changed.unlock_with_password("correct horse").unwrap_err(), WRONG_PASSWORD);
        assert_eq!(*changed.unlock_with_password("battery staple").unwrap(), *key);
        assert_eq!(*changed.unlock_with_recovery_key(&recovery).unwrap(), *key);
    }

    #[test]
    fn short_passwords_are_refused() {
        assert_eq!(KeyFile::create("short", TEST_KDF).err().unwrap(), PASSWORD_TOO_SHORT);
    }

    #[test]
    fn check_tells_keys_apart() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        assert!(file.accepts(&key));
        assert!(!file.accepts(&crypto::random_key()));
    }

    #[test]
    fn file_round_trips_through_json() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let back = KeyFile::from_json(&file.to_json()).unwrap();
        assert_eq!(*back.unlock_with_password("correct horse").unwrap(), *key);
    }

    #[test]
    fn hostile_kdf_parameters_are_refused() {
        let (file, _, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let mut json: serde_json::Value = serde_json::from_str(&file.to_json()).unwrap();
        json["kdf"]["memoryKib"] = serde_json::json!(u32::MAX);
        let hostile = KeyFile::from_json(&json.to_string()).unwrap();
        assert!(hostile.unlock_with_password("correct horse").unwrap_err().contains("out of range"));
    }

    #[test]
    fn recovery_key_format_round_trips() {
        for _ in 0..50 {
            let bytes: [u8; 32] = crypto::random_bytes();
            assert_eq!(*parse_recovery_key(&format_recovery_key(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn key_file_on_disk() {
        let dir = std::env::temp_dir().join(format!("emerald-keys-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_key_file(&dir).unwrap().is_none());
        assert!(!is_encrypted_dir(&dir));
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        write_key_file(&dir, &file).unwrap();
        assert!(is_encrypted_dir(&dir));
        let back = read_key_file(&dir).unwrap().unwrap();
        assert!(back.accepts(&key));
        std::fs::remove_dir_all(&dir).ok();
    }
}
