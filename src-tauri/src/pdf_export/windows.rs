//! Windows PDF export — drives the app's own WebView2 (Edge / Chromium) to
//! render the export HTML to a PDF file via `ICoreWebView2_7::PrintToPdf`.
//!
//! Flow:
//!   1. Build a hidden `WebviewWindow` with the export HTML.
//!   2. Wait for `PageLoadEvent::Finished` (signaled via a `oneshot` channel
//!      from the window's `on_page_load` callback).
//!   3. Hop to the main thread via `with_webview`, query `ICoreWebView2_7`,
//!      call `PrintToPdf(path, settings, handler)`. The handler runs on a
//!      COM apartment thread; we bridge it back to async with a second
//!      `oneshot` channel wrapped in `Arc<Mutex<Option<_>>>`.
//!   4. On success, the PDF is at `path`. Close the hidden window.
//!   5. On any failure, surface the COM error message to the caller.
//!
//! The CSP from `tauri.conf.json` is applied to this window. The export
//! HTML's inline `<style>` is fine (`style-src 'unsafe-inline'`), but
//! inline `<script>` is blocked (`script-src 'self'`). The frontend must
//! pre-transform internal link spans into chips before passing the HTML
//! here — see `lib/export.ts`.

use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_2, ICoreWebView2_7, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
    ICoreWebView2PrintSettings2, ICoreWebView2PrintToPdfCompletedHandler,
    COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::Interface;
use windows::core::PCWSTR;

use tauri::AppHandle;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

