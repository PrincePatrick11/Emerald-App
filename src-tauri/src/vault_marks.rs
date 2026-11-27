//! Which vaults this installation has known as encrypted.
//!
//! A plain vault is one without `vault.key`, and it opens without a password.
//! That alone would let anyone who can write into a vault folder delete an
//! encrypted vault's `vault.key`, lay a plain database of their own in its
//! place, and have the app open it without asking — everything written
//! afterwards would lie readable on the disk.
//!
//! So the app notes, outside every vault folder, which vaults it has known as
//! encrypted: `encrypted-vaults.json` in the app data directory, a list of
//! vault ids. A vault on that list that turns up without `vault.key` is not
//! opened, backed up or written to in the clear ([`refuse_if_swapped`]).
//!
//! - **Who writes it.** Only Rust. The path-taking write commands refuse the app
//!   data directory outside `vaults.json` and `vaults/`
//!   (`lib.rs::app_data_write_allowed`), so the webview cannot reach it, and
//!   whoever can only write into a vault folder cannot either.
//! - **When an id is added.** When a key is created for a new vault, when a
//!   plain vault has been encrypted, and whenever a vault is found with
//!   `vault.key` ([`mark_if_encrypted`]) — opening it, or its automatic backup.
//!   That last rule is what covers vaults encrypted before this list existed.
//! - **Never removed.** No command takes an id off the list; there is no way
//!   from encrypted back to plain.
//! - **By id, not by folder.** A vault relocated to another folder keeps its
//!   mark. A folder removed from the vault list and added again gets a new id
//!   and starts unmarked — until it is first seen encrypted. That is also the
//!   one way out when a foreign `vault.key` was slipped into a plain vault.
//! - **Read from the disk every time, never cached.** It is asked only for
//!   vaults without `vault.key`, and a second app instance on the same data
//!   directory may have added an id since. A mark is added by reading the file
//!   and writing it back with the id, so it never overwrites another's marks
//!   from a stale copy.
//! - **An unreadable list** (damaged, a link, too large, from a newer app) is
//!   left as it is and nothing more is written to it. Until it reads again, no
//!   vault without `vault.key` opens — neither a plain one nor a new one —, with
//!   an error of its own ([`keys::VAULT_MARKS_UNREADABLE`]) that names the file,
//!   rather than silently opening without the protection.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

use crate::{keys, vault};

pub const MARKS_FILE: &str = "encrypted-vaults.json";
const MARKS_TEMP_FILE: &str = "encrypted-vaults.json.tmp";
const MARKS_VERSION: u32 = 1;
/// A guard against a runaway file, not a format limit: an id is at most 64 bytes.
const MARKS_MAX_BYTES: u64 = 1024 * 1024;

/// Serialises read-add-write within this process.
static WRITING: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize, serde::Deserialize)]
struct MarksFile {
    version: u32,
    vaults: BTreeSet<String>,
}

/// What the list says about one vault.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    /// Never known as encrypted.
    No,
    /// Known as encrypted.
    Yes,
    /// The list cannot be read: treated like [`Mark::Yes`], with its own error.
    Unknown,
}

/// `None`: the list is unreadable.
fn read_list(dir: &Path) -> Option<BTreeSet<String>> {
    let file = dir.join(MARKS_FILE);
    let text = match std::fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(BTreeSet::new()),
        Ok(md) if md.is_file() && md.len() <= MARKS_MAX_BYTES => match std::fs::read_to_string(&file) {
            Ok(text) => text,
            Err(e) => {
                eprintln!("[marks] read {MARKS_FILE}: {e}");
                return None;
            }
        },
        _ => {
            eprintln!("[marks] {MARKS_FILE} is not a plain file of a sane size");
            return None;
        }
    };
    match serde_json::from_str::<MarksFile>(&text) {
        Ok(parsed) if parsed.version == MARKS_VERSION => Some(parsed.vaults),
        Ok(parsed) => {
            eprintln!("[marks] {MARKS_FILE}: unsupported version {}", parsed.version);
            None
        }
        Err(e) => {
            eprintln!("[marks] {MARKS_FILE}: {e}");
            None
        }
    }
}

fn mark_of_in(dir: &Path, vault_id: &str) -> Mark {
    match read_list(dir) {
        Some(ids) if ids.contains(vault_id) => Mark::Yes,
        Some(_) => Mark::No,
        None => Mark::Unknown,
    }
}

/// Adds `vault_id` to the list on the disk. An unreadable list is left alone:
/// every vault counts as marked while it is.
fn mark_in(dir: &Path, vault_id: &str) -> Result<(), String> {
    let _writing = WRITING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(mut ids) = read_list(dir) else { return Ok(()) };
    if !ids.insert(vault_id.to_string()) {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&MarksFile { version: MARKS_VERSION, vaults: ids })
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    vault::write_atomic(dir, MARKS_FILE, MARKS_TEMP_FILE, text.as_bytes())
}

/// Notes that `vault_id` is encrypted. A failure is logged, not returned: the
/// vault is encrypted either way, and the next time it is seen the mark is
/// tried again.
pub fn mark(app: &tauri::AppHandle, vault_id: &str) {
    let marked = app.path().app_data_dir().map_err(|e| e.to_string()).and_then(|dir| mark_in(&dir, vault_id));
    if let Err(e) = marked {
        eprintln!("[marks] could not mark {vault_id}: {e}");
    }
}

