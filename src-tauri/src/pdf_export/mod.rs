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
