//! Vault keys: `vault.key`, unlocking, and the keys held while a vault is open.
//!
//! Encryption is chosen when a vault is created. A plain vault has no
//! `vault.key` and no key; it can be encrypted later (`reencrypt::vault_encrypt`),
//! never the other way round. Every encrypted vault has one random 256-bit
//! vault key. It encrypts the database (SQLCipher, raw key) and every sealed
//! file (`crypto.rs`). It is never stored in the clear: `vault.key` holds it
//! twice, wrapped
//!
//! - under a key derived from the password with Argon2id, and
//! - under the recovery key, 32 random bytes shown to the user once.
//!
//! Changing the password puts the vault under a new vault key (`reencrypt.rs`).
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
/// The service name under which a remembered key sits in the OS keychain:
/// "Emerald" plus the app's identifier, set at start ([`init_keychain`]).
/// The release, the dev build and every MCP slot are separate apps — and
/// vault ids like `default` repeat between them, so a shared name would let
/// one overwrite or, finding it stale, delete the other's entry.
static KEYRING_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn init_keychain(identifier: &str) {
    KEYRING_SERVICE.get_or_init(|| format!("Emerald ({identifier})"));
}

pub(crate) fn keyring_service() -> &'static str {
    KEYRING_SERVICE.get().map(String::as_str).unwrap_or("Emerald")
}

/// Errors the frontend tells apart by their text.
pub const WRONG_PASSWORD: &str = "WRONG_PASSWORD";
pub const WRONG_RECOVERY_KEY: &str = "WRONG_RECOVERY_KEY";
pub const VAULT_LOCKED: &str = "VAULT_LOCKED";
pub const VAULT_ALREADY_ENCRYPTED: &str = "VAULT_ALREADY_ENCRYPTED";
pub const VAULT_NOT_ENCRYPTED: &str = "VAULT_NOT_ENCRYPTED";
pub const VAULT_NOT_NEW: &str = "VAULT_NOT_NEW";
pub const PASSWORD_EMPTY: &str = "PASSWORD_EMPTY";
/// `db_load` and `key_for` of a plain vault while a re-encryption runs — of
/// any vault, as the run is counted process-wide: its files may be about to
/// be replaced.
pub const VAULT_REENCRYPTING: &str = "VAULT_REENCRYPTING";
/// A vault without `vault.key` whose database is not plain SQLite: an
/// encrypted vault that lost its key file.
pub const VAULT_KEY_MISSING: &str = "VAULT_KEY_MISSING";
/// A vault without `vault.key` that this installation knew as encrypted, and
/// whose database is plain or gone: it may have been swapped (`vault_marks.rs`).
pub const VAULT_TAMPERED: &str = "VAULT_TAMPERED";
/// A vault without `vault.key` while the list of encrypted vaults cannot be
/// read: it cannot be told from a swapped one (`vault_marks.rs`).
pub const VAULT_MARKS_UNREADABLE: &str = "VAULT_MARKS_UNREADABLE";

/// For a vault without `vault.key`: whether its database is really plain —
/// empty (a new plain vault) or starting with SQLite's header. An encrypted
/// vault that lost `vault.key` fails here instead of being opened or backed
/// up as plain. No database at all counts as plain: nothing to mistake.
pub(crate) fn plain_database_or_none(dir: &Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(dir.join(vault::DB_FILE)) else { return true };
    let mut head = [0u8; 16];
    let mut got = 0;
    while got < head.len() {
        match file.read(&mut head[got..]) {
            Ok(0) => break,
            Ok(n) => got += n,
            Err(_) => return false,
        }
    }
    got == 0 || (got == head.len() && &head == b"SQLite format 3\0")
}

// ── Argon2id ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

/// 64 MiB, three passes: about 0.15 s on a current machine (release build). The
/// parameters travel in the file, so raising them later leaves existing
/// vaults readable.
pub const DEFAULT_KDF: KdfParams = KdfParams { memory_kib: 64 * 1024, iterations: 3, parallelism: 1 };

/// A file from elsewhere must not be able to make unlocking take minutes or
/// gigabytes. Anything above this is refused as damaged — well above the
/// default, so it can still grow.
const MAX_KDF_MEMORY_KIB: u32 = 256 * 1024;
const MAX_KDF_ITERATIONS: u32 = 8;
const MAX_KDF_PARALLELISM: u32 = 4;