/// What the list says about `vault_id`, read from the disk now.
pub fn mark_of(app: &tauri::AppHandle, vault_id: &str) -> Mark {
    match app.path().app_data_dir() {
        Ok(dir) => mark_of_in(&dir, vault_id),
        // Nowhere to read from: fail closed, like an unreadable list.
        Err(e) => {
            eprintln!("[marks] no app data directory: {e}");
            Mark::Unknown
        }
    }
}

/// Marks the vault in `dir` if it has `vault.key`, and answers what the list
/// says about it from then on.
pub fn mark_if_encrypted(app: &tauri::AppHandle, vault_id: &str, dir: &Path) -> Mark {
    if keys::is_encrypted_dir(dir) {
        mark(app, vault_id);
        return Mark::Yes;
    }
    mark_of(app, vault_id)
}

/// Refuses a vault without `vault.key` that was known as encrypted — or that
/// cannot be told apart from one, while the list is unreadable. A vault with
/// `vault.key`, or one never marked, passes. An encrypted database under it is
/// a lost key file ([`keys::VAULT_KEY_MISSING`]); a plain one, or none at all,
/// is a vault that may have been swapped ([`keys::VAULT_TAMPERED`]). Nothing is
/// changed either way.
pub fn refuse_if_swapped(mark: Mark, dir: &Path) -> Result<(), String> {
    if mark == Mark::No || keys::is_encrypted_dir(dir) {
        return Ok(());
    }
    if !keys::plain_database_or_none(dir) {
        return Err(keys::VAULT_KEY_MISSING.to_string());
    }
    Err(match mark {
        Mark::Unknown => keys::VAULT_MARKS_UNREADABLE,
        _ => keys::VAULT_TAMPERED,
    }
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("emerald-marks-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_list_marks_nothing() {
        let dir = scratch();
        assert_eq!(mark_of_in(&dir, "a"), Mark::No);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_mark_is_on_the_disk_at_once() {
        let dir = scratch();
        mark_in(&dir, "a").unwrap();
        mark_in(&dir, "a").unwrap();
        assert_eq!(mark_of_in(&dir, "a"), Mark::Yes);
        assert_eq!(mark_of_in(&dir, "b"), Mark::No);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_mark_keeps_what_another_instance_added_meanwhile() {
        let dir = scratch();
        mark_in(&dir, "a").unwrap();
        // Another app instance on the same data directory writes its own mark.
        std::fs::write(dir.join(MARKS_FILE), r#"{"version":1,"vaults":["a","other"]}"#).unwrap();
        mark_in(&dir, "b").unwrap();
        for id in ["a", "b", "other"] {
            assert_eq!(mark_of_in(&dir, id), Mark::Yes, "{id}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unreadable_list_is_unknown_and_left_alone_until_it_reads_again() {
        let dir = scratch();
        for bad in ["not json", r#"{"version":2,"vaults":[]}"#, r#"{"vaults":["a"]}"#] {
            std::fs::write(dir.join(MARKS_FILE), bad).unwrap();
            assert_eq!(mark_of_in(&dir, "anything"), Mark::Unknown, "{bad}");
            mark_in(&dir, "a").unwrap();
            assert_eq!(std::fs::read_to_string(dir.join(MARKS_FILE)).unwrap(), bad);
        }
        // Repaired: read again, not remembered as broken.
        std::fs::write(dir.join(MARKS_FILE), r#"{"version":1,"vaults":["a"]}"#).unwrap();
        assert_eq!(mark_of_in(&dir, "a"), Mark::Yes);
        assert_eq!(mark_of_in(&dir, "b"), Mark::No);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_folder_in_place_of_the_list_is_unknown() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join(MARKS_FILE)).unwrap();
        assert_eq!(mark_of_in(&dir, "a"), Mark::Unknown);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_plain_vault_opens_unless_it_was_known_encrypted() {
        let vault = scratch();
        std::fs::write(vault.join(vault::DB_FILE), b"SQLite format 3\0and pages").unwrap();
        assert_eq!(refuse_if_swapped(Mark::No, &vault), Ok(()));
        // The swap: `vault.key` gone, a plain database of someone else's in its place.
        assert_eq!(refuse_if_swapped(Mark::Yes, &vault).unwrap_err(), keys::VAULT_TAMPERED);
        assert_eq!(refuse_if_swapped(Mark::Unknown, &vault).unwrap_err(), keys::VAULT_MARKS_UNREADABLE);
        // Database gone too: no "create a new vault" either.
        std::fs::remove_file(vault.join(vault::DB_FILE)).unwrap();
        assert_eq!(refuse_if_swapped(Mark::Yes, &vault).unwrap_err(), keys::VAULT_TAMPERED);
        // Only the key file lost: that is what it says.
        std::fs::write(vault.join(vault::DB_FILE), crate::crypto::random_bytes::<32>()).unwrap();
        assert_eq!(refuse_if_swapped(Mark::Yes, &vault).unwrap_err(), keys::VAULT_KEY_MISSING);
        // With `vault.key` in place nothing is refused.
        std::fs::write(vault.join(keys::KEY_FILE), b"{}").unwrap();
        assert_eq!(refuse_if_swapped(Mark::Yes, &vault), Ok(()));
        std::fs::remove_dir_all(&vault).ok();
    }
}
