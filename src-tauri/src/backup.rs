//! Encrypted `.emeralddb` backups.
//!
//! A backup is the vault's JSON export, sealed under the vault key, with a copy
//! of the vault's `vault.key` in front:
//!
//! ```text
//! "EMRB" | version (1 byte) | header length (u32 LE) | header JSON | sealed JSON
//! ```
//!
//! The header carries the key file as it was at export time, so the backup
//! opens with the password (or recovery key) the vault had then — also after
//! a later password change, which replaces the vault key, and on another
//! machine. A backup of a vault that is unlocked right now opens without
//! asking: its key is tried first.
//!
//! Backups from before encryption are plain JSON and are still read.

use zeroize::Zeroizing;

use crate::crypto::{self, Context, Key, Purpose};
use crate::keys::{self, KeyFile};

const MAGIC: &[u8; 4] = b"EMRB";
const VERSION: u8 = 1;
const PREFIX_LEN: usize = MAGIC.len() + 1 + 4;
/// A key file is well under a kilobyte; anything near this is not one.
const MAX_HEADER_LEN: usize = 64 * 1024;

/// What the frontend tells apart.
pub const BACKUP_LOCKED: &str = "BACKUP_LOCKED";
const NOT_A_BACKUP: &str = "not an Emerald backup file";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    key_file: KeyFile,
}

fn seal(key_file: &KeyFile, vault_key: &Key, json: &str) -> Vec<u8> {
    let header = serde_json::to_vec(&Header { key_file: key_file.clone() }).expect("serialisable");
    let files_key = crypto::subkey(vault_key, Purpose::Files);
    let payload = crypto::seal(&files_key, Context::Backup, json.as_bytes());
    let mut out = Vec::with_capacity(PREFIX_LEN + header.len() + payload.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&payload);
    out
}

/// How a backup may be opened.
pub struct Secrets<'a> {
    /// Keys of the vaults that are unlocked right now.
    pub unlocked: Vec<Key>,
    pub password: Option<&'a str>,
    pub recovery_key: Option<&'a str>,
}

/// The backup's JSON. Errors: [`BACKUP_LOCKED`] when no secret was given that
/// could be tried, `WRONG_PASSWORD` / `WRONG_RECOVERY_KEY` when one was wrong.
fn open(bytes: &[u8], secrets: &Secrets) -> Result<Zeroizing<String>, String> {
    if !bytes.starts_with(MAGIC) {
        // Vor der Verschlüsselung: reines JSON.
        return String::from_utf8(bytes.to_vec()).map(Zeroizing::new).map_err(|_| NOT_A_BACKUP.to_string());
    }
    if bytes.len() < PREFIX_LEN {
        return Err(NOT_A_BACKUP.into());
    }
    let version = bytes[MAGIC.len()];
    if version != VERSION {
        return Err(format!("unsupported backup encryption version {version}"));
    }
    let header_len = u32::from_le_bytes(bytes[MAGIC.len() + 1..PREFIX_LEN].try_into().expect("4 bytes")) as usize;
    if header_len > MAX_HEADER_LEN || PREFIX_LEN + header_len > bytes.len() {
        return Err(NOT_A_BACKUP.into());
    }
    let header: Header =
        serde_json::from_slice(&bytes[PREFIX_LEN..PREFIX_LEN + header_len]).map_err(|_| NOT_A_BACKUP.to_string())?;
    let payload = &bytes[PREFIX_LEN + header_len..];

    let vault_key = match secrets.unlocked.iter().find(|key| header.key_file.accepts(key)) {
        Some(key) => key.clone(),
        None => match (secrets.password, secrets.recovery_key) {
            (Some(password), _) => header.key_file.unlock_with_password(password)?,
            (None, Some(recovery)) => header.key_file.unlock_with_recovery_key(recovery)?,
            (None, None) => return Err(BACKUP_LOCKED.into()),
        },
    };
    let files_key = crypto::subkey(&vault_key, Purpose::Files);
    let plain = crypto::open(&files_key, Context::Backup, payload).map_err(|e| format!("backup: {e}"))?;
    String::from_utf8(plain.to_vec()).map(Zeroizing::new).map_err(|_| NOT_A_BACKUP.to_string())
}

