//! Image storage, scoped to a vault.
//!
//! Files live in `{vaultDir}/images/{sha256}.{ext}`. The database stores the
//! bare filename — no directory, no drive letter — which is what makes a vault
//! directory copyable to another machine.
//!
//! Display goes through the `emerald-img` URI scheme rather than through IPC:
//! the webview requests `emerald-img://localhost/{vaultId}/{filename}` and gets
//! the bytes back directly, so nothing is base64-encoded, copied across the
//! bridge, or held in the JavaScript heap for the rest of the session.
//! `read_image_as_base64` remains for the two callers that genuinely need a
//! data-URL: the PDF export (which renders in a `file://` webview the scheme
//! cannot reach) and the backup writer.

use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::http::{Request, Response};
use tauri::UriSchemeContext;

use crate::vault;

fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

pub fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

const IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/// A stored image is named after the SHA-256 of its own bytes, so a valid name
/// is 64 hex digits and a known extension — nothing else.
///
/// This is the only thing standing between the URI scheme and the filesystem.
/// The names it guards reach us out of stored HTML content, which may have come
/// from an imported backup, so they are not trusted input. Rejecting everything
/// that is not hex also means percent-encoded traversal never has to be decoded
/// and handled: it simply fails the alphabet check.
pub(crate) fn is_valid_image_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    stem.len() == 64
        && stem.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && IMAGE_EXTS.contains(&ext)
}

/// Resolves a stored filename to a file on disk: the vault's own folder first,
/// then the shared pool every vault used before the per-vault layout. The
/// fallback is what keeps images rendering when migration v35 could not copy
/// one over.
fn locate(app: &tauri::AppHandle, vault_id: &str, filename: &str) -> Result<PathBuf, String> {
    if !is_valid_image_name(filename) {
        return Err("invalid image name".to_string());
    }
    let own = vault::vault_dir(app, vault_id)?
        .join(vault::IMAGES_SUBDIR)
        .join(filename);
    if own.is_file() {
        return Ok(own);
    }
    let legacy = vault::legacy_images_dir(app)?.join(filename);
    if legacy.is_file() {
        return Ok(legacy);
    }
    Err("file not found".to_string())
}

// ── commands ─────────────────────────────────────────────────────────────────

/// Serialisiert Schreiben und Loeschen in der Bildablage. Solange die
/// Commands synchron auf dem Main-Thread liefen, war diese Serialisierung
/// implizit; seit sie auf dem Blocking-Pool laufen, koennte sonst der
/// Storage-Cleanup eine Datei loeschen, deren Hash ein gleichzeitiges
/// save_image gerade als "existiert schon" uebersprungen hat.
static IMAGE_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn image_write_guard() -> std::sync::MutexGuard<'static, ()> {
    IMAGE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Stores a base64 data-URL and returns the filename it was given.
/// SHA-256 of the raw bytes is the name, so identical images share one file.
#[tauri::command]
pub async fn save_image(
    app: tauri::AppHandle,
    data_url: String,
    vault_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mime_part, b64) = data_url
            .strip_prefix("data:")
            .and_then(|s| s.split_once(','))
            .ok_or("Invalid data URL")?;

        let ext = ext_for_mime(mime_part.split(';').next().unwrap_or(""));
        let bytes = general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| e.to_string())?;

        let filename = format!("{}.{}", sha256_hex(&bytes), ext);
        let path = vault::images_dir(&app, &vault_id)?.join(&filename);
        let _guard = image_write_guard();
        if !path.exists() {
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        }
        Ok(filename)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copies a file from an arbitrary location into the vault and returns the
