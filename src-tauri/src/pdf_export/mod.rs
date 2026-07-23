//! PDF export — drives the platform's own webview to render HTML to PDF.
//!
//! Per-platform implementations live in `windows.rs`, `macos.rs`, and
//! `linux.rs`. Each is gated by `#[cfg(target_os = "…")]` and exposes a
//! single `pub async fn export_pdf` with the same signature. The
//! `pub use` re-export below lets `lib.rs` call `pdf_export::export_pdf`
//! without knowing which platform it's on.
//!
//! See `tmp/pdf-export-native-webview.md` (Phases 1/2/3) for the per-platform
//! design notes. Until all phases are done, `lib.rs` only enables the new
//! path on Windows and falls back to the `wkhtmltopdf` subprocess on
//! macOS/Linux. The fallback is removed in Phase 5 once every native
//! path is verified end-to-end on real hardware.
//!
//! Status:
//!   - Windows: implemented (Phase 1). WebView2 + `ICoreWebView2_7::PrintToPdf`.
//!   - macOS:   TODO (Phase 2). `macos.rs` is a stub that returns an
//!     error explaining the path isn't implemented yet — `lib.rs` does
//!     NOT route to it. The `wkhtmltopdf` fallback handles macOS today.
//!   - Linux:   TODO (Phase 3). Same as macOS.

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::export_pdf;