/// Maximum time we'll wait for the hidden webview to finish loading the
/// export HTML before giving up. The page is small and local; even on a
/// cold WebView2 (~1 s init) it should be well under this. If we ever
/// hit it, the error tells the user the export took too long rather than
/// hanging the call.
const PAGE_LOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Maximum time we'll wait for `PrintToPdf` to finish. A long entry
/// (many pages) is still realistically a couple of seconds.
const PRINT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// `page_size`, when present, is `(width_in, height_in)` in inches and is
/// applied as a custom media size (zero margins) via
/// `ICoreWebView2Environment6::CreatePrintSettings`, instead of the
/// default Letter/Portrait page `PrintToPdf` otherwise falls back to.
pub async fn export_pdf(
    app: &AppHandle,
    html: String,
    path: String,
    page_size: Option<(f64, f64)>,
) -> Result<(), String> {
    eprintln!(
        "emerald pdf-export (webview2): invoked ({} bytes html → {})",
        html.len(),
        path
    );

    // Write the HTML to a unique temp file. Tauri 2's `WebviewUrl` enum
    // doesn't have an `Html` variant, so we serve the document via a
    // `file://` URL. The file is removed at the end (success or error).
    let temp_html = std::env::temp_dir()
        .join(format!("emerald-export-{}.html", uuid::Uuid::new_v4()));
    std::fs::write(&temp_html, html.as_bytes())
        .map_err(|e| format!("write temp html: {e}"))?;
    eprintln!("emerald pdf-export (webview2): wrote temp html to {}", temp_html.display());

    // 1. Build the hidden window. The `on_page_load` callback signals a
    //    oneshot when the page finishes loading so we don't race PrintToPdf.
    let (page_tx, page_rx) = oneshot::channel::<()>();
    let page_tx = Arc::new(Mutex::new(Some(page_tx)));

    let url = url::Url::from_file_path(&temp_html)
        .map_err(|_| format!("could not build file:// URL for {}", temp_html.display()))?;

    let win = WebviewWindowBuilder::new(app, "pdf-export", WebviewUrl::External(url))
        .visible(false)
        .inner_size(800.0, 600.0)
        .title("Emerald PDF Export")
        .on_page_load(move |_win, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let tx = page_tx.lock().unwrap().take();
                if let Some(tx) = tx {
                    let _ = tx.send(());
                }
            }
        })
        .build()
        .map_err(|e| format!("build hidden webview: {e}"))?;

    // Wait for the page to finish loading, then run the rest inside a
    // guard so we always clean up the temp file and the hidden window.
    let page_load_result = async {
        // 2. Wait for the page to finish loading. Use a timeout so a wedged
        //    WebView2 init can't hang the export forever.
        let _ = tokio::time::timeout(PAGE_LOAD_TIMEOUT, page_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for hidden webview to load the export HTML",
                PAGE_LOAD_TIMEOUT
            ))?
            .map_err(|_| "hidden webview dropped the page-loaded signal".to_string())?;

        eprintln!("emerald pdf-export (webview2): page loaded, calling PrintToPdf");

        // 3. Drive PrintToPdf on the main thread via `with_webview`. The
        //    COM callback fires on a worker thread; we bridge it back to
        //    async with a oneshot wrapped in Arc<Mutex<Option<_>>> so the
        //    handler can move out of it.
        let (pdf_tx, pdf_rx) = oneshot::channel::<Result<(), String>>();
        let pdf_tx = Arc::new(Mutex::new(Some(pdf_tx)));
        let path_for_thread = path.clone();

        win.with_webview(move |webview| {
            let controller = webview.controller();
            let core = match unsafe { controller.CoreWebView2() } {
                Ok(c) => c,
                Err(e) => {
                    send_err(&pdf_tx, format!("CoreWebView2(): {e}"));
                    return;
                }
            };
            let webview7: ICoreWebView2_7 = match core.cast() {
                Ok(w) => w,
                Err(e) => {
                    send_err(&pdf_tx, format!("cast to ICoreWebView2_7: {e}"));
                    return;
                }
            };

            // Build a custom-size print settings object when the caller
            // asked for one (Altar PDF export). Any failure along this
            // path just falls back to the default Letter/Portrait page
            // rather than aborting the whole export.
            let print_settings: Option<ICoreWebView2PrintSettings> = page_size.and_then(|(width_in, height_in)| {
                let build = || -> windows::core::Result<ICoreWebView2PrintSettings> {
                    let core2: ICoreWebView2_2 = core.cast()?;
                    let env = unsafe { core2.Environment()? };
                    let env6: ICoreWebView2Environment6 = env.cast()?;
                    let settings = unsafe { env6.CreatePrintSettings()? };
                    let settings2: ICoreWebView2PrintSettings2 = settings.cast()?;
                    unsafe {
                        settings2.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
                        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
                        settings.SetPageWidth(width_in)?;
                        settings.SetPageHeight(height_in)?;
                        settings.SetMarginTop(0.0)?;
                        settings.SetMarginBottom(0.0)?;
                        settings.SetMarginLeft(0.0)?;
                        settings.SetMarginRight(0.0)?;
                    }
                    Ok(settings)
                };
                match build() {
                    Ok(s) => Some(s),
                    Err(e) => {
                        eprintln!("emerald pdf-export (webview2): custom page size setup failed, falling back to default: {e}");
                        None
                    }
                }
            });

            // The Arc is cloned into the closure so we can still report
            // synchronously if `PrintToPdf` itself fails before the
            // callback would ever fire.
            let pdf_tx_for_handler = pdf_tx.clone();

            let pdf_handler: ICoreWebView2PrintToPdfCompletedHandler =
                PrintToPdfCompletedHandler::create(Box::new(move |error_code, _is_ok| {
                    let tx = pdf_tx_for_handler.lock().unwrap().take();
                    if let Some(tx) = tx {
                        match error_code {
                            Ok(()) => {
                                let _ = tx.send(Ok(()));
                            }
                            Err(e) => {
                                let _ = tx.send(Err(format!("PrintToPdf failed: {e}")));
                            }
                        }
                    }
                    Ok(())
                }));

            // PCWSTR expects a null-terminated UTF-16 buffer. The buffer must
            // outlive the PrintToPdf call (which is synchronous in returning
            // the HRESULT, so this is fine — the callback runs later but
            // WebView2 has already copied what it needs).
            let path_utf16: Vec<u16> = path_for_thread
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let pcwstr = PCWSTR(path_utf16.as_ptr());

            let call_result = unsafe {
                webview7.PrintToPdf(
                    pcwstr,
                    print_settings.as_ref(),
                    &pdf_handler,
                )
            };
            if let Err(e) = call_result {
                send_err(&pdf_tx, format!("PrintToPdf call: {e}"));
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;

        // 4. Wait for the COM callback. PrintToPdf can take a few seconds
        //    for long entries; cap with a generous timeout.
        let result = tokio::time::timeout(PRINT_TIMEOUT, pdf_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for PrintToPdf to finish",
                PRINT_TIMEOUT
            ))?
            .map_err(|_| "PrintToPdf callback channel dropped".to_string())?;

        result
    }
    .await;

    // 5. Close the hidden window. Done outside `with_webview` because we
    //    only hold the `WebviewWindow` handle, not a raw COM pointer.
    if let Err(e) = win.close() {
        eprintln!("emerald pdf-export (webview2): warning — close hidden window: {e}");
    }
    // Always clean up the temp html, success or not.
    let _ = std::fs::remove_file(&temp_html);

    page_load_result?;
    eprintln!("emerald pdf-export (webview2): PDF written to {path}");
    Ok(())
}

fn send_err(tx: &Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>, msg: String) {
    if let Some(tx) = tx.lock().unwrap().take() {
        let _ = tx.send(Err(msg));
    }
}