/// filename it was given. Same deduplication as `save_image`.
#[tauri::command]
pub async fn copy_image_file(
    app: tauri::AppHandle,
    source: String,
    vault_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = crate::ext_for_path(&source);
        if !IMAGE_EXTS.contains(&ext.as_str()) {
            return Err("unsupported file type".to_string());
        }

        let canonical_source = crate::guarded_read_path(&app, &source)?;
        let bytes = std::fs::read(&canonical_source).map_err(|e| format!("read {source}: {e}"))?;
        let filename = format!("{}.{}", sha256_hex(&bytes), ext);
        let path = vault::images_dir(&app, &vault_id)?.join(&filename);
        let _guard = image_write_guard();
        if !path.exists() {
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        }
        Ok(filename)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads a stored image and returns it as a base64 data-URL.
///
/// Only for the callers that cannot use the `emerald-img` scheme: the PDF
/// export renders in a `file://` webview, and the backup writer has to embed
/// the bytes in JSON.
#[tauri::command]
pub async fn read_image_as_base64(
    app: tauri::AppHandle,
    filename: String,
    vault_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = locate(&app, &vault_id, &filename)?;
        let bytes = std::fs::read(&path).map_err(|e| format!("read: {e}"))?;
        let ext = crate::ext_for_path(&filename);
        Ok(format!(
            "data:{};base64,{}",
            mime_for_ext(&ext),
            general_purpose::STANDARD.encode(&bytes)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copies images out of the pre-per-vault shared pool into a vault's own folder.
/// Migration v35 calls this with the names it found in that vault's content.
/// Returns how many files were copied.
#[tauri::command]
pub async fn adopt_legacy_images(
    app: tauri::AppHandle,
    vault_id: String,
    filenames: Vec<String>,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target_dir = vault::images_dir(&app, &vault_id)?;
        let legacy_dir = vault::legacy_images_dir(&app)?;
        let _guard = image_write_guard();
        let mut copied = 0;

        for name in filenames {
            if !is_valid_image_name(&name) {
                continue;
            }
            let target = target_dir.join(&name);
            if target.exists() {
                continue;
            }
            let source = legacy_dir.join(&name);
            if !source.is_file() {
                continue;
            }
            if std::fs::copy(&source, &target).is_ok() {
                copied += 1;
            }
        }

        Ok(copied)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct StoredImage {
    pub name: String,
    pub bytes: u64,
}

/// Every image file in a vault's own folder. The shared legacy pool is
/// deliberately not listed: it is still readable by vaults that have not been
/// opened since the migration, so nothing here may propose deleting from it.
#[tauri::command]
pub async fn list_image_files(
    app: tauri::AppHandle,
    vault_id: String,
) -> Result<Vec<StoredImage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = vault::images_dir(&app, &vault_id)?;
        let mut out = Vec::new();

        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_valid_image_name(&name) {
                continue;
            }
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(StoredImage { name, bytes });
        }

        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes the named images from a vault's own folder. Returns bytes freed.
#[tauri::command]
pub async fn delete_image_files(
    app: tauri::AppHandle,
    vault_id: String,
    filenames: Vec<String>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = vault::images_dir(&app, &vault_id)?;
        let _guard = image_write_guard();
        let mut freed = 0u64;

        for name in filenames {
            if !is_valid_image_name(&name) {
                continue;
            }
            let path = dir.join(&name);
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&path).is_ok() {
                freed += size;
            }
        }

        Ok(freed)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── emerald-img:// ───────────────────────────────────────────────────────────

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .expect("static response")
}

fn serve(app: &tauri::AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // `/{vaultId}/{filename}` on every platform. Windows serves custom schemes
    // as `http://emerald-img.localhost/…` and the others as
    // `emerald-img://localhost/…`, but the host carries no meaning either way,
    // so the path is identical.
    let path = request.uri().path();
    let mut segments = path.trim_start_matches('/').splitn(2, '/');
    let (Some(vault_id), Some(filename)) = (segments.next(), segments.next()) else {
        return not_found();
    };

    let Ok(file) = locate(app, vault_id, filename) else {
        return not_found();
    };
    let Ok(bytes) = std::fs::read(&file) else {
        return not_found();
    };

    Response::builder()
        .status(200)
        .header("Content-Type", mime_for_ext(&crate::ext_for_path(filename)))
        // Belt and braces. Nothing depends on this any more — the altar
        // export, the one path that reads a canvas back, now loads its images
        // as data-URLs precisely so it does not have to rely on a custom
        // scheme being CORS-enabled (which wry never registers it as, and
        // which cannot be verified from every host). The header stays because
        // these images come from the app's own storage, so allowing the read
        // gives the page nothing it could not already ask for.
        .header("Access-Control-Allow-Origin", "*")
        // The filename is the hash of the content, so a given URL can never
        // return anything else.
        .header("Cache-Control", "max-age=31536000, immutable")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}

/// Registers the `emerald-img` scheme. Reads run off the main thread so a
/// large image cannot stall the UI.
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(
        "emerald-img",
        |ctx: UriSchemeContext<'_, tauri::Wry>, request, responder| {
            let app = ctx.app_handle().clone();
            // spawn_blocking statt thread::spawn: der Blocking-Pool
            // wiederverwendet seine Threads ueber Bursts hinweg, statt fuer
            // jedes Bild einen frischen OS-Thread zu starten und wieder
            // abzubauen. (Sein Limit liegt bei 512 — ein Deckel ist er bei
            // realen Eintragsgroessen nicht, der Gewinn ist die Wiederverwendung.)
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(serve(&app, &request));
            });
        },
    )
}
