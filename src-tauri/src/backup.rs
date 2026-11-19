//! The sealed `.emeralddb` the automatic backup still writes — until step 2
//! of the export rework replaces it with the raw backup. The app no longer
//! reads these files and offers no other way to write them; a converter
//! (#115) will bring them in.
//!
//! A backup is the vault's JSON export, sealed under the vault key, with a copy
//! of the vault's `vault.key` in front:
//!
//! ```text
//! "EMRB" | version (1 byte) | header length (u32 LE) | header JSON | sealed JSON
//! ```
//!
//! The header carries the key file as it was at export time, so the backup
//! opens with the password (or recovery key) the vault had then.

use crate::crypto::{self, Context, Key, Purpose};
use crate::keys::{self, KeyFile};

pub(crate) const MAGIC: &[u8; 4] = b"EMRB";
const VERSION: u8 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    key_file: KeyFile,
}

pub(crate) fn seal(key_file: &KeyFile, vault_key: &Key, json: &str) -> Vec<u8> {
    let header = serde_json::to_vec(&Header { key_file: key_file.clone() }).expect("serialisable");
    let files_key = crypto::subkey(vault_key, Purpose::Files);
    let payload = crypto::seal(&files_key, Context::Backup, json.as_bytes());
    let mut out = Vec::with_capacity(MAGIC.len() + 1 + 4 + header.len() + payload.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&payload);
    out
}

/// The vault's backup `content` (its JSON export), sealed under the vault key.
/// Fails for a vault that is locked or not encrypted.
pub(crate) fn seal_for_vault(app: &tauri::AppHandle, vault_id: &str, content: &str) -> Result<Vec<u8>, String> {
    let dir = crate::vault::vault_dir(app, vault_id)?;
    let vault_key = keys::key_for(app, vault_id)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
    let key_file = keys::read_key_file(&dir)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
    if !key_file.accepts(&vault_key) {
        return Err(keys::VAULT_LOCKED.to_string());
    }
    Ok(seal(&key_file, &vault_key, content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KdfParams;

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    const JSON: &str = r#"{"type":"backup","secret":"GEHEIM-BACKUP"}"#;

    /// What the converter (#115) will have to do: the header's key file opens the payload.
    fn open_with_password(bytes: &[u8], password: &str) -> String {
        let prefix = MAGIC.len() + 1 + 4;
        let len = u32::from_le_bytes(bytes[MAGIC.len() + 1..prefix].try_into().unwrap()) as usize;
        let header: Header = serde_json::from_slice(&bytes[prefix..prefix + len]).unwrap();
        let vault_key = header.key_file.unlock_with_password(password).unwrap();
        let files_key = crypto::subkey(&vault_key, Purpose::Files);
        String::from_utf8(crypto::open(&files_key, Context::Backup, &bytes[prefix + len..]).unwrap().to_vec()).unwrap()
    }

    #[test]
    fn a_backup_is_sealed_and_opens_with_the_password_of_then() {
        let (file, key, _) = KeyFile::create("correct horse", TEST_KDF).unwrap();
        let sealed = seal(&file, &key, JSON);
        assert!(sealed.starts_with(MAGIC));
        assert!(!sealed.windows(13).any(|w| w == b"GEHEIM-BACKUP"));
        assert_eq!(open_with_password(&sealed, "correct horse"), JSON);
    }
}
