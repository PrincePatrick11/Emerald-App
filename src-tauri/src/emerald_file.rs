//! `.emerald` files — the one format for exchange and for the database export.
//!
//! Every file starts with a header in the clear that says what it is and how
//! it is protected, followed by the body:
//!
//! ```text
//! "EMRE" | version (1) | header length (u32 LE) | header JSON | body
//!
//! header JSON  { "kind": "items" | "vault",
//!                "protection": { "type": "none" }
//!                            | { "type": "password", "kdf": {…}, "salt", "nonce" }
//!                            | { "type": "vaultKey", "keyFile": {…}, "salt", "nonce" } }
//! ```
//!
//! - `items`: entries and templates for another vault (`.emerald`).
//! - `vault`: a vault's content, what the import can replace or merge
//!   (`.vault.emerald`). Step 2 adds the raw backup as a third kind.
//!
//! The body is a ZIP archive with exactly these members:
//!
//! ```text
//! manifest.json        built and read by the frontend, deflated
//! images/{name}        pictures, stored (they are compressed already)
//! icons/{name}         icons, stored
//! ```
//!
//! With `none` the archive follows as it is. Otherwise it is sealed in chunks
//! (`emerald_seal.rs`) under a key from an own password (Argon2id, parameters
//! and salt in the header) or from the vault key: the header then carries the
//! vault's `vault.key` as it was at export time, so the file opens with the
//! password or recovery key the vault had then — and without asking while
//! that vault is unlocked.
//!
//! Writing streams: the archive goes member by member into a temporary file
//! beside the target, every picture loaded from the vault only when it is
//! written, and the file is renamed into place at the end. Reading streams the
//! same way: only the chunk being read is decrypted, the clear archive never
//! touches the disk, and the pictures are stored one by one — in a step of
//! their own (`store_emerald_files`), once the import really starts.
//!
//! Reading takes a file from anywhere, so it is bounded ([`Limits`], by kind):
//! the file size, the number of members (from the end records, before the
//! archive is parsed), every member's real size (read through `take`, whatever
//! its header claims or the deflate stream would unpack to) and their sum.
//! Member names are matched against the three shapes above — no directory, no
//! `..`, no absolute path ever reaches the filesystem; pictures are stored
//! through `images.rs` under names of this vault, as one inserted by hand is.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zeroize::Zeroizing;

use crate::crypto::{self, Key, Purpose};
use crate::emerald_seal::{OpenFailure, OpenReader, SealWriter, Window, NONCE_PREFIX_LEN};
use crate::images::{self, Store};
use crate::keys::{self, KdfParams, KeyFile};

const MAGIC: &[u8; 4] = b"EMRE";
/// 1 was the password-only envelope of format 6, read no more.
const VERSION: u8 = 2;
const PREFIX_LEN: usize = MAGIC.len() + 1 + 4;
/// A key file is well under a kilobyte; a header near this is none of ours.
const MAX_HEADER_LEN: usize = 64 * 1024;
const SALT_LEN: usize = 16;
const ZIP_MAGIC: &[u8; 4] = b"PK\x03\x04";

const MANIFEST: &str = "manifest.json";
const IMAGES_DIR: &str = "images/";
const ICONS_DIR: &str = "icons/";

/// The manifest's own version — the frontend's `EMERALD_FORMAT_VERSION`.
const FORMAT_VERSION: u64 = 7;
/// The most items a manifest may list — the frontend's `MANIFEST_LIMITS.items`.
const MAX_ITEMS: usize = 1000;

/// Error codes the frontend tells apart (`lib/emerald/file.ts`).
pub const EMERALD_LOCKED: &str = "EMERALD_LOCKED";
/// Sealed with a vault key no open vault has: password or recovery key of that vault.
pub const EMERALD_VAULT_LOCKED: &str = "EMERALD_VAULT_LOCKED";
pub const EMERALD_OLD_FORMAT: &str = "EMERALD_OLD_FORMAT";
pub const EMERALD_TOO_LARGE: &str = "EMERALD_TOO_LARGE";
pub const EMERALD_UNREADABLE: &str = "EMERALD_UNREADABLE";
/// Written by a newer app, in a way this one cannot read.
pub const EMERALD_NEWER: &str = "EMERALD_NEWER";

/// What a file holds — said in its header.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Items,
    Vault,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Items => "items",
            Kind::Vault => "vault",
        }
    }
}

/// How much a file may make the app read.
#[derive(Clone, Copy, Debug)]
struct Limits {
    file: u64,
    members: u64,
    manifest: u64,
    member: u64,
    total: u64,
}

const GIB: u64 = 1024 * 1024 * 1024;
const MIB: u64 = 1024 * 1024;

/// For entries: one picture as large as an image file may be when dropped in
/// (`images.rs`, `MAX_EXTERNAL_IMAGE_BYTES`). A vault's export holds all its
/// pictures and its whole content as one manifest — and whatever picture the
/// vault holds, also one stored before any size limit: a backup that cannot
/// be written for one large picture would be no backup.
fn limits_for(kind: Kind) -> Limits {
    match kind {
        Kind::Items => Limits { file: 2 * GIB, members: 5000, manifest: 32 * MIB, member: 64 * MIB, total: 2 * GIB },
        Kind::Vault => Limits { file: 64 * GIB, members: 500_000, manifest: 512 * MIB, member: GIB, total: 64 * GIB },
    }
}

/// How much a deflated manifest may unpack to per byte in the file. JSON of
/// real content deflates far less; a manifest beyond this is made to swell.
const MANIFEST_RATIO: u64 = 100;

/// The key a protected file is sealed with, and its nonce prefix.
type FileKey = (Key, [u8; NONCE_PREFIX_LEN]);

// ── header ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Protection {
    None,
    Password { kdf: KdfParams, salt: String, nonce: String },
    VaultKey { key_file: serde_json::Value, salt: String, nonce: String },
}

#[derive(Serialize, Deserialize)]
struct Header {
    kind: Kind,
    protection: Protection,
}

/// The header as it stands in the file, and its parts.
struct ReadHeader {
    /// Prefix and JSON — what every chunk binds.
    bytes: Vec<u8>,
    header: Header,
}

