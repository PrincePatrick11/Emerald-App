//! `.emerald` files: one or more entries and templates for another vault.
//!
//! A file is a ZIP archive (stored, not compressed — images are compressed
//! already) with exactly these members:
//!
//! ```text
//! manifest.json        the entries and templates (built and read by the frontend)
//! images/{name}        pictures the content names, in the clear
//! icons/{name}         icons the content names, in the clear
//! ```
//!
//! With a password, the whole archive is sealed:
//!
//! ```text
//! "EMRE" | version (1) | Argon2id memory KiB, iterations, parallelism (3 × u32 LE)
//!        | salt (16) | nonce (24) | XChaCha20-Poly1305(archive), header as associated data
//! ```
//!
//! Reading takes a file from anywhere, so it is bounded ([`Limits`]): the file
//! size, the number of members (counted from the end record before the archive
//! is parsed), every member's real size (read through `take`, whatever its
//! header claims) and their sum. Member names are matched against the three
//! shapes above — no directory, no `..`, no absolute path ever reaches the
//! filesystem; images and icons are stored through `images.rs` under names of
//! this vault, the way a picture inserted by hand is.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::crypto;
use crate::images::{self, Store};
use crate::keys::{self, KdfParams};

const MAGIC: &[u8; 4] = b"EMRE";
const VERSION: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
/// Where the parts of the sealed header start — the layout of the module doc.
const KDF_AT: usize = MAGIC.len() + 1;
const KDF_LEN: usize = 3 * 4;
const SALT_AT: usize = KDF_AT + KDF_LEN;
const NONCE_AT: usize = SALT_AT + SALT_LEN;
const HEADER_LEN: usize = NONCE_AT + NONCE_LEN;
const ZIP_MAGIC: &[u8; 4] = b"PK\x03\x04";

const MANIFEST: &str = "manifest.json";
const IMAGES_DIR: &str = "images/";
const ICONS_DIR: &str = "icons/";

/// Error codes the frontend tells apart (`lib/emeraldFormat.ts`).
pub const EMERALD_LOCKED: &str = "EMERALD_LOCKED";
pub const EMERALD_OLD_FORMAT: &str = "EMERALD_OLD_FORMAT";
pub const EMERALD_TOO_LARGE: &str = "EMERALD_TOO_LARGE";
pub const EMERALD_UNREADABLE: &str = "EMERALD_UNREADABLE";
/// Sealed by a newer app, in a way this one cannot open.
pub const EMERALD_NEWER: &str = "EMERALD_NEWER";

/// How much a file may make the app read.
#[derive(Clone, Copy)]
struct Limits {
    file: u64,
    members: usize,
    manifest: u64,
    member: u64,
    total: u64,
}

/// Archives are stored, not compressed: a genuine one unpacks to about its own
/// size, so the total is the file limit. One image as large as an image file
/// may be when dropped in (`images.rs`, `MAX_EXTERNAL_IMAGE_BYTES`).
const LIMITS: Limits = Limits {
    file: 512 * 1024 * 1024,
    members: 5000,
    manifest: 32 * 1024 * 1024,
    member: 64 * 1024 * 1024,
    total: 512 * 1024 * 1024,
};

/// What an archive holds, in the clear.
#[derive(Default, Debug, PartialEq)]
struct Archive {
    manifest: Vec<u8>,
    images: Vec<(String, Vec<u8>)>,
    icons: Vec<(String, Vec<u8>)>,
}

// ── archive ──────────────────────────────────────────────────────────────────

fn build_zip(archive: &Archive, limits: Limits) -> Result<Vec<u8>, String> {
    let mut total = archive.manifest.len() as u64;
    for (_, bytes) in archive.images.iter().chain(&archive.icons) {
        if bytes.len() as u64 > limits.member {
            return Err(EMERALD_TOO_LARGE.into());
        }
        total += bytes.len() as u64;
    }
    if total > limits.total
        || archive.manifest.len() as u64 > limits.manifest
        || 1 + archive.images.len() + archive.icons.len() > limits.members
    {
        return Err(EMERALD_TOO_LARGE.into());
    }

    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut put = |name: String, bytes: &[u8]| -> Result<(), String> {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(bytes).map_err(|e| e.to_string())
    };
    put(MANIFEST.to_string(), &archive.manifest)?;
    for (name, bytes) in &archive.images {
        put(format!("{IMAGES_DIR}{name}"), bytes)?;
    }
    for (name, bytes) in &archive.icons {
        put(format!("{ICONS_DIR}{name}"), bytes)?;
    }
    zip.finish().map(Cursor::into_inner).map_err(|e| e.to_string())
}

