//! PDF export — drives the platform's own webview to render HTML to PDF.
//!
//! Per-platform implementations live in `windows.rs`, `macos.rs`, and
//! `linux.rs`. Each is gated by `#[cfg(target_os = "…")]` and exposes a
//! single `pub async fn export_pdf` with the same signature. The
//! `pub use` re-exports below let `lib.rs` call `pdf_export::export_pdf`
//! without knowing which platform it's on.
//!
//! All three are implemented and verified end-to-end on real hardware.

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::export_pdf;
#[cfg(target_os = "macos")]
pub use macos::export_pdf;
#[cfg(target_os = "linux")]
pub use linux::export_pdf;

use std::path::{Path, PathBuf};

const TEMP_PREFIX: &str = "emerald-export-";
const TEMP_SUFFIX: &str = ".html";

/// The export's HTML in the temp directory — the entry in plain text, outside
/// the vault, because the webview loads it as a `file://` page. Removed when
/// dropped, however the export ends.
pub(crate) struct TempHtml(PathBuf);

impl TempHtml {
    /// A new file only this user can read — under Linux `/tmp` is shared.
    pub(crate) fn write(html: &str) -> Result<Self, String> {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}{TEMP_SUFFIX}", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let guard = TempHtml(path);
        options
            .open(&guard.0)
            .and_then(|mut file| file.write_all(html.as_bytes()))
            .map_err(|e| format!("write temp html: {e}"))?;
        Ok(guard)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempHtml {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Removes export HTML a crash left behind. Only files older than an hour: a
/// second Emerald (the dev build next to the release) may be exporting right
/// now.
pub fn sweep_leftovers() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    let hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !(name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX)) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|md| md.modified())
            .is_ok_and(|modified| modified < hour_ago);
        if old && entry.file_type().is_ok_and(|t| t.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