fn header_bytes(header: &Header) -> Vec<u8> {
    let json = serde_json::to_vec(header).expect("serialisable");
    let mut out = Vec::with_capacity(PREFIX_LEN + json.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out
}

/// The header of a file. Files of format 6 and before (a plain ZIP, the JSON
/// files before that, the envelope version 1) are named as old.
fn read_header(file: &mut impl Read) -> Result<ReadHeader, String> {
    let mut prefix = [0u8; PREFIX_LEN];
    let mut got = 0;
    while got < PREFIX_LEN {
        match file.read(&mut prefix[got..]).map_err(|e| e.to_string())? {
            0 => break,
            n => got += n,
        }
    }
    let start = &prefix[..got];
    if !start.starts_with(MAGIC) {
        let text = start.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(start);
        let json = text.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{');
        return Err(if start.starts_with(ZIP_MAGIC) || json { EMERALD_OLD_FORMAT } else { EMERALD_UNREADABLE }.into());
    }
    if got < PREFIX_LEN {
        return Err(EMERALD_UNREADABLE.into());
    }
    match prefix[MAGIC.len()] {
        VERSION => {}
        v if v > VERSION => return Err(EMERALD_NEWER.into()),
        _ => return Err(EMERALD_OLD_FORMAT.into()),
    }
    let len = u32::from_le_bytes(prefix[MAGIC.len() + 1..].try_into().expect("4 bytes")) as usize;
    if len > MAX_HEADER_LEN {
        return Err(EMERALD_UNREADABLE.into());
    }
    let mut json = vec![0u8; len];
    file.read_exact(&mut json).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    // A kind or protection this build does not know comes from a newer app.
    let value: serde_json::Value = serde_json::from_slice(&json).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    let header: Header = serde_json::from_value(value).map_err(|_| EMERALD_NEWER.to_string())?;
    Ok(ReadHeader { bytes: [prefix.as_slice(), &json].concat(), header })
}

fn decode_fixed<const N: usize>(b64: &str) -> Result<[u8; N], String> {
    B64.decode(b64)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| EMERALD_UNREADABLE.to_string())
}

/// The file's key under the vault key: one per file, from its salt.
fn file_key_from_vault_key(vault_key: &Key, salt: &[u8]) -> Key {
    let files = crypto::subkey(vault_key, Purpose::Files);
    Zeroizing::new(crypto::keyed_hash(&files, &[b"emerald/emerald-file/".as_slice(), salt].concat()))
}

/// How a file may be opened.
pub(crate) struct Secrets<'a> {
    /// Keys of the vaults that are unlocked right now.
    pub unlocked: Vec<Key>,
    pub password: Option<&'a str>,
    pub recovery_key: Option<&'a str>,
}

/// The key of a protected file and its nonce prefix — `None` for a plain one.
fn unlock(header: &Header, secrets: &Secrets) -> Result<Option<FileKey>, String> {
    match &header.protection {
        Protection::None => Ok(None),
        Protection::Password { kdf, salt, nonce } => {
            let salt: [u8; SALT_LEN] = decode_fixed(salt)?;
            let nonce = decode_fixed(nonce)?;
            let password = secrets.password.ok_or(EMERALD_LOCKED)?;
            // Parameters out of range are a damaged (or hostile) file, not a wrong password.
            let key = keys::derive_key(password, &salt, *kdf).map_err(|_| EMERALD_UNREADABLE.to_string())?;
            Ok(Some((key, nonce)))
        }
        Protection::VaultKey { key_file, salt, nonce } => {
            let salt: [u8; SALT_LEN] = decode_fixed(salt)?;
            let nonce = decode_fixed(nonce)?;
            let key_file = KeyFile::from_json(&key_file.to_string()).map_err(|_| EMERALD_UNREADABLE.to_string())?;
            let vault_key = match secrets.unlocked.iter().find(|key| key_file.accepts(key)) {
                Some(key) => key.clone(),
                None => match (secrets.password, secrets.recovery_key) {
                    (Some(password), _) => key_file.unlock_with_password(password)?,
                    (None, Some(recovery)) => key_file.unlock_with_recovery_key(recovery)?,
                    (None, None) => return Err(EMERALD_VAULT_LOCKED.into()),
                },
            };
            Ok(Some((file_key_from_vault_key(&vault_key, &salt), nonce)))
        }
    }
}

// ── archive ──────────────────────────────────────────────────────────────────

/// Something the ZIP reader can read and seek — a plain or a sealed body.
trait Body: Read + Seek {}
impl<T: Read + Seek> Body for T {}

/// The body of an opened file, ready for the ZIP reader.
fn body(file: File, head: &ReadHeader, key: Option<&FileKey>) -> Result<Box<dyn Body>, String> {
    let start = head.bytes.len() as u64;
    let file = BufReader::new(file);
    match key {
        None => Ok(Box::new(Window::new(file, start).map_err(|e| e.to_string())?)),
        Some((key, nonce)) => match OpenReader::new(file, start, key, *nonce, head.bytes.clone()) {
            Ok(reader) => Ok(Box::new(reader)),
            Err(OpenFailure::Malformed) => Err(EMERALD_UNREADABLE.into()),
            // With a vault key, the key file has just confirmed the key: then it is damage.
            Err(OpenFailure::FirstChunk) => Err(match head.header.protection {
                Protection::Password { .. } => keys::WRONG_PASSWORD,
                _ => EMERALD_UNREADABLE,
            }
            .into()),
        },
    }
}

/// The member count from the end records, before the ZIP reader allocates one
/// record per member — through the ZIP64 record when there is one.
///
/// Only the layout this app writes is taken: the end record last in the body,
/// without a comment, its central directory right in front of it (or of the
/// ZIP64 record). The ZIP reader walks back to an earlier end record when the
/// last one does not add up; a file that has one that does not add up is
/// refused here, so the reader can never count by another record than this.
fn member_count(body: &mut dyn Body) -> Option<u64> {
    const EOCD_LEN: u64 = 22;
    const LOCATOR_LEN: u64 = 20;
    const RECORD_LEN: u64 = 56;
    let len = body.seek(SeekFrom::End(0)).ok()?;
    let eocd_at = len.checked_sub(EOCD_LEN)?;
    let eocd = read_at::<22>(body, eocd_at)?;
    // Signature, and no comment: ours ends exactly here.
    if &eocd[..4] != b"PK\x05\x06" || eocd[20..22] != [0, 0] {
        return None;
    }
    let word = |b: &[u8], at: usize| u32::from_le_bytes(b[at..at + 4].try_into().expect("4 bytes")) as u64;
    let long = |b: &[u8], at: usize| u64::from_le_bytes(b[at..at + 8].try_into().expect("8 bytes"));
    let central_directory_at = |body: &mut dyn Body, at: u64, count: u64| {
        count == 0 || read_at::<4>(body, at).is_some_and(|sig| &sig == b"PK\x01\x02")
    };
    let locator_at = eocd_at.checked_sub(LOCATOR_LEN);
    let locator = locator_at.and_then(|at| read_at::<20>(body, at)).filter(|l| &l[..4] == b"PK\x06\x07");
    match (locator, locator_at) {
        (Some(locator), Some(locator_at)) => {
            let record_at = long(&locator, 8);
            if record_at.checked_add(RECORD_LEN)? != locator_at {
                return None;
            }
            let record = read_at::<56>(body, record_at)?;
            let (count, size, offset) = (long(&record, 32), long(&record, 40), long(&record, 48));
            (&record[..4] == b"PK\x06\x06" && offset.checked_add(size)? == record_at && central_directory_at(body, offset, count))
                .then_some(count)
        }
        _ => {
            let count = u16::from_le_bytes([eocd[10], eocd[11]]) as u64;
            let (size, offset) = (word(&eocd, 12), word(&eocd, 16));
            (offset.checked_add(size)? == eocd_at && central_directory_at(body, offset, count)).then_some(count)
        }
    }
}

