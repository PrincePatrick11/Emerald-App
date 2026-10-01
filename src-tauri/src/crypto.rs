//! Authenticated encryption for everything a vault keeps outside its database.
//!
//! One format for every sealed blob — images, drafts, backups, and the wrapped
//! vault key in `vault.key`:
//!
//! ```text
//! "EMRC" | version (1 byte) | nonce (24 bytes) | XChaCha20-Poly1305 ciphertext + tag
//! ```
//!
//! The 24-byte nonce is random per seal; at that size collisions are not a
//! concern even for millions of files under one key. Every seal also binds the
//! header and a [`Context`] as associated data: a blob sealed as one thing (say,
//! the drafts) cannot be passed off as another (an image), and an image sealed
//! under one name cannot be swapped in under another — it simply fails to open.
//!
//! The vault key itself is never used directly by a cipher. [`subkey`] derives
//! one key per purpose — SQLCipher, sealed files, image names — so no key ever
//! serves two algorithms.

use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{AeadCore, XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

/// A 256-bit key that is wiped from memory when dropped.
pub type Key = Zeroizing<[u8; 32]>;

const MAGIC: &[u8; 4] = b"EMRC";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = MAGIC.len() + 1 + NONCE_LEN;

/// What a sealed blob is. Authenticated, never stored.
#[derive(Clone, Copy)]
pub enum Context<'a> {
    VaultKey,
    /// A stored image, by its filename.
    Image(&'a str),
    Drafts,
    Backup,
}

impl Context<'_> {
    /// Header, label and — for an image — its name, as associated data.
    fn associated_data(self) -> Vec<u8> {
        let (label, id): (&[u8], &[u8]) = match self {
            Context::VaultKey => (b"emerald/vault-key", b""),
            Context::Image(name) => (b"emerald/image", name.as_bytes()),
            Context::Drafts => (b"emerald/drafts", b""),
            Context::Backup => (b"emerald/backup", b""),
        };
        [MAGIC.as_slice(), &[VERSION], label, &[0], id].concat()
    }
}

/// Why a blob did not open. `Corrupt` covers a wrong key, a damaged file and
/// a blob of another context alike — the tag cannot tell them apart.
#[derive(Debug, PartialEq, Eq)]
pub enum OpenError {
    NotSealed,
    UnsupportedVersion(u8),
    Corrupt,
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::NotSealed => f.write_str("not an encrypted Emerald file"),
            OpenError::UnsupportedVersion(v) => write!(f, "unsupported encryption version {v}"),
            OpenError::Corrupt => f.write_str("wrong key or damaged file"),
        }
    }
}

/// What a key derived from the vault key is for.
#[derive(Clone, Copy)]
pub enum Purpose {
    /// SQLCipher's raw key for the vault's databases.
    Database,
    /// [`seal`] / [`open`] for the vault's files.
    Files,
    /// The keyed hash that names stored images.
    ImageNames,
}

/// HMAC-SHA256(vault key, label): one independent key per [`Purpose`].
pub fn subkey(vault_key: &Key, purpose: Purpose) -> Key {
    let label: &[u8] = match purpose {
        Purpose::Database => b"emerald/subkey/database",
        Purpose::Files => b"emerald/subkey/files",
        Purpose::ImageNames => b"emerald/subkey/image-names",
    };
    Zeroizing::new(keyed_hash(vault_key, label))
}

/// HMAC-SHA256 of `data` under `key`.
pub fn keyed_hash(key: &Key, data: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key.as_ref()).expect("any key length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

pub fn random_key() -> Key {
    Zeroizing::new(XChaCha20Poly1305::generate_key(&mut OsRng).into())
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    use chacha20poly1305::aead::rand_core::RngCore;
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

/// Whether `data` starts like a sealed blob. Says nothing about whether it opens.
pub fn is_sealed(data: &[u8]) -> bool {
    data.len() >= HEADER_LEN && data.starts_with(MAGIC)
}

pub fn seal(key: &Key, context: Context, plaintext: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad: &context.associated_data() })
        // Only fails for plaintexts beyond what fits in memory anyway.
        .expect("XChaCha20-Poly1305 encryption");
    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    out
}

pub fn open(key: &Key, context: Context, data: &[u8]) -> Result<Zeroizing<Vec<u8>>, OpenError> {
    if !is_sealed(data) {
        return Err(OpenError::NotSealed);
    }
    let version = data[MAGIC.len()];
    if version != VERSION {
        return Err(OpenError::UnsupportedVersion(version));
    }
    let nonce = XNonce::from_slice(&data[MAGIC.len() + 1..HEADER_LEN]);
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    cipher
        .decrypt(nonce, Payload { msg: &data[HEADER_LEN..], aad: &context.associated_data() })
        .map(Zeroizing::new)
        .map_err(|_| OpenError::Corrupt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subkeys_differ_by_purpose_and_vault() {
        let key = random_key();
        let db = subkey(&key, Purpose::Database);
        assert_ne!(*db, *subkey(&key, Purpose::Files));
        assert_ne!(*db, *subkey(&key, Purpose::ImageNames));
        assert_ne!(*db, *key);
        assert_eq!(*db, *subkey(&key, Purpose::Database));
        assert_ne!(*db, *subkey(&random_key(), Purpose::Database));
    }

    #[test]
    fn round_trip() {
        let key = random_key();
        let sealed = seal(&key, Context::Image("a.png"), b"pixels");
        assert!(is_sealed(&sealed));
        assert_eq!(open(&key, Context::Image("a.png"), &sealed).unwrap().as_slice(), b"pixels");
        // Unter anderem Namen eingeschoben: öffnet nicht.
        assert_eq!(open(&key, Context::Image("b.png"), &sealed), Err(OpenError::Corrupt));
    }

    #[test]
    fn same_plaintext_seals_differently() {
        let key = random_key();
        assert_ne!(seal(&key, Context::Drafts, b"x"), seal(&key, Context::Drafts, b"x"));
    }

    #[test]
    fn wrong_key_fails() {
        let sealed = seal(&random_key(), Context::Drafts, b"secret");
        assert_eq!(open(&random_key(), Context::Drafts, &sealed), Err(OpenError::Corrupt));
    }

    #[test]
    fn wrong_context_fails() {
        let key = random_key();
        let sealed = seal(&key, Context::Drafts, b"secret");
        assert_eq!(open(&key, Context::Image("a.png"), &sealed), Err(OpenError::Corrupt));
    }

    #[test]
    fn tampering_fails() {
        let key = random_key();
        let mut sealed = seal(&key, Context::Backup, b"secret");
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert_eq!(open(&key, Context::Backup, &sealed), Err(OpenError::Corrupt));
    }

    #[test]
    fn plaintext_is_not_sealed() {
        let key = random_key();
        assert_eq!(open(&key, Context::Drafts, b"\x89PNG\r\n\x1a\n...").unwrap_err(), OpenError::NotSealed);
        assert!(!is_sealed(b"EMRC"));
    }

    #[test]
    fn unknown_version_is_named() {
        let key = random_key();
        let mut sealed = seal(&key, Context::Drafts, b"x");
        sealed[4] = 9;
        assert_eq!(open(&key, Context::Drafts, &sealed), Err(OpenError::UnsupportedVersion(9)));
    }
}