pub(crate) fn derive_key(password: &str, salt: &[u8], params: KdfParams) -> Result<Key, String> {
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

/// Any password but an empty one: its strength is the user's choice.
pub(crate) fn check_password(password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Err(PASSWORD_EMPTY.into());
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

    /// The public check value — what the re-encryption marker names its new
    /// key by (`reencrypt.rs`).
    pub fn check(&self) -> &str {
        &self.check
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
    read_key_file_named(dir, KEY_FILE)
}

/// A key file under another name — `vault.key.pending` during a
/// re-encryption. Links and oversized files are refused.
pub(crate) fn read_key_file_named(dir: &Path, name: &str) -> Result<Option<KeyFile>, String> {
    let file = dir.join(name);
    match std::fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {name}: {e}")),
        Ok(md) if !md.is_file() || md.len() > KEY_FILE_MAX_BYTES => Err(format!("{name} is not a key file")),
        Ok(_) => {
            let text = std::fs::read_to_string(&file).map_err(|e| format!("read {name}: {e}"))?;
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

    /// The keys of every unlocked vault — for a backup that may be from any of them.
    pub(crate) fn all(&self) -> Vec<Key> {
        self.lock_map().values().cloned().collect()
    }

    pub fn get(&self, vault_id: &str) -> Option<Key> {
        self.lock_map().get(vault_id).cloned()
    }

    pub(crate) fn insert(&self, vault_id: &str, key: Key) {
        self.lock_map().insert(vault_id.to_string(), key);
    }

    pub(crate) fn remove(&self, vault_id: &str) {
        self.lock_map().remove(vault_id);
    }
}

/// The vault key of a vault: `Ok(None)` for an unencrypted vault,
/// [`VAULT_LOCKED`] for an encrypted one that is not unlocked — and for a
/// plain one whose encryption was cut short, [`VAULT_REENCRYPTING`] while
/// a re-encryption runs. Callers derive what they need from it with
/// [`crypto::subkey`].
pub fn key_for(app: &tauri::AppHandle, vault_id: &str) -> Result<Option<Key>, String> {
    let dir = vault::vault_dir(app, vault_id)?;
    if !is_encrypted_dir(&dir) {
        // A plain vault whose encryption still has to finish its swap, or
        // any re-encryption running (counted process-wide, so this holds for
        // every plain vault): whatever is written now in the clear could be
        // thrown away by a swap.
        if crate::reencrypt::interrupted(&dir) {
            return Err(VAULT_LOCKED.to_string());
        }
        if crate::reencrypt::is_reencrypting() {
            return Err(VAULT_REENCRYPTING.to_string());
        }
        // Once encrypted, never plain: whatever is written now would lie in
        // the clear in a folder that may have been swapped.
        crate::vault_marks::refuse_if_swapped(crate::vault_marks::mark_of(app, vault_id), &dir)?;
        return Ok(None);
    }
    app.state::<VaultKeys>()
        .get(vault_id)
        .map(Some)
        .ok_or_else(|| VAULT_LOCKED.to_string())
}

// ── OS keychain ──────────────────────────────────────────────────────────────

fn keyring_entry(vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(keyring_service(), &format!("vault:{vault_id}")).map_err(|e| e.to_string())
}

fn remember(vault_id: &str, key: &Key) -> Result<(), String> {
    let encoded = Zeroizing::new(B64.encode(key.as_ref()));
    keyring_entry(vault_id)?.set_password(&encoded).map_err(|e| e.to_string())
}

/// Whether the keychain holds a key for this vault — not whether it fits.
pub(crate) fn is_remembered(vault_id: &str) -> bool {
    remembered(vault_id).is_some()
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
/// other storage commands when the vault's folder is gone. Off the main
/// thread: it finishes an interrupted re-encryption first, which moves files.
#[tauri::command]
pub async fn vault_key_status(app: tauri::AppHandle, vault_id: String) -> Result<KeyStatus, String> {
    #[cfg(debug_assertions)]
    crate::reencrypt::dev_seed(&app, &vault_id).await;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = vault::vault_dir(&app, &vault_id)?;
        vault::directory_state(&dir)?;
        crate::reencrypt::recover_if_idle(&dir)?;
        let encrypted = is_encrypted_dir(&dir);
        // Refused before the frontend could open it as a plain vault — or
        // offer to create one in its place.
        let mark = crate::vault_marks::mark_if_encrypted(&app, &vault_id, &dir);
        crate::vault_marks::refuse_if_swapped(mark, &dir)?;
        // A key in memory that does not fit this folder — the vault was
        // relocated, or a swap only just finished — is no key: drop it, and
        // the frontend asks again.
        let keys = app.state::<VaultKeys>();
        let unlocked = encrypted
            && match keys.get(&vault_id) {
                Some(key) if read_key_file(&dir)?.is_some_and(|file| file.accepts(&key)) => true,
                Some(_) => {
                    keys.remove(&vault_id);
                    false
                }
                None => false,
            };
        Ok(KeyStatus { has_database: dir.join(vault::DB_FILE).is_file(), encrypted, unlocked })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether this system has a keychain to remember keys in. A Linux desktop
/// without a Secret Service has none; the dialog then does not offer it.
#[tauri::command]
pub async fn keychain_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(entry) = keyring::Entry::new(keyring_service(), "probe") else {
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

/// Refuses a vault that is not new: one with `vault.key` or a database.
fn check_new(dir: &Path) -> Result<(), String> {
    if is_encrypted_dir(dir) {
        return Err(VAULT_ALREADY_ENCRYPTED.to_string());
    }
    if dir.join(vault::DB_FILE).exists() {
        return Err(VAULT_NOT_NEW.to_string());
    }
    Ok(())
}

/// Creates `vault.key` for a new vault and unlocks it. Refuses a vault that is
/// encrypted already, and one that has a database: that database is plain,
/// and a key would only make it unopenable — a plain vault is encrypted by
/// `reencrypt::vault_encrypt`.
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
        check_new(&dir)?;
        let (file, vault_key, recovery_key) = KeyFile::create(&password, DEFAULT_KDF)?;
        write_key_file(&dir, &file)?;
        crate::vault_marks::mark(&app, &vault_id);
        let remembered = apply_remember(&vault_id, &vault_key, remember_key);
        app.state::<VaultKeys>().insert(&vault_id, vault_key);
        Ok(CreatedKey { recovery_key, remembered })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Makes a new vault a plain one: an empty, unencrypted `emerald.db` and no
/// `vault.key`. The only place a plain database is created — `db_load`
/// opens a plain vault's database but never makes one.
#[tauri::command]
pub async fn vault_create_plain(app: tauri::AppHandle, vault_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = vault::vault_dir(&app, &vault_id)?;
        vault::directory_state(&dir)?;
        let _guard = CREATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        create_plain(&dir, crate::vault_marks::mark_of(&app, &vault_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `mark`: a vault that was encrypted once — its key file and database gone —
/// must not come back as a plain one.
fn create_plain(dir: &Path, mark: crate::vault_marks::Mark) -> Result<(), String> {
    check_new(dir)?;
    crate::vault_marks::refuse_if_swapped(mark, dir)?;
    // An empty file is an empty SQLite database; the schema follows on open.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join(vault::DB_FILE))
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("create {}: {e}", vault::DB_FILE))
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

/// Whether the keychain holds this vault's key. Off the main thread: a
/// keychain may ask the user first.
#[tauri::command]
pub async fn vault_is_remembered(vault_id: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || is_remembered(&vault_id))
        .await
        .unwrap_or(false)
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
    fn any_password_but_an_empty_one_is_taken() {
        assert_eq!(KeyFile::create("", TEST_KDF).err().unwrap(), PASSWORD_EMPTY);
        let (file, key, _) = KeyFile::create("x", TEST_KDF).unwrap();
        assert_eq!(*file.unlock_with_password("x").unwrap(), *key);
    }

    #[test]
    fn a_plain_vault_is_made_only_where_nothing_is() {
        let dir = std::env::temp_dir().join(format!("emerald-keys-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        create_plain(&dir, crate::vault_marks::Mark::No).unwrap();
        assert!(dir.join(vault::DB_FILE).is_file());
        assert!(!is_encrypted_dir(&dir));
        assert_eq!(create_plain(&dir, crate::vault_marks::Mark::No).unwrap_err(), VAULT_NOT_NEW);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_vault_known_as_encrypted_is_not_made_plain() {
        // `vault.key` and database both removed: the empty folder looks new.
        let dir = std::env::temp_dir().join(format!("emerald-keys-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(create_plain(&dir, crate::vault_marks::Mark::Yes).unwrap_err(), VAULT_TAMPERED);
        assert!(!dir.join(vault::DB_FILE).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_a_plain_database_counts_as_plain() {
        let dir = std::env::temp_dir().join(format!("emerald-keys-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(plain_database_or_none(&dir), "no database");
        create_plain(&dir, crate::vault_marks::Mark::No).unwrap();
        assert!(plain_database_or_none(&dir), "empty");
        std::fs::write(dir.join(vault::DB_FILE), b"SQLite format 3\0and pages").unwrap();
        assert!(plain_database_or_none(&dir), "plain");
        // SQLCipher pages look like noise from the first byte on.
        std::fs::write(dir.join(vault::DB_FILE), crypto::random_bytes::<32>()).unwrap();
        assert!(!plain_database_or_none(&dir), "encrypted");
        std::fs::remove_dir_all(&dir).ok();
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