fn backup_path_ok(path: &str) -> Result<(), String> {
    if crate::ext_for_path(path) != "emeralddb" {
        return Err("unsupported file type".to_string());
    }
    Ok(())
}

/// Writes the vault's backup `content` (its JSON export) to `path`, sealed
/// under the vault key.
#[tauri::command]
pub async fn write_backup_file(app: tauri::AppHandle, vault_id: String, path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup_path_ok(&path)?;
        let dir = crate::vault::vault_dir(&app, &vault_id)?;
        let vault_key = keys::key_for(&app, &vault_id)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
        let key_file = keys::read_key_file(&dir)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
        if !key_file.accepts(&vault_key) {
            return Err(keys::VAULT_LOCKED.to_string());
        }
        let target = crate::guarded_write_target(&app, &path)?;
        std::fs::write(target, seal(&key_file, &vault_key, &content)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads a backup — encrypted or from before encryption — and returns its
/// JSON. See [`open`] for the errors.
#[tauri::command]
pub async fn read_backup_file(
    app: tauri::AppHandle,
    path: String,
    password: Option<Zeroizing<String>>,
    recovery_key: Option<Zeroizing<String>>,
) -> Result<Zeroizing<String>, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        backup_path_ok(&path)?;
        let file = crate::guarded_read_path(&app, &path)?;
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        let secrets = Secrets {
            unlocked: app.state::<keys::VaultKeys>().all(),
            password: password.as_deref().map(String::as_str),
            recovery_key: recovery_key.as_deref().map(String::as_str),
        };
        open(&bytes, &secrets)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KdfParams;

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    const JSON: &str = r#"{"type":"backup","secret":"GEHEIM-BACKUP"}"#;

    fn none() -> Secrets<'static> {
        Secrets { unlocked: Vec::new(), password: None, recovery_key: None }
    }

    #[test]
    fn a_backup_is_sealed_and_opens_with_any_of_its_secrets() {
        let (file, key, recovery) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let sealed = seal(&file, &key, JSON);
        assert!(!sealed.windows(13).any(|w| w == b"GEHEIM-BACKUP"));

        assert_eq!(open(&sealed, &none()).unwrap_err(), BACKUP_LOCKED);
        let unlocked = Secrets { unlocked: vec![crypto::random_key(), key.clone()], ..none() };
        assert_eq!(open(&sealed, &unlocked).unwrap().as_str(), JSON);
        let by_password = Secrets { password: Some("correct horse"), ..none() };
        assert_eq!(open(&sealed, &by_password).unwrap().as_str(), JSON);
        let by_recovery = Secrets { recovery_key: Some(&recovery), ..none() };
        assert_eq!(open(&sealed, &by_recovery).unwrap().as_str(), JSON);
    }

    #[test]
    fn wrong_secrets_are_named() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let sealed = seal(&file, &key, JSON);
        let wrong = Secrets { password: Some("wrong horse!"), ..none() };
        assert_eq!(open(&sealed, &wrong).unwrap_err(), keys::WRONG_PASSWORD);
        let other_vault = Secrets { unlocked: vec![crypto::random_key()], ..none() };
        assert_eq!(open(&sealed, &other_vault).unwrap_err(), BACKUP_LOCKED);
    }

    #[test]
    fn plain_backups_from_before_encryption_still_read() {
        assert_eq!(open(JSON.as_bytes(), &none()).unwrap().as_str(), JSON);
    }

    #[test]
    fn damaged_files_are_refused() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let mut sealed = seal(&file, &key, JSON);
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        let by_password = Secrets { password: Some("correct horse"), ..none() };
        assert!(open(&sealed, &by_password).is_err());
        assert!(open(b"EMRB\x01\xff\xff\xff\xff", &by_password).is_err());
        assert!(open(b"EMRB", &by_password).is_err());
    }
}