/// `N` bytes at `at`, or `None` where the body has none.
fn read_at<const N: usize>(body: &mut dyn Body, at: u64) -> Option<[u8; N]> {
    body.seek(SeekFrom::Start(at)).ok()?;
    let mut bytes = [0u8; N];
    body.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

/// Where a member belongs, by its name — `None` for anything else.
#[derive(Debug, PartialEq)]
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

type Zip = zip::ZipArchive<Box<dyn Body>>;

/// The archive in a body, its members checked by name and count.
fn open_zip(mut body: Box<dyn Body>, limits: Limits) -> Result<Zip, String> {
    let count = member_count(body.as_mut()).ok_or(EMERALD_UNREADABLE)?;
    if count > limits.members {
        return Err(EMERALD_TOO_LARGE.into());
    }
    body.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let zip = zip::ZipArchive::new(body).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    if zip.len() as u64 > limits.members {
        return Err(EMERALD_TOO_LARGE.into());
    }
    let mut manifests = 0;
    for index in 0..zip.len() {
        let name = zip.name_for_index(index).ok_or(EMERALD_UNREADABLE)?;
        match member_kind(name).ok_or(EMERALD_UNREADABLE)? {
            Member::Manifest => manifests += 1,
            Member::Image(_) | Member::Icon(_) => {}
        }
    }
    if manifests != 1 {
        return Err(EMERALD_UNREADABLE.into());
    }
    Ok(zip)
}

/// A member's bytes, at most `cap` of them — its real size, not its header's.
fn read_member(zip: &mut Zip, index: usize, cap: u64) -> Result<Vec<u8>, String> {
    let mut file = zip.by_index(index).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    let mut data = Vec::new();
    (&mut file).take(cap + 1).read_to_end(&mut data).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    if data.len() as u64 > cap {
        return Err(EMERALD_TOO_LARGE.into());
    }
    Ok(data)
}

/// The manifest's bytes — bounded by the kind's limit and by how far its
/// deflated form can honestly unpack ([`MANIFEST_RATIO`]).
fn read_manifest(zip: &mut Zip, limits: Limits) -> Result<Vec<u8>, String> {
    let index = zip.index_for_name(MANIFEST).ok_or(EMERALD_UNREADABLE)?;
    let packed = zip.by_index_raw(index).map_err(|_| EMERALD_UNREADABLE.to_string())?.compressed_size();
    let cap = limits.manifest.min(packed.saturating_mul(MANIFEST_RATIO).saturating_add(MIB));
    read_member(zip, index, cap)
}

/// A JSON object whose content is skipped, not kept.
struct AnyObject;

impl<'de> Deserialize<'de> for AnyObject {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visit;
        impl<'de> serde::de::Visitor<'de> for Visit {
            type Value = AnyObject;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<AnyObject, A::Error> {
                while map.next_entry::<serde::de::IgnoredAny, serde::de::IgnoredAny>()?.is_some() {}
                Ok(AnyObject)
            }
        }
        deserializer.deserialize_map(Visit)
    }
}

/// What the manifest says about itself; the rest is skipped while reading, so
/// a large manifest is checked without building a JSON tree of the rest.
#[derive(Deserialize)]
struct Frame {
    format: Option<String>,
    version: Option<u64>,
    kind: Option<String>,
    items: Option<Vec<serde::de::IgnoredAny>>,
    data: Option<AnyObject>,
}

/// Checks what the manifest says about itself before any picture is stored:
/// a refused file leaves the vault as it is. The frontend checks the rest.
fn check_manifest(manifest: &[u8], kind: Kind) -> Result<(), String> {
    let frame: Frame = serde_json::from_slice(manifest).map_err(|_| EMERALD_UNREADABLE.to_string())?;
    if frame.format.as_deref() != Some("emerald") {
        return Err(EMERALD_UNREADABLE.into());
    }
    match frame.version {
        Some(FORMAT_VERSION) => {}
        Some(v) if v > FORMAT_VERSION => return Err(EMERALD_NEWER.into()),
        Some(_) => return Err(EMERALD_OLD_FORMAT.into()),
        None => return Err(EMERALD_UNREADABLE.into()),
    }
    // The header and the manifest name the same kind — the import goes by it.
    if frame.kind.as_deref() != Some(kind.as_str()) {
        return Err(EMERALD_UNREADABLE.into());
    }
    match kind {
        Kind::Items => match frame.items {
            Some(items) if items.len() > MAX_ITEMS => Err(EMERALD_TOO_LARGE.into()),
            Some(items) if !items.is_empty() => Ok(()),
            _ => Err(EMERALD_UNREADABLE.into()),
        },
        Kind::Vault => match frame.data {
            Some(AnyObject) => Ok(()),
            None => Err(EMERALD_UNREADABLE.into()),
        },
    }
}

// ── writing ──────────────────────────────────────────────────────────────────

/// How the export protects the file.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExportProtection {
    None,
    Password { password: Zeroizing<String> },
    /// The key of the vault exported from.
    VaultKey,
}

/// The protection for the header, and the key the body is sealed with.
struct Sealing {
    protection: Protection,
    key: Option<FileKey>,
}

fn sealing_with_password(password: &str, kdf: KdfParams) -> Result<Sealing, String> {
    keys::check_password(password)?;
    let salt: [u8; SALT_LEN] = crypto::random_bytes();
    let nonce: [u8; NONCE_PREFIX_LEN] = crypto::random_bytes();
    let key = keys::derive_key(password, &salt, kdf)?;
    Ok(Sealing {
        protection: Protection::Password { kdf, salt: B64.encode(salt), nonce: B64.encode(nonce) },
        key: Some((key, nonce)),
    })
}

fn sealing_with_vault_key(key_file: &KeyFile, vault_key: &Key) -> Sealing {
    let salt: [u8; SALT_LEN] = crypto::random_bytes();
    let nonce: [u8; NONCE_PREFIX_LEN] = crypto::random_bytes();
    let key_file = serde_json::from_str(&key_file.to_json()).expect("a key file is JSON");
    Sealing {
        protection: Protection::VaultKey { key_file, salt: B64.encode(salt), nonce: B64.encode(nonce) },
        key: Some((file_key_from_vault_key(vault_key, &salt), nonce)),
    }
}

/// Where the archive goes: straight into the file, or sealed on the way.
enum Sink<W: Write> {
    Plain(W),
    Sealed(SealWriter<W>),
}

impl<W: Write> Write for Sink<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Sink::Plain(w) => w.write(buf),
            Sink::Sealed(w) => w.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Sink::Plain(w) => w.flush(),
            Sink::Sealed(w) => w.flush(),
        }
    }
}

impl<W: Write> Sink<W> {
    fn finish(self) -> std::io::Result<W> {
        match self {
            Sink::Plain(mut w) => w.flush().map(|_| w),
            Sink::Sealed(w) => w.finish(),
        }
    }
}

/// A picture for the archive, produced when its turn comes.
type Source<'a> = Box<dyn FnMut() -> Option<Vec<u8>> + 'a>;

