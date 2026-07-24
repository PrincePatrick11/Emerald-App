//! macOS PDF export — drives the app's own `WKWebView` via
//! `createPDFWithConfiguration:completionHandler:` to render the export
//! HTML to PDF (Option A from the plan).
//!
//! Flow mirrors the Windows path (see `windows.rs`): build a hidden
//! `WebviewWindow` with the export HTML, wait for `PageLoadEvent::Finished`
//! via a oneshot, then use `with_webview` to get the `WKWebView` pointer
//! and call `createPDFWithConfiguration:completionHandler:`. The
//! completion handler runs on a background queue; we bridge it back to
//! async with a second oneshot wrapped in `Arc<Mutex<Option<_>>>`.
//!
//! ⚠️  Untested in this session — written blind. The Windows path is
//! tested; this one needs a real Mac to verify the AppKit threading
//! assumptions and the exact `objc2-web-kit` API surface for the
//! `createPDFWithConfiguration:` call.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send};
use objc2_foundation::{MainThreadMarker, NSData, NSString};
use objc2_web_kit::{WKPDFConfiguration, WKWebView};

use tauri::AppHandle;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

/// Maximum time we'll wait for the hidden WKWebView to finish loading
/// the export HTML before giving up.
const PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum time we'll wait for `createPDFWithConfiguration:` to finish.
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

/// `page_size` — `(width_in, height_in)` in inches, used on Windows to size
/// the PDF page to the Altar's own aspect ratio (see `windows.rs`). Not yet
/// wired up here (would need `WKPDFConfiguration.rect`, sized in points);
/// left unused pending real-device verification, same caveat as the rest
/// of this file.
pub async fn export_pdf(
    app: &AppHandle,
    html: String,
    path: String,
    _page_size: Option<(f64, f64)>,
) -> Result<(), String> {
    eprintln!(
        "emerald pdf-export (wkwebview): invoked ({} bytes html → {})",
        html.len(),
        path
    );

    // Write the export HTML to a temp file. Tauri 2's `WebviewUrl` enum
    // has no `Html` variant, so we serve the document via a `file://`
    // URL. The file is removed at the end (success or error).
    let temp_html = std::env::temp_dir()
        .join(format!("emerald-export-{}.html", uuid::Uuid::new_v4()));
    std::fs::write(&temp_html, html.as_bytes())
        .map_err(|e| format!("write temp html: {e}"))?;
    eprintln!("emerald pdf-export (wkwebview): wrote temp html to {}", temp_html.display());

    // 1. Build the hidden window. The `on_page_load` callback signals a
    //    oneshot when the page finishes loading so we don't race createPDF.
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

    // Run the rest inside a guard so we always clean up the temp file
    // and the hidden window — success or error.
    let result = async {
        // 2. Wait for the page to finish loading.
        let _ = tokio::time::timeout(PAGE_LOAD_TIMEOUT, page_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for hidden WKWebView to load the export HTML",
                PAGE_LOAD_TIMEOUT
            ))?
            .map_err(|_| "hidden WKWebView dropped the page-loaded signal".to_string())?;

        eprintln!("emerald pdf-export (wkwebview): page loaded, calling createPDF");

        // 3. Drive createPDF on the main thread via `with_webview`. The
        //    completion handler fires on a background queue; we bridge it
        //    back to async with a oneshot wrapped in `Arc<Mutex<Option<_>>>`.
        let (pdf_tx, pdf_rx) = oneshot::channel::<Result<(), String>>();
        let pdf_tx = Arc::new(Mutex::new(Some(pdf_tx)));
        let path_for_handler = path.clone();

        win.with_webview(move |webview| {
            // `with_webview` dispatches us to the main thread (AppKit
            // requirement) and gives us a `PlatformWebview` whose
            // `inner()` is the raw `*mut c_void` WKWebView pointer.
            let webview_ptr = webview.inner();
            let wkv: &WKWebView =
                unsafe { &*(webview_ptr as *const WKWebView) };

            // We're on the main thread, so we can grab a MainThreadMarker.
            let mtm = MainThreadMarker::new()
                .expect("with_webview should always run on the main thread");
            let pdf_config = WKPDFConfiguration::new(mtm);

            // The Arc is cloned into the closure so we can still report
            // synchronously if `createPDFWithConfiguration:` itself fails
            // before the completion handler would ever fire.
            let pdf_tx_for_handler = pdf_tx.clone();

            let handler = block2::ConcreteBlock::new(
                move |data: Option<Retained<NSData>>, error: *mut AnyObject| {
                    let result = (|| -> Result<(), String> {
                        // `error` is a `*mut NSError` (id-style). When
                        // non-null, surface its localizedDescription.
                        if !error.is_null() {
                            let desc: Option<Retained<NSString>> = unsafe {
                                msg_send![&*error, localizedDescription]
                            };
                            let msg = desc
                                .as_ref()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| "unknown error".to_string());
                            return Err(format!("createPDF failed: {msg}"));
                        }
                        let data = data
                            .ok_or_else(|| "createPDF returned no data and no error".to_string())?;

                        // Write the PDF to the user-chosen path. NSData's
                        // `writeToFile:atomically:` handles the parent
                        // directory and atomic-replace semantics — we
                        // don't need a separate mkdir.
                        let path_ns = NSString::from_str(&path_for_handler);
                        let mut write_error: *mut AnyObject = std::ptr::null_mut();
                        let ok: bool = unsafe {
                            msg_send![
                                &*data,
                                writeToFile: &*path_ns,
                                atomically: true,
                                error: &mut write_error
                            ]
                        };
                        if !ok {
                            let desc: Option<Retained<NSString>> = if !write_error.is_null() {
                                unsafe { msg_send![&*write_error, localizedDescription] }
                            } else {
                                None
                            };
                            let msg = desc
                                .as_ref()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| "unknown error".to_string());
                            return Err(format!("write PDF: {msg}"));
                        }
                        Ok(())
                    })();

                    let tx = pdf_tx_for_handler.lock().unwrap().take();
                    if let Some(tx) = tx {
                        let _ = tx.send(result);
                    }
                },
            );
            let handler = handler.copy();
            unsafe {
                let _: () = msg_send![
                    wkv,
                    createPDFWithConfiguration: &*pdf_config,
                    completionHandler: &*handler
                ];
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;

        // 4. Wait for the completion handler. `createPDF` for a long
        //    entry can take a few seconds; cap with a generous timeout.
        tokio::time::timeout(PRINT_TIMEOUT, pdf_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for createPDF to finish",
                PRINT_TIMEOUT
            ))?
            .map_err(|_| "createPDF callback channel dropped".to_string())?
    }
    .await;

    // 5. Close the hidden window. Done outside `with_webview` because
    //    we only hold the `WebviewWindow` handle.
    if let Err(e) = win.close() {
        eprintln!("emerald pdf-export (wkwebview): warning — close hidden window: {e}");
    }
    // Always clean up the temp html, success or not.
    let _ = std::fs::remove_file(&temp_html);

    result?;
    eprintln!("emerald pdf-export (wkwebview): PDF written to {path}");
    Ok(())
}
