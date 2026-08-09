//! Linux PDF export — drives the app's own WebKit webview via
//! `WebKitPrintOperation` to render the export HTML to PDF.
//!
//! Flow mirrors the Windows path (see `windows.rs`): build a hidden
//! `WebviewWindow` with the export HTML, wait for `PageLoadEvent::Finished`
//! via a oneshot, then use `with_webview` to grab the `WebView` and run a
//! `PrintOperation` configured for PDF output to the user-chosen path.
//!
//! ⚠️  Untested in this session — written blind, because we have no
//! Linux box available. The Windows path is tested; this one needs a
//! real Linux (Ubuntu 22.04 LTS or 24.04 LTS per the plan's supported
//! matrix) to verify the webkit2gtk version expectations and the
//! headless-print API surface.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

use webkit2gtk::{PrintOperation, PrintOperationAction, PrintOperationOutputFormat, PrintSettings, WebViewExt};

use tauri::AppHandle;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

const PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

/// `page_size` — `(width_in, height_in)` in inches, used on Windows to size
/// the PDF page to the Altar's own aspect ratio (see `windows.rs`). Not yet
/// wired up here (would need a custom `GtkPaperSize` on the print
/// settings); left unused pending real-device verification, same caveat
/// as the rest of this file.
pub async fn export_pdf(
    app: &AppHandle,
    html: String,
    path: String,
    _page_size: Option<(f64, f64)>,
) -> Result<(), String> {
    eprintln!(
        "emerald pdf-export (webkitgtk): invoked ({} bytes html → {})",
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
    eprintln!("emerald pdf-export (webkitgtk): wrote temp html to {}", temp_html.display());

    // 1. Build the hidden window. The `on_page_load` callback signals a
    //    oneshot when the page finishes loading so we don't race the
    //    print operation.
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
                "timed out after {:?} waiting for hidden WebKit webview to load the export HTML",
                PAGE_LOAD_TIMEOUT
            ))?
            .map_err(|_| "hidden webview dropped the page-loaded signal".to_string())?;

        eprintln!("emerald pdf-export (webkitgtk): page loaded, calling PrintOperation");

        // 3. Run a PrintOperation configured for PDF output. The
        //    `with_webview` closure runs on the main thread (the GTK
        //    main thread, where webkit2gtk requires all calls to land).
        //    `PrintOperation::print(PrintOperationAction::Export)` is
        //    synchronous in the Rust binding — it blocks until the
        //    operation finishes writing the PDF.
        let (pdf_tx, pdf_rx) = oneshot::channel::<Result<(), String>>();
        let pdf_tx = Arc::new(Mutex::new(Some(pdf_tx)));
        let path_for_thread = path.clone();

        win.with_webview(move |webview| {
            // `with_webview` gives us a `PlatformWebview` whose
            // `inner()` returns a `webkit2gtk::WebView` (already cloned,
            // refcounted).
            let wv: webkit2gtk::WebView = webview.inner();
            let result = run_print(&wv, &path_for_thread);
            let tx = pdf_tx.lock().unwrap().take();
            if let Some(tx) = tx {
                let _ = tx.send(result);
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;

        // 4. Wait for the result. The synchronous `print` call inside
        //    `with_webview` already finished by the time we get here, so
        //    the oneshot should fire immediately; the timeout is just
        //    a safety net in case a future webkit2gtk makes the call
        //    async via callback.
        tokio::time::timeout(PRINT_TIMEOUT, pdf_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for WebKitPrintOperation to finish",
                PRINT_TIMEOUT
            ))?
            .map_err(|_| "print operation channel dropped".to_string())?
    }
    .await;

    // 5. Close the hidden window. Done outside `with_webview` because
    //    we only hold the `WebviewWindow` handle.
    if let Err(e) = win.close() {
        eprintln!("emerald pdf-export (webkitgtk): warning — close hidden window: {e}");
    }
    // Always clean up the temp html, success or not.
    let _ = std::fs::remove_file(&temp_html);

    // Verify the PDF actually landed on disk. `WebKitPrintOperation`
    // can succeed at the API level but still produce a zero-byte file
    // if something inside WebKit choked — better to surface that as
    // an error than ship an empty PDF to the user.
    if result.is_ok() {
        let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
        if meta.len() == 0 {
            return Err(format!("WebKitPrintOperation produced a zero-byte PDF at {path}"));
        }
    }

    result?;
    eprintln!("emerald pdf-export (webkitgtk): PDF written to {path}");
    Ok(())
}

/// Configure and run the print operation for PDF export. Runs on the
/// GTK main thread (we're inside `with_webview`).
fn run_print(webview: &webkit2gtk::WebView, path: &str) -> Result<(), String> {
    let print_op = PrintOperation::new(webview);

    let settings = PrintSettings::new();
    settings.set_output_format(PrintOperationOutputFormat::Pdf);
    // GTK expects a file:// URI in the output_uri. The path is the
    // user-chosen absolute path on disk.
    let file_uri = format!("file://{path}");
    settings.set_output_uri(Some(&file_uri));

    print_op.set_print_settings(&settings);

    // `PrintOperationAction::Export` = render to the file at
    // `output_uri` without showing any dialog. The synchronous Rust
    // binding blocks until the operation finishes; WebKit internally
    // runs the print on a worker thread but our side waits.
    print_op
        .print(PrintOperationAction::Export)
        .map_err(|e| format!("WebKitPrintOperation: {e}"))?;

    Ok(())
}