/// The member count from the end-of-central-directory record, before the ZIP
/// reader allocates one record per member. A ZIP64 count (`0xFFFF`) is not one
/// this app writes: it would take more members than the limit allows.
fn member_count(bytes: &[u8]) -> Option<usize> {
    const EOCD: &[u8; 4] = b"PK\x05\x06";
    const EOCD_LEN: usize = 22;
    let search_from = bytes.len().saturating_sub(EOCD_LEN + u16::MAX as usize);
    let at = (search_from..=bytes.len().checked_sub(EOCD_LEN)?)
        .rev()
        .find(|&i| &bytes[i..i + 4] == EOCD)?;
    // A ZIP64 locator right before the end record would make the reader take
    // its own, much larger count; this app never writes one within its limits.
    if at >= 20 && &bytes[at - 20..at - 16] == b"PK\x06\x07" {
        return None;
    }
    let count = u16::from_le_bytes([bytes[at + 10], bytes[at + 11]]);
    (count != u16::MAX).then_some(count as usize)
}

/// The most items a manifest may list — the frontend's `MANIFEST_LIMITS.items`.
const MAX_ITEMS: usize = 1000;
const FORMAT_VERSION: u64 = 6;

/// Checks what the manifest says about itself before any picture is stored:
/// a refused file leaves the vault as it is. The frontend checks the rest.
fn check_manifest(manifest: &[u8]) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_slice(manifest).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    if value.get("format").and_then(|f| f.as_str()) != Some("emerald") {
        return Err(EMERALD_UNREADABLE.into());
    }
    match value.get("version").and_then(|v| v.as_u64()) {
        Some(FORMAT_VERSION) => {}
        Some(v) if v > FORMAT_VERSION => return Err(EMERALD_NEWER.into()),
        Some(_) => return Err(EMERALD_OLD_FORMAT.into()),
        None => return Err(EMERALD_UNREADABLE.into()),
    }
    match value.get("items").and_then(|i| i.as_array()) {
        Some(items) if items.len() > MAX_ITEMS => Err(EMERALD_TOO_LARGE.into()),
        Some(items) if !items.is_empty() => Ok(()),
        _ => Err(EMERALD_UNREADABLE.into()),
    }
}

/// Where a member belongs, by its name — `None` for anything else.
enum Member {
    Manifest,
    Image(String),
    Icon(String),
}

fn member_kind(name: &str) -> Option<Member> {
    if name == MANIFEST {
        return Some(Member::Manifest);
    }
    // `is_valid_image_name` admits 64 hex digits and an extension only — no
    // separator, no `..`, nothing absolute.
    if let Some(file) = name.strip_prefix(IMAGES_DIR) {
        return images::is_valid_image_name(file).then(|| Member::Image(file.to_string()));
    }
    if let Some(file) = name.strip_prefix(ICONS_DIR) {
        return images::is_valid_image_name(file).then(|| Member::Icon(file.to_string()));
    }
    None
}

fn parse_zip(bytes: &[u8], limits: Limits) -> Result<Archive, String> {
    let count = member_count(bytes).ok_or(EMERALD_UNREADABLE)?;
    if count > limits.members {
        return Err(EMERALD_TOO_LARGE.into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    if zip.len() > limits.members {
        return Err(EMERALD_TOO_LARGE.into());
    }

    let mut archive = Archive::default();
    let mut has_manifest = false;
    let mut total: u64 = 0;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|_| EMERALD_UNREADABLE.to_string())?;
        let kind = member_kind(file.name()).ok_or(EMERALD_UNREADABLE)?;
        let cap = if matches!(kind, Member::Manifest) { limits.manifest } else { limits.member };
        // The real size, not the header's: read one byte past the cap.
        let mut data = Vec::new();
        (&mut file).take(cap + 1).read_to_end(&mut data).map_err(|_| EMERALD_UNREADABLE.to_string())?;
        total += data.len() as u64;
        if data.len() as u64 > cap || total > limits.total {
            return Err(EMERALD_TOO_LARGE.into());
        }
        match kind {
            Member::Manifest if has_manifest => return Err(EMERALD_UNREADABLE.into()),
            Member::Manifest => {
                has_manifest = true;
                archive.manifest = data;
            }
            Member::Image(name) => archive.images.push((name, data)),
            Member::Icon(name) => archive.icons.push((name, data)),
        }
    }
    if !has_manifest {
        return Err(EMERALD_UNREADABLE.into());
    }
    Ok(archive)
}