/// What goes into a file: the manifest, then each picture under its name in
/// the archive, loaded only when it is written. A `None` from a source leaves
/// the picture out (the vault no longer has it).
struct Contents<'a> {
    kind: Kind,
    manifest: Vec<u8>,
    images: Vec<(String, Source<'a>)>,
    icons: Vec<(String, Source<'a>)>,
}

/// Writes the file into `out`. Bounded like the reading side: the export never
/// writes what the import would refuse.
fn write_file<W: Write>(out: W, contents: Contents, sealing: Sealing, limits: Limits) -> Result<W, String> {
    if contents.manifest.len() as u64 > limits.manifest
        || 1 + (contents.images.len() + contents.icons.len()) as u64 > limits.members
    {
        return Err(EMERALD_TOO_LARGE.into());
    }
    let head = header_bytes(&Header { kind: contents.kind, protection: sealing.protection });
    let mut out = out;
    out.write_all(&head).map_err(|e| e.to_string())?;
    let sink = match sealing.key {
        None => Sink::Plain(out),
        Some((key, nonce)) => Sink::Sealed(SealWriter::new(out, &key, nonce, head)),
    };
    let mut zip = zip::ZipWriter::new_stream(sink);
    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(contents.manifest.len() as u64 >= u32::MAX as u64);
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file(MANIFEST, deflated).map_err(|e| e.to_string())?;
    zip.write_all(&contents.manifest).map_err(|e| e.to_string())?;
    drop(contents.manifest);
    let mut total = 0u64;
    for (dir, list) in [(IMAGES_DIR, contents.images), (ICONS_DIR, contents.icons)] {
        for (name, mut source) in list {
            let Some(bytes) = source() else { continue };
            total += bytes.len() as u64;
            if bytes.len() as u64 > limits.member || total > limits.total {
                return Err(EMERALD_TOO_LARGE.into());
            }
            zip.start_file(format!("{dir}{name}"), stored).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    let sink = zip.finish().map_err(|e| e.to_string())?.into_inner();
    sink.finish().map_err(|e| e.to_string())
}

fn path_ok(path: &str) -> Result<(), String> {
    if crate::ext_for_path(path) != "emerald" {
        return Err("unsupported file type".to_string());
    }
    Ok(())
}

fn stem(name: &str) -> String {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string()
}

/// A picture for the archive: from the vault by `name`, or — compressed by
/// the frontend — as `data_url`, stored under `name`'s hash with the
/// extension of its own type.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    name: String,
    data_url: Option<String>,
}

/// `{target}.part` beside the target: the file comes into place only whole.
fn part_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    target.with_file_name(name)
}

/// Writes a file through `{target}.part`, renamed over the target once it is
/// whole and on the disk — the way `vault::write_atomic_with` writes a vault's
/// own files. Whatever lies under the part's name (a crash remnant, a planted
/// link) goes first, and `create_new` refuses one that shows up again in
/// between. A volume that refuses the flush (a network share) is no reason
/// to fail; anything else is, and leaves no part behind.
fn place_file(target: &Path, max_size: u64, write: impl FnOnce(BufWriter<File>) -> Result<BufWriter<File>, String>) -> Result<(), String> {
    let part = part_path(target);
    std::fs::remove_file(&part).ok();
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)
        .map_err(|e| e.to_string())
        .and_then(|file| write(BufWriter::new(file)))
        .and_then(|out| out.into_inner().map_err(|e| e.to_string()))
        .and_then(|file| match file.sync_all() {
            Err(e) if !crate::vault::sync_refusal_is_harmless(&e) => Err(e.to_string()),
            _ => Ok(()),
        })
        .and_then(|_| {
            let size = std::fs::metadata(&part).map_err(|e| e.to_string())?.len();
            if size > max_size {
                return Err(EMERALD_TOO_LARGE.to_string());
            }
            // Replaces an existing file on all three platforms; patiently, since
            // a virus scanner or indexer may hold the fresh part for a moment.
            crate::vault::patiently(|| std::fs::rename(&part, target)).map_err(|e| e.to_string())
        });
    if written.is_err() {
        std::fs::remove_file(&part).ok();
        return written;
    }
    // On Unix the new name is only settled once the folder is on the disk too.
    #[cfg(unix)]
    if let Some(dir) = target.parent().and_then(|dir| File::open(dir).ok()) {
        dir.sync_all().ok();
    }
    Ok(())
}

/// The sealing the export asked for. With the vault key: the key of the vault
/// exported from, which must be unlocked, and its `vault.key` for the header.
fn sealing_for(app: &tauri::AppHandle, vault_id: &str, protection: ExportProtection) -> Result<Sealing, String> {
    match protection {
        ExportProtection::None => Ok(Sealing { protection: Protection::None, key: None }),
        ExportProtection::Password { password } => sealing_with_password(&password, keys::DEFAULT_KDF),
        ExportProtection::VaultKey => {
            let dir = crate::vault::vault_dir(app, vault_id)?;
            let vault_key = keys::key_for(app, vault_id)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
            let key_file = keys::read_key_file(&dir)?.ok_or_else(|| keys::VAULT_NOT_ENCRYPTED.to_string())?;
            if !key_file.accepts(&vault_key) {
                return Err(keys::VAULT_LOCKED.to_string());
            }
            Ok(sealing_with_vault_key(&key_file, &vault_key))
        }
    }
}

/// The pictures and icons for the archive, each loaded from the vault only
/// when its turn comes — or, compressed by the frontend, from its data URL.
fn sources(
    app: &tauri::AppHandle,
    vault_id: &str,
    images: Vec<ExportImage>,
    icons: Vec<String>,
) -> Result<(Vec<(String, Source<'static>)>, Vec<(String, Source<'static>)>), String> {
    let from_vault = |store: Store, name: String| -> Source<'static> {
        let (app, vault_id) = (app.clone(), vault_id.to_string());
        Box::new(move || images::load(&app, &vault_id, store, &name).ok())
    };
    let mut image_sources = Vec::with_capacity(images.len());
    for image in images {
        if !images::is_valid_image_name(&image.name) {
            return Err("invalid image name".to_string());
        }
        match image.data_url {
            Some(data_url) => {
                let (ext, bytes) = images::decode_data_url(&data_url)?;
                let mut bytes = Some(bytes);
                image_sources.push((format!("{}.{ext}", stem(&image.name)), Box::new(move || bytes.take()) as Source));
            }
            None => image_sources.push((image.name.clone(), from_vault(Store::Images, image.name))),
        }
    }
    let mut icon_sources = Vec::with_capacity(icons.len());
    for name in icons {
        if !images::is_valid_image_name(&name) {
            return Err("invalid icon name".to_string());
        }
        icon_sources.push((name.clone(), from_vault(Store::Icons, name)));
    }
    Ok((image_sources, icon_sources))
}