// ── password ─────────────────────────────────────────────────────────────────

fn header(kdf: KdfParams, salt: &[u8; SALT_LEN], nonce: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN);
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    for value in [kdf.memory_kib, kdf.iterations, kdf.parallelism] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out
}

fn seal(plain: &[u8], password: &str, kdf: KdfParams) -> Result<Vec<u8>, String> {
    let salt = crypto::random_bytes::<SALT_LEN>();
    let nonce = crypto::random_bytes::<NONCE_LEN>();
    let key = keys::derive_key(password, &salt, kdf)?;
    let head = header(kdf, &salt, &nonce);
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let sealed = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad: &head })
        .map_err(|_| "encryption failed".to_string())?;
    Ok([head, sealed].concat())
}

fn open(bytes: &[u8], password: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    if bytes.len() > MAGIC.len() && bytes[MAGIC.len()] > VERSION {
        return Err(EMERALD_NEWER.into());
    }
    if bytes.len() < HEADER_LEN || bytes[MAGIC.len()] != VERSION {
        return Err(EMERALD_UNREADABLE.into());
    }
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    let kdf = KdfParams { memory_kib: word(KDF_AT), iterations: word(KDF_AT + 4), parallelism: word(KDF_AT + 8) };
    let salt = &bytes[SALT_AT..NONCE_AT];
    let nonce = &bytes[NONCE_AT..HEADER_LEN];
    // Parameters out of range are a damaged (or hostile) file, not a wrong password.
    let key = keys::derive_key(password, salt, kdf).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: &bytes[HEADER_LEN..], aad: &bytes[..HEADER_LEN] })
        .map(Zeroizing::new)
        .map_err(|_| keys::WRONG_PASSWORD.to_string())
}

fn encode(archive: &Archive, password: Option<&str>, kdf: KdfParams, limits: Limits) -> Result<Vec<u8>, String> {
    let zip = build_zip(archive, limits)?;
    let bytes = match password {
        Some(password) => {
            keys::check_password(password)?;
            seal(&zip, password, kdf)?
        }
        None => zip,
    };
    // The members fit, but headers come on top: never write what the import refuses.
    if bytes.len() as u64 > limits.file {
        return Err(EMERALD_TOO_LARGE.into());
    }
    Ok(bytes)
}

/// The archive in a file's bytes. An old `.emerald` (JSON, before the archive)
/// is named as such; an encrypted one without a password is [`EMERALD_LOCKED`].
fn decode(bytes: &[u8], password: Option<&str>, limits: Limits) -> Result<Archive, String> {
    if bytes.len() as u64 > limits.file {
        return Err(EMERALD_TOO_LARGE.into());
    }
    if bytes.starts_with(MAGIC) {
        let password = password.ok_or(EMERALD_LOCKED)?;
        return parse_zip(&open(bytes, password)?, limits);
    }
    if bytes.starts_with(ZIP_MAGIC) {
        return parse_zip(bytes, limits);
    }
    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if text.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{') {
        return Err(EMERALD_OLD_FORMAT.into());
    }
    Err(EMERALD_UNREADABLE.into())
}

// ── commands ─────────────────────────────────────────────────────────────────

fn path_ok(path: &str) -> Result<(), String> {
    if crate::ext_for_path(path) != "emerald" {
        return Err("unsupported file type".to_string());
    }
    Ok(())
}

/// A picture for the archive: from the vault by `name`, or — compressed by
/// the frontend — as `data_url`, stored under `name`'s hash with the
/// extension of its own type.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    name: String,
    data_url: Option<String>,
}

/// Writes a `.emerald` file: the frontend's `manifest`, the named images and
/// icons of the vault, and — with a `password` — sealed as a whole. A picture
/// the vault no longer has is left out; the import treats its name as unknown.
#[tauri::command]
pub async fn write_emerald_file(
    app: tauri::AppHandle,
    vault_id: String,
    path: String,
    manifest: String,
    images: Vec<ExportImage>,
    icons: Vec<String>,
    password: Option<Zeroizing<String>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        path_ok(&path)?;
        let mut archive = Archive { manifest: manifest.into_bytes(), ..Archive::default() };
        for image in images {
            if !images::is_valid_image_name(&image.name) {
                return Err("invalid image name".to_string());
            }
            match image.data_url {
                Some(data_url) => {
                    let (ext, bytes) = images::decode_data_url(&data_url)?;
                    archive.images.push((format!("{}.{ext}", stem(&image.name)), bytes));
                }
                None => {
                    if let Ok(bytes) = images::load(&app, &vault_id, Store::Images, &image.name) {
                        archive.images.push((image.name, bytes));
                    }
                }
            }
        }
        for name in icons {
            if !images::is_valid_image_name(&name) {
                return Err("invalid icon name".to_string());
            }
            if let Ok(bytes) = images::load(&app, &vault_id, Store::Icons, &name) {
                archive.icons.push((name, bytes));
            }
        }
        let bytes = encode(&archive, password.as_deref().map(String::as_str), keys::DEFAULT_KDF, LIMITS)?;
        let target = crate::guarded_write_target(&app, &path)?;
        std::fs::write(target, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What an import gets back: the manifest's text, and per picture of the file
/// the name this vault stored it under — keyed by the hash part of the name in
/// the file (64 hex digits), since a compressed picture travels with another
/// extension than the content names.
#[derive(serde::Serialize)]
pub struct ImportedArchive {
    manifest: String,
    images: HashMap<String, String>,
    icons: HashMap<String, String>,
}

fn stem(name: &str) -> String {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string()
}

/// Reads a `.emerald` file and stores its pictures in the vault. See
/// [`decode`] for the errors.
#[tauri::command]
pub async fn read_emerald_file(
    app: tauri::AppHandle,
    vault_id: String,
    path: String,
    password: Option<Zeroizing<String>>,
) -> Result<ImportedArchive, String> {
    tauri::async_runtime::spawn_blocking(move || {
        path_ok(&path)?;
        let file = crate::guarded_read_path(&app, &path)?;
        let size = std::fs::metadata(&file).map_err(|e| e.to_string())?.len();
        if size > LIMITS.file {
            return Err(EMERALD_TOO_LARGE.to_string());
        }
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        let archive = decode(&bytes, password.as_deref().map(String::as_str), LIMITS)?;
        check_manifest(&archive.manifest)?;
        let manifest = String::from_utf8(archive.manifest).map_err(|_| EMERALD_UNREADABLE.to_string())?;

        let mut stored_images = HashMap::new();
        for (name, data) in archive.images {
            let ext = crate::ext_for_path(&name);
            stored_images.insert(stem(&name), images::store(&app, &vault_id, Store::Images, &data, &ext)?);
        }
        let mut stored_icons = HashMap::new();
        for (name, data) in archive.icons {
            let ext = crate::ext_for_path(&name);
            // As `save_icon`: no SVG icons — and none larger than an icon is.
            if ext == "svg" || data.len() > images::MAX_ICON_BYTES {
                continue;
            }
            stored_icons.insert(stem(&name), images::store(&app, &vault_id, Store::Icons, &data, &ext)?);
        }
        Ok(ImportedArchive { manifest, images: stored_images, icons: stored_icons })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    const IMG: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png";
    const ICON: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210.webp";

    fn sample() -> Archive {
        Archive {
            manifest: br#"{"format":"emerald","version":6,"secret":"GEHEIM-EMERALD"}"#.to_vec(),
            images: vec![(IMG.into(), b"png bytes".to_vec())],
            icons: vec![(ICON.into(), b"webp bytes".to_vec())],
        }
    }

    /// A ZIP with the given members, written without any of our checks.
    fn raw_zip(members: &[(&str, &[u8])]) -> Vec<u8> {
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in members {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn a_plain_archive_round_trips() {
        let bytes = encode(&sample(), None, TEST_KDF, LIMITS).unwrap();
        assert!(bytes.starts_with(ZIP_MAGIC));
        assert_eq!(decode(&bytes, None, LIMITS).unwrap(), sample());
        // A password given for a plain file does no harm.
        assert_eq!(decode(&bytes, Some("whatever"), LIMITS).unwrap(), sample());
    }

    #[test]
    fn an_encrypted_archive_opens_only_with_its_password() {
        let bytes = encode(&sample(), Some("correct horse"), TEST_KDF, LIMITS).unwrap();
        assert!(bytes.starts_with(MAGIC));
        assert!(!bytes.windows(14).any(|w| w == b"GEHEIM-EMERALD"));
        assert_eq!(decode(&bytes, None, LIMITS).unwrap_err(), EMERALD_LOCKED);
        assert_eq!(decode(&bytes, Some("wrong horse!"), LIMITS).unwrap_err(), keys::WRONG_PASSWORD);
        assert_eq!(decode(&bytes, Some("correct horse"), LIMITS).unwrap(), sample());
    }

    #[test]
    fn a_short_password_is_refused_on_export() {
        assert_eq!(encode(&sample(), Some("short"), TEST_KDF, LIMITS).unwrap_err(), keys::PASSWORD_TOO_SHORT);
    }

    #[test]
    fn damaged_encrypted_files_are_refused() {
        let mut bytes = encode(&sample(), Some("correct horse"), TEST_KDF, LIMITS).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert_eq!(decode(&bytes, Some("correct horse"), LIMITS).unwrap_err(), keys::WRONG_PASSWORD);
        // A header someone changed — the parameters are authenticated.
        let mut bytes = encode(&sample(), Some("correct horse"), TEST_KDF, LIMITS).unwrap();
        bytes[20] ^= 1;
        assert!(decode(&bytes, Some("correct horse"), LIMITS).is_err());
        assert_eq!(decode(b"EMRE\x01", Some("correct horse"), LIMITS).unwrap_err(), EMERALD_UNREADABLE);
        // Sealed by a newer app: named as such, not as damage.
        let mut newer = encode(&sample(), Some("correct horse"), TEST_KDF, LIMITS).unwrap();
        newer[MAGIC.len()] = VERSION + 1;
        assert_eq!(decode(&newer, Some("correct horse"), LIMITS).unwrap_err(), EMERALD_NEWER);
        // Argon2 parameters meant to stall the app.
        let mut hostile = encode(&sample(), Some("correct horse"), TEST_KDF, LIMITS).unwrap();
        hostile[5..9].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(decode(&hostile, Some("correct horse"), LIMITS).unwrap_err(), EMERALD_UNREADABLE);
    }

    #[test]
    fn old_json_files_are_named() {
        assert_eq!(decode(br#"{"version":"5","type":"entry"}"#, None, LIMITS).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(decode(b"\xEF\xBB\xBF\n  {\"version\":\"3\"}", None, LIMITS).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(decode(b"hello", None, LIMITS).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(decode(b"", None, LIMITS).unwrap_err(), EMERALD_UNREADABLE);
    }

    #[test]
    fn too_large_files_are_refused() {
        let small = Limits { file: 64, ..LIMITS };
        let bytes = encode(&sample(), None, TEST_KDF, LIMITS).unwrap();
        assert_eq!(decode(&bytes, None, small).unwrap_err(), EMERALD_TOO_LARGE);
        // One member above its own cap.
        let big = vec![0u8; 2048];
        let bytes = raw_zip(&[(MANIFEST, b"{}"), (&format!("images/{IMG}"), &big)]);
        assert_eq!(decode(&bytes, None, Limits { member: 1024, ..LIMITS }).unwrap_err(), EMERALD_TOO_LARGE);
        // The manifest above its own.
        let bytes = raw_zip(&[(MANIFEST, &big)]);
        assert_eq!(decode(&bytes, None, Limits { manifest: 1024, ..LIMITS }).unwrap_err(), EMERALD_TOO_LARGE);
        // And the export does not write what the import would refuse.
        let mut archive = sample();
        archive.images.push((IMG.into(), big));
        assert_eq!(encode(&archive, None, TEST_KDF, Limits { member: 1024, ..LIMITS }).unwrap_err(), EMERALD_TOO_LARGE);
        // Nor a file whose members fit but whose headers make it larger than a file may be.
        let payload = (sample().manifest.len() + 9 + 10) as u64;
        let tight = Limits { file: payload + 10, total: payload, ..LIMITS };
        assert_eq!(encode(&sample(), None, TEST_KDF, tight).unwrap_err(), EMERALD_TOO_LARGE);
    }

    #[test]
    fn a_zip_bomb_is_refused() {
        // Many members whose sum unpacks beyond the total, each one below its cap.
        let chunk = vec![7u8; 1000];
        let names: Vec<String> = (0..20).map(|i| format!("images/{i:064x}.png")).collect();
        let mut members: Vec<(&str, &[u8])> = vec![(MANIFEST, b"{}")];
        members.extend(names.iter().map(|n| (n.as_str(), chunk.as_slice())));
        let bytes = raw_zip(&members);
        let limits = Limits { total: 10_000, member: 2000, ..LIMITS };
        assert_eq!(decode(&bytes, None, limits).unwrap_err(), EMERALD_TOO_LARGE);

        // A member whose header claims a small size reads only up to its cap.
        let mut lying = raw_zip(&[(MANIFEST, b"{}"), (&format!("images/{IMG}"), &chunk)]);
        let header_at = lying.windows(4).rposition(|w| w == b"PK\x01\x02").unwrap();
        lying[header_at + 24..header_at + 28].copy_from_slice(&10u32.to_le_bytes());
        assert!(decode(&lying, None, Limits { member: 100, ..LIMITS }).is_err());
    }

    #[test]
    fn too_many_members_are_refused() {
        let names: Vec<String> = (0..12).map(|i| format!("images/{i:064x}.png")).collect();
        let mut members: Vec<(&str, &[u8])> = vec![(MANIFEST, b"{}")];
        members.extend(names.iter().map(|n| (n.as_str(), b"x".as_slice())));
        let bytes = raw_zip(&members);
        assert_eq!(decode(&bytes, None, Limits { members: 10, ..LIMITS }).unwrap_err(), EMERALD_TOO_LARGE);
        assert!(decode(&bytes, None, LIMITS).is_ok());
    }

    #[test]
    fn foreign_member_names_are_refused() {
        for name in [
            "../evil.png",
            "images/../../evil.png",
            &format!("images/../{IMG}"),
            &format!("/images/{IMG}"),
            &format!("C:\\images\\{IMG}"),
            &format!("images\\{IMG}"),
            "images/",
            "images/evil.exe",
            "readme.txt",
            &format!("images/sub/{IMG}"),
        ] {
            let bytes = raw_zip(&[(MANIFEST, b"{}"), (name, b"x")]);
            assert_eq!(decode(&bytes, None, LIMITS).unwrap_err(), EMERALD_UNREADABLE, "{name}");
        }
    }

    #[test]
    fn a_zip64_count_is_refused_before_parsing() {
        let mut bytes = raw_zip(&[(MANIFEST, b"{}")]);
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        // A ZIP64 locator in front of the end record, as a crafted file would carry.
        let mut locator = b"PK\x06\x07".to_vec();
        locator.extend_from_slice(&[0u8; 16]);
        bytes.splice(eocd..eocd, locator);
        assert_eq!(decode(&bytes, None, LIMITS).unwrap_err(), EMERALD_UNREADABLE);
    }

    #[test]
    fn the_manifest_is_checked_before_pictures_are_stored() {
        let ok = br#"{"format":"emerald","version":6,"items":[{"kind":"entry"}]}"#;
        assert!(check_manifest(ok).is_ok());
        assert_eq!(check_manifest(br#"{"format":"emerald","version":7,"items":[{}]}"#).unwrap_err(), EMERALD_NEWER);
        assert_eq!(check_manifest(br#"{"format":"emerald","version":5,"items":[{}]}"#).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(check_manifest(br#"{"format":"other","version":6,"items":[{}]}"#).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(check_manifest(br#"{"format":"emerald","version":6,"items":[]}"#).unwrap_err(), EMERALD_UNREADABLE);
        let many = format!(r#"{{"format":"emerald","version":6,"items":[{}]}}"#, vec!["{}"; MAX_ITEMS + 1].join(","));
        assert_eq!(check_manifest(many.as_bytes()).unwrap_err(), EMERALD_TOO_LARGE);
        assert_eq!(check_manifest(b"not json").unwrap_err(), EMERALD_UNREADABLE);
    }

    #[test]
    fn an_archive_without_or_with_two_manifests_is_refused() {
        let bytes = raw_zip(&[(&format!("images/{IMG}"), b"x")]);
        assert_eq!(decode(&bytes, None, LIMITS).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(decode(b"PK\x03\x04garbage", None, LIMITS).unwrap_err(), EMERALD_UNREADABLE);
    }
}