/// Writes a `.emerald` file: the frontend's `manifest`, the named images and
/// icons of the vault, protected as `protection` says. A picture the vault no
/// longer has is left out; the import treats its name as unknown.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn write_emerald_file(
    app: tauri::AppHandle,
    vault_id: String,
    path: String,
    kind: Kind,
    manifest: String,
    images: Vec<ExportImage>,
    icons: Vec<String>,
    protection: ExportProtection,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        path_ok(&path)?;
        let sealing = sealing_for(&app, &vault_id, protection)?;
        let (images, icons) = sources(&app, &vault_id, images, icons)?;
        let contents = Contents { kind, manifest: manifest.into_bytes(), images, icons };
        let limits = limits_for(kind);
        let target = crate::guarded_write_target(&app, &path)?;
        place_file(&target, limits.file, |out| write_file(out, contents, sealing, limits))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── reading ──────────────────────────────────────────────────────────────────

/// A file that was opened and whose pictures may still be stored.
struct Ticket {
    path: PathBuf,
    key: Option<FileKey>,
    kind: Kind,
    serial: u64,
}

/// The opened files, by ticket. Only a handful: an import that never finished
/// (a closed settings page) gives its place to the next one.
#[derive(Default)]
pub struct EmeraldTickets(Mutex<(u64, HashMap<String, Ticket>)>);

const MAX_TICKETS: usize = 4;

impl EmeraldTickets {
    fn insert(&self, ticket: Ticket) -> String {
        let id = B64.encode(crypto::random_bytes::<12>()).replace(['+', '/'], "_");
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let (serial, tickets) = &mut *guard;
        *serial += 1;
        while tickets.len() >= MAX_TICKETS {
            let oldest = tickets.iter().min_by_key(|(_, t)| t.serial).map(|(id, _)| id.clone()).expect("not empty");
            tickets.remove(&oldest);
        }
        tickets.insert(id.clone(), Ticket { serial: *serial, ..ticket });
        id
    }

    fn get<T>(&self, id: &str, f: impl FnOnce(&Ticket) -> T) -> Option<T> {
        let guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        guard.1.get(id).map(f)
    }

    fn remove(&self, id: &str) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).1.remove(id);
    }
}

/// Opens a file: header, key, archive. The size is checked against the limits
/// of the kind the header names before anything else is read.
fn open_file(path: &Path, secrets: &Secrets) -> Result<(Kind, Option<FileKey>, Zip), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let head = read_header(&mut file)?;
    let limits = limits_for(head.header.kind);
    if size > limits.file {
        return Err(EMERALD_TOO_LARGE.into());
    }
    let key = unlock(&head.header, secrets)?;
    let zip = open_zip(body(file, &head, key.as_ref())?, limits)?;
    Ok((head.header.kind, key, zip))
}

/// The same file again, with the key found at opening.
fn reopen(path: &Path, key: Option<&FileKey>) -> Result<(Kind, Zip), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let head = read_header(&mut file)?;
    let limits = limits_for(head.header.kind);
    let zip = open_zip(body(file, &head, key)?, limits)?;
    Ok((head.header.kind, zip))
}

#[derive(Serialize)]
pub struct OpenedFile {
    ticket: String,
    kind: Kind,
    manifest: String,
}

/// Opens a `.emerald` file and returns its kind and manifest; its pictures stay
/// in the file until `store_emerald_files`. Errors: [`EMERALD_LOCKED`] /
/// [`EMERALD_VAULT_LOCKED`] while a secret is missing, `WRONG_PASSWORD` /
/// `WRONG_RECOVERY_KEY`, and the format codes above.
#[tauri::command]
pub async fn read_emerald_file(
    app: tauri::AppHandle,
    path: String,
    password: Option<Zeroizing<String>>,
    recovery_key: Option<Zeroizing<String>>,
) -> Result<OpenedFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        path_ok(&path)?;
        let file = crate::guarded_read_path(&app, &path)?;
        let secrets = Secrets {
            unlocked: app.state::<keys::VaultKeys>().all(),
            password: password.as_deref().map(String::as_str),
            recovery_key: recovery_key.as_deref().map(String::as_str),
        };
        let (kind, key, mut zip) = open_file(&file, &secrets)?;
        let manifest = read_manifest(&mut zip, limits_for(kind))?;
        check_manifest(&manifest, kind)?;
        let manifest = String::from_utf8(manifest).map_err(|_| EMERALD_UNREADABLE.to_string())?;
        let ticket = app.state::<EmeraldTickets>().insert(Ticket { path: file, key, kind, serial: 0 });
        Ok(OpenedFile { ticket, kind, manifest })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the import gets back: per picture of the file the name this vault
/// stored it under, keyed by its name in the file.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct StoredFiles {
    images: HashMap<String, String>,
    icons: HashMap<String, String>,
}

/// Every picture and icon of the archive, one by one, through `store`.
fn store_members(
    zip: &mut Zip,
    limits: Limits,
    mut store: impl FnMut(Store, &[u8], &str) -> Result<String, String>,
) -> Result<StoredFiles, String> {
    let mut out = StoredFiles::default();
    let mut total = 0u64;
    for index in 0..zip.len() {
        let name = zip.name_for_index(index).ok_or(EMERALD_UNREADABLE)?.to_string();
        let (kind, file) = match member_kind(&name).ok_or(EMERALD_UNREADABLE)? {
            Member::Manifest => continue,
            Member::Image(file) => (Store::Images, file),
            Member::Icon(file) => (Store::Icons, file),
        };
        let data = read_member(zip, index, limits.member)?;
        total += data.len() as u64;
        if total > limits.total {
            return Err(EMERALD_TOO_LARGE.into());
        }
        let ext = crate::ext_for_path(&file);
        match kind {
            Store::Images => {
                out.images.insert(file, store(Store::Images, &data, &ext)?);
            }
            Store::Icons => {
                // As `save_icon`: no SVG icons — and none larger than an icon is.
                if ext == "svg" || data.len() > images::MAX_ICON_BYTES {
                    continue;
                }
                out.icons.insert(file, store(Store::Icons, &data, &ext)?);
            }
        }
    }
    Ok(out)
}

/// Stores the pictures and icons of an opened file in the vault.
#[tauri::command]
pub async fn store_emerald_files(app: tauri::AppHandle, ticket: String, vault_id: String) -> Result<StoredFiles, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, key, expected) = app
            .state::<EmeraldTickets>()
            .get(&ticket, |t| (t.path.clone(), t.key.clone(), t.kind))
            .ok_or("the file is no longer open")?;
        let (kind, mut zip) = reopen(&path, key.as_ref())?;
        if kind != expected {
            return Err(EMERALD_UNREADABLE.into());
        }
        store_members(&mut zip, limits_for(kind), |store, data, ext| images::store(&app, &vault_id, store, data, ext))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forgets an opened file. Closing one that is not open does nothing.
#[tauri::command]
pub fn close_emerald_file(app: tauri::AppHandle, ticket: String) {
    app.state::<EmeraldTickets>().remove(&ticket);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TEST_KDF: KdfParams = KdfParams { memory_kib: 64, iterations: 1, parallelism: 1 };
    const IMG: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png";
    const ICON: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210.webp";

    fn manifest(kind: Kind) -> Vec<u8> {
        match kind {
            Kind::Items => br#"{"format":"emerald","version":7,"kind":"items","items":[{"secret":"GEHEIM-EMERALD"}]}"#.to_vec(),
            Kind::Vault => br#"{"format":"emerald","version":7,"kind":"vault","data":{"secret":"GEHEIM-EMERALD"}}"#.to_vec(),
        }
    }

    fn contents(kind: Kind, image: Vec<u8>) -> Contents<'static> {
        let mut image = Some(image);
        let mut icon = Some(b"webp bytes".to_vec());
        Contents {
            kind,
            manifest: manifest(kind),
            images: vec![(IMG.into(), Box::new(move || image.take()))],
            icons: vec![(ICON.into(), Box::new(move || icon.take()))],
        }
    }

    fn plain() -> Sealing {
        Sealing { protection: Protection::None, key: None }
    }

    fn none() -> Secrets<'static> {
        Secrets { unlocked: Vec::new(), password: None, recovery_key: None }
    }

    /// Writes into memory, as a file on disk would hold it.
    fn write(contents: Contents, sealing: Sealing) -> Vec<u8> {
        write_file(Vec::new(), contents, sealing, limits_for(Kind::Vault)).unwrap()
    }

    /// Reads it back the way the commands do: header, key, archive, manifest, members.
    fn read(bytes: &[u8], secrets: &Secrets) -> Result<(Kind, Vec<u8>, Vec<(String, Vec<u8>)>), String> {
        let path = scratch_file(bytes);
        let result = (|| {
            let (kind, _key, mut zip) = open_file(&path, secrets)?;
            let limits = limits_for(kind);
            let manifest = read_manifest(&mut zip, limits)?;
            check_manifest(&manifest, kind)?;
            let mut stored = Vec::new();
            store_members(&mut zip, limits, |store, data, ext| {
                let name = format!("{}-{ext}", if matches!(store, Store::Icons) { "icon" } else { "image" });
                stored.push((name.clone(), data.to_vec()));
                Ok(name)
            })?;
            Ok((kind, manifest, stored))
        })();
        let _ = std::fs::remove_file(path);
        result
    }

    fn scratch_file(bytes: &[u8]) -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("emerald-file-test-{}-{n}.emerald", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn expected_members() -> Vec<(String, Vec<u8>)> {
        vec![("image-png".into(), b"png bytes".to_vec()), ("icon-webp".into(), b"webp bytes".to_vec())]
    }

    #[test]
    fn a_plain_file_round_trips_and_says_its_kind() {
        for kind in [Kind::Items, Kind::Vault] {
            let bytes = write(contents(kind, b"png bytes".to_vec()), plain());
            assert!(bytes.starts_with(MAGIC));
            let (read_kind, manifest_back, members) = read(&bytes, &none()).unwrap();
            assert_eq!(read_kind, kind);
            assert_eq!(manifest_back, manifest(kind));
            assert_eq!(members, expected_members());
            // The header names the kind in the clear.
            assert!(bytes.windows(kind.as_str().len()).any(|w| w == kind.as_str().as_bytes()));
        }
    }

    #[test]
    fn the_manifest_is_deflated() {
        let big = format!(
            r#"{{"format":"emerald","version":7,"kind":"items","items":[{}]}}"#,
            vec![r#"{"text":"the same words again and again"}"#; 500].join(",")
        );
        let contents = Contents { kind: Kind::Items, manifest: big.clone().into_bytes(), images: vec![], icons: vec![] };
        let bytes = write(contents, plain());
        assert!(bytes.len() < big.len() / 5, "{} of {}", bytes.len(), big.len());
        assert_eq!(read(&bytes, &none()).unwrap().1, big.into_bytes());
    }

    #[test]
    fn an_own_password_opens_it_and_nothing_else() {
        let bytes = write(contents(Kind::Items, b"png bytes".to_vec()), sealing_with_password("correct horse", TEST_KDF).unwrap());
        assert!(!bytes.windows(14).any(|w| w == b"GEHEIM-EMERALD"));
        assert_eq!(read(&bytes, &none()).unwrap_err(), EMERALD_LOCKED);
        let wrong = Secrets { password: Some("wrong horse!"), ..none() };
        assert_eq!(read(&bytes, &wrong).unwrap_err(), keys::WRONG_PASSWORD);
        let right = Secrets { password: Some("correct horse"), ..none() };
        let (kind, _, members) = read(&bytes, &right).unwrap();
        assert_eq!(kind, Kind::Items);
        assert_eq!(members, expected_members());
    }

    #[test]
    fn a_short_password_is_refused_on_export() {
        assert_eq!(sealing_with_password("short", TEST_KDF).err(), Some(keys::PASSWORD_TOO_SHORT.to_string()));
    }

    #[test]
    fn the_vault_key_opens_it_unlocked_by_password_or_recovery_key() {
        let (key_file, vault_key, recovery) = KeyFile::create("vault password", TEST_KDF).unwrap();
        let bytes = write(contents(Kind::Vault, b"png bytes".to_vec()), sealing_with_vault_key(&key_file, &vault_key));
        assert!(!bytes.windows(14).any(|w| w == b"GEHEIM-EMERALD"));

        assert_eq!(read(&bytes, &none()).unwrap_err(), EMERALD_VAULT_LOCKED);
        let other_vault = Secrets { unlocked: vec![crypto::random_key()], ..none() };
        assert_eq!(read(&bytes, &other_vault).unwrap_err(), EMERALD_VAULT_LOCKED);

        let open_vault = Secrets { unlocked: vec![crypto::random_key(), vault_key.clone()], ..none() };
        assert_eq!(read(&bytes, &open_vault).unwrap().2, expected_members());
        let by_password = Secrets { password: Some("vault password"), ..none() };
        assert_eq!(read(&bytes, &by_password).unwrap().0, Kind::Vault);
        let by_recovery = Secrets { recovery_key: Some(&recovery), ..none() };
        assert_eq!(read(&bytes, &by_recovery).unwrap().0, Kind::Vault);

        let wrong = Secrets { password: Some("wrong password"), ..none() };
        assert_eq!(read(&bytes, &wrong).unwrap_err(), keys::WRONG_PASSWORD);
        let wrong_recovery = Secrets { recovery_key: Some("AAAA-BBBB"), ..none() };
        assert_eq!(read(&bytes, &wrong_recovery).unwrap_err(), keys::WRONG_RECOVERY_KEY);
    }

    #[test]
    fn a_large_file_streams_through_many_chunks() {
        // Several megabytes of pictures, sealed: written and read chunk by chunk.
        let picture: Vec<u8> = (0..5 * 1024 * 1024).map(|i: usize| (i % 253) as u8).collect();
        let bytes = write(contents(Kind::Vault, picture.clone()), sealing_with_password("correct horse", TEST_KDF).unwrap());
        let right = Secrets { password: Some("correct horse"), ..none() };
        let (_, _, members) = read(&bytes, &right).unwrap();
        assert_eq!(members[0].1, picture);
    }

    #[test]
    fn damaged_files_are_refused() {
        let sealed = || write(contents(Kind::Items, vec![9u8; 200_000]), sealing_with_password("correct horse", TEST_KDF).unwrap());
        let right = Secrets { password: Some("correct horse"), ..none() };
        // A byte changed far in, a file cut short, the header changed.
        let mut bytes = sealed();
        let at = bytes.len() - 100;
        bytes[at] ^= 1;
        assert!(read(&bytes, &right).is_err());
        let bytes = sealed();
        assert!(read(&bytes[..bytes.len() - 70_000], &right).is_err());
        let mut bytes = sealed();
        let kind_at = bytes.windows(7).position(|w| w == b"\"items\"").unwrap();
        bytes[kind_at + 1..kind_at + 6].copy_from_slice(b"vault");
        assert!(read(&bytes, &right).is_err());
        // Argon2 parameters meant to stall the app: refused before any work.
        let stalling = KdfParams { memory_kib: u32::MAX, ..TEST_KDF };
        let head = header_bytes(&Header {
            kind: Kind::Items,
            protection: Protection::Password { kdf: stalling, salt: B64.encode([0u8; SALT_LEN]), nonce: B64.encode([0u8; NONCE_PREFIX_LEN]) },
        });
        let hostile = [head, vec![0u8; 64]].concat();
        assert_eq!(read(&hostile, &right).unwrap_err(), EMERALD_UNREADABLE);
    }

    #[test]
    fn old_and_newer_files_are_named() {
        // A plain ZIP and the JSON files of format 6 and before.
        assert_eq!(read(b"PK\x03\x04rest", &none()).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(read(br#"{"version":"5","type":"entry"}"#, &none()).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(read(b"\xEF\xBB\xBF\n  {\"version\":\"3\"}", &none()).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(read(b"EMRE\x01rest", &none()).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(read(b"hello", &none()).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(read(b"", &none()).unwrap_err(), EMERALD_UNREADABLE);
        let mut newer = write(contents(Kind::Items, b"png bytes".to_vec()), plain());
        newer[MAGIC.len()] = VERSION + 1;
        assert_eq!(read(&newer, &none()).unwrap_err(), EMERALD_NEWER);
        // A protection this build does not know.
        let head = br#"{"kind":"items","protection":{"type":"quantum"}}"#;
        let bytes = [b"EMRE\x02".as_slice(), &(head.len() as u32).to_le_bytes(), head, b"PK"].concat();
        assert_eq!(read(&bytes, &none()).unwrap_err(), EMERALD_NEWER);
    }

    #[test]
    fn the_manifest_is_checked_before_pictures_are_stored() {
        let ok = br#"{"format":"emerald","version":7,"kind":"items","items":[{"kind":"entry"}]}"#;
        assert!(check_manifest(ok, Kind::Items).is_ok());
        assert_eq!(check_manifest(ok, Kind::Vault).unwrap_err(), EMERALD_UNREADABLE);
        let vault = br#"{"format":"emerald","version":7,"kind":"vault","data":{}}"#;
        assert!(check_manifest(vault, Kind::Vault).is_ok());
        assert_eq!(check_manifest(br#"{"format":"emerald","version":7,"kind":"vault","data":[]}"#, Kind::Vault).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(check_manifest(br#"{"format":"emerald","version":8,"kind":"items","items":[{}]}"#, Kind::Items).unwrap_err(), EMERALD_NEWER);
        assert_eq!(check_manifest(br#"{"format":"emerald","version":6,"kind":"items","items":[{}]}"#, Kind::Items).unwrap_err(), EMERALD_OLD_FORMAT);
        assert_eq!(check_manifest(br#"{"format":"other","version":7,"kind":"items","items":[{}]}"#, Kind::Items).unwrap_err(), EMERALD_UNREADABLE);
        assert_eq!(check_manifest(br#"{"format":"emerald","version":7,"kind":"items","items":[]}"#, Kind::Items).unwrap_err(), EMERALD_UNREADABLE);
        let many = format!(r#"{{"format":"emerald","version":7,"kind":"items","items":[{}]}}"#, vec!["{}"; MAX_ITEMS + 1].join(","));
        assert_eq!(check_manifest(many.as_bytes(), Kind::Items).unwrap_err(), EMERALD_TOO_LARGE);
        assert_eq!(check_manifest(b"not json", Kind::Items).unwrap_err(), EMERALD_UNREADABLE);
    }

    /// A plain file around a ZIP with the given members, written without any of our checks.
    fn raw_file(members: &[(&str, &[u8])], deflate: bool) -> Vec<u8> {
        let method = if deflate { zip::CompressionMethod::Deflated } else { zip::CompressionMethod::Stored };
        let options = zip::write::SimpleFileOptions::default().compression_method(method);
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in members {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        let body = zip.finish().unwrap().into_inner();
        [header_bytes(&Header { kind: Kind::Items, protection: Protection::None }), body].concat()
    }

    fn raw_zip_of(bytes: &[u8], limits: Limits) -> Result<Zip, String> {
        let mut cursor = Cursor::new(bytes.to_vec());
        let head = read_header(&mut cursor)?;
        let body: Box<dyn Body> = Box::new(Window::new(cursor, head.bytes.len() as u64).unwrap());
        open_zip(body, limits)
    }

    const ITEMS_MANIFEST: &[u8] = br#"{"format":"emerald","version":7,"kind":"items","items":[{}]}"#;

    #[test]
    fn too_large_members_and_bombs_are_refused() {
        let limits = limits_for(Kind::Items);
        // One member above its cap — also when deflate would unpack it from a few bytes.
        let big = vec![0u8; 4096];
        let bytes = raw_file(&[(MANIFEST, ITEMS_MANIFEST), (&format!("images/{IMG}"), &big)], true);
        let mut zip = raw_zip_of(&bytes, limits).unwrap();
        let small = Limits { member: 1024, ..limits };
        assert_eq!(store_members(&mut zip, small, |_, _, _| Ok(String::new())).unwrap_err(), EMERALD_TOO_LARGE);
        // The manifest above its own.
        let bytes = raw_file(&[(MANIFEST, &big)], true);
        let mut zip = raw_zip_of(&bytes, limits).unwrap();
        assert_eq!(read_manifest(&mut zip, Limits { manifest: 1024, ..limits }).unwrap_err(), EMERALD_TOO_LARGE);
        // Many members whose sum goes beyond the total, each below its cap.
        let chunk = vec![7u8; 1000];
        let names: Vec<String> = (0..20).map(|i| format!("images/{i:064x}.png")).collect();
        let mut members: Vec<(&str, &[u8])> = vec![(MANIFEST, ITEMS_MANIFEST)];
        members.extend(names.iter().map(|n| (n.as_str(), chunk.as_slice())));
        let bytes = raw_file(&members, false);
        let mut zip = raw_zip_of(&bytes, limits).unwrap();
        let tight = Limits { total: 10_000, member: 2000, ..limits };
        assert_eq!(store_members(&mut zip, tight, |_, _, _| Ok(String::new())).unwrap_err(), EMERALD_TOO_LARGE);
        // And the export does not write what the import would refuse.
        let too_big = Limits { member: 4, ..limits };
        assert_eq!(write_file(Vec::new(), contents(Kind::Items, b"png bytes".to_vec()), plain(), too_big).unwrap_err(), EMERALD_TOO_LARGE);
        let few = Limits { members: 2, ..limits };
        assert_eq!(write_file(Vec::new(), contents(Kind::Items, b"png bytes".to_vec()), plain(), few).unwrap_err(), EMERALD_TOO_LARGE);
    }

    #[test]
    fn too_many_members_are_refused_before_parsing() {
        let names: Vec<String> = (0..12).map(|i| format!("images/{i:064x}.png")).collect();
        let mut members: Vec<(&str, &[u8])> = vec![(MANIFEST, ITEMS_MANIFEST)];
        members.extend(names.iter().map(|n| (n.as_str(), b"x".as_slice())));
        let bytes = raw_file(&members, false);
        assert_eq!(raw_zip_of(&bytes, Limits { members: 10, ..limits_for(Kind::Items) }).err(), Some(EMERALD_TOO_LARGE.to_string()));
        assert!(raw_zip_of(&bytes, limits_for(Kind::Items)).is_ok());
    }

    #[test]
    fn a_zip64_count_is_read_from_its_record() {
        // A ZIP64 end record claiming a vast number of members, in front of the end record.
        let mut bytes = raw_file(&[(MANIFEST, ITEMS_MANIFEST)], false);
        let start = header_bytes(&Header { kind: Kind::Items, protection: Protection::None }).len();
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let cd_size = u32::from_le_bytes(bytes[eocd + 12..eocd + 16].try_into().unwrap()) as u64;
        let cd_offset = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as u64;
        let record_at = (eocd - start) as u64;
        let mut record = b"PK\x06\x06".to_vec();
        record.extend_from_slice(&[0u8; 28]);
        record.extend_from_slice(&u64::MAX.to_le_bytes());
        record.extend_from_slice(&cd_size.to_le_bytes());
        record.extend_from_slice(&cd_offset.to_le_bytes());
        let mut locator = b"PK\x06\x07".to_vec();
        locator.extend_from_slice(&[0u8; 4]);
        locator.extend_from_slice(&record_at.to_le_bytes());
        locator.extend_from_slice(&[0u8; 4]);
        bytes.splice(eocd..eocd, [record, locator].concat());
        assert_eq!(raw_zip_of(&bytes, limits_for(Kind::Items)).err(), Some(EMERALD_TOO_LARGE.to_string()));
    }

    #[test]
    fn an_end_record_that_does_not_add_up_is_refused() {
        // A genuine archive with a forged end record behind it, claiming one member:
        // the ZIP reader would walk back to the genuine one and count by it.
        let names: Vec<String> = (0..12).map(|i| format!("images/{i:064x}.png")).collect();
        let mut members: Vec<(&str, &[u8])> = vec![(MANIFEST, ITEMS_MANIFEST)];
        members.extend(names.iter().map(|n| (n.as_str(), b"x".as_slice())));
        let mut bytes = raw_file(&members, false);
        let mut forged = b"PK\x05\x06".to_vec();
        forged.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
        forged.extend_from_slice(&46u32.to_le_bytes());
        forged.extend_from_slice(&u32::MAX.to_le_bytes());
        forged.extend_from_slice(&[0, 0]);
        bytes.extend_from_slice(&forged);
        assert_eq!(raw_zip_of(&bytes, Limits { members: 10, ..limits_for(Kind::Items) }).err(), Some(EMERALD_UNREADABLE.to_string()));
        // A comment after the end record is none this app writes.
        let mut commented = raw_file(&[(MANIFEST, ITEMS_MANIFEST)], false);
        let at = commented.len() - 2;
        commented[at] = 3;
        commented.extend_from_slice(b"hey");
        assert!(raw_zip_of(&commented, limits_for(Kind::Items)).is_err());
    }

    #[test]
    fn a_manifest_made_to_swell_is_refused() {
        // Twenty megabytes of padding deflate to a few kilobytes.
        let padded = format!(
            r#"{{"format":"emerald","version":7,"kind":"items","items":[{{}}],"pad":"{}"}}"#,
            " ".repeat(20 * 1024 * 1024)
        );
        let bytes = raw_file(&[(MANIFEST, padded.as_bytes())], true);
        assert!(bytes.len() < 1024 * 1024);
        let mut zip = raw_zip_of(&bytes, limits_for(Kind::Vault)).unwrap();
        assert_eq!(read_manifest(&mut zip, limits_for(Kind::Vault)).unwrap_err(), EMERALD_TOO_LARGE);
    }

    #[test]
    fn a_file_comes_into_place_whole() {
        let dir = std::env::temp_dir().join(format!("emerald-place-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("x.vault.emerald");
        std::fs::write(&target, b"old").unwrap();
        // A crash remnant under the part's name is replaced, not appended to.
        std::fs::write(part_path(&target), b"stale remnant").unwrap();
        place_file(&target, 1024, |mut out| {
            out.write_all(b"new").map_err(|e| e.to_string())?;
            Ok(out)
        })
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!part_path(&target).exists());
        // A failed write leaves the target as it was and no part behind.
        let failed = place_file(&target, 1024, |_| Err("boom".to_string()));
        assert_eq!(failed.unwrap_err(), "boom");
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!part_path(&target).exists());
        // Too large: refused, the target stays.
        let big = place_file(&target, 2, |mut out| {
            out.write_all(b"too big").map_err(|e| e.to_string())?;
            Ok(out)
        });
        assert_eq!(big.unwrap_err(), EMERALD_TOO_LARGE);
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).ok();
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
            let bytes = raw_file(&[(MANIFEST, ITEMS_MANIFEST), (name, b"x")], false);
            assert_eq!(raw_zip_of(&bytes, limits_for(Kind::Items)).err(), Some(EMERALD_UNREADABLE.to_string()), "{name}");
        }
    }

    #[test]
    fn an_archive_without_a_manifest_is_refused() {
        let bytes = raw_file(&[(&format!("images/{IMG}"), b"x")], false);
        assert_eq!(raw_zip_of(&bytes, limits_for(Kind::Items)).err(), Some(EMERALD_UNREADABLE.to_string()));
    }

    #[test]
    fn svg_and_oversized_icons_are_skipped() {
        let svg = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210.svg";
        let bytes = raw_file(&[(MANIFEST, ITEMS_MANIFEST), (&format!("icons/{svg}"), b"<svg/>")], false);
        let mut zip = raw_zip_of(&bytes, limits_for(Kind::Items)).unwrap();
        let stored = store_members(&mut zip, limits_for(Kind::Items), |_, _, _| Ok("x".into())).unwrap();
        assert!(stored.icons.is_empty());
    }
}
