//! Linux PDF export — drives the app's own WebKit webview via
//! `WebKitPrintOperation` to render the export HTML to PDF.
//!
//! Flow mirrors the Windows path (see `windows.rs`): build a hidden
//! `WebviewWindow` with the export HTML, wait for `PageLoadEvent::Finished`
//! via a oneshot, then use `with_webview` to grab the `WebView` and run a
//! `PrintOperation` configured for PDF output to the user-chosen path.
//!
//! Print settings (`output-file-format`, `output-uri`) come from
//! `gtk::PrintSettings`, not `webkit2gtk` — the WebKit crate only owns
//! `PrintOperation`/`PrintOperationExt`, whose `print()` takes no
//! action argument and always renders to `output-uri` without a
//! dialog.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

use gtk::PrintSettings;
use webkit2gtk::{PrintOperation, PrintOperationExt};

/// `GtkPrinter` / `gtk_enumerate_printers` aren't covered by the `gtk`
/// crate's bindings (the "unix print" header is excluded from its gir
/// scan), so we call libgtk-3 directly. It's already linked in via the
/// `gtk`/`webkit2gtk` crates, so this needs no extra build config.
mod printer_ffi {
    use std::os::raw::{c_char, c_int, c_void};

    #[repr(C)]
    pub struct GtkPrinter {
        _private: [u8; 0],
    }

    extern "C" {
        pub fn gtk_enumerate_printers(
            func: unsafe extern "C" fn(*mut GtkPrinter, *mut c_void) -> c_int,
            data: *mut c_void,
            destroy: Option<unsafe extern "C" fn(*mut c_void)>,
            wait: c_int,
        );
        pub fn gtk_printer_get_name(printer: *mut GtkPrinter) -> *const c_char;
        pub fn gtk_printer_is_virtual(printer: *mut GtkPrinter) -> c_int;
        pub fn gtk_printer_accepts_pdf(printer: *mut GtkPrinter) -> c_int;
    }
}

/// Find the name of GTK's built-in "Print to File" virtual printer.
/// Its display name is locale-translated (e.g. "In Datei drucken" on a
/// German system), so it can't be hardcoded — we have to enumerate.
/// `webkit_print_operation_print()` always routes through GTK's normal
/// printer resolution (it's not a plain filesystem write), and fails
/// with "Printer not found" unless `GtkPrintSettings`' `printer` key
/// names a printer that actually exists, so we resolve and set it
/// ourselves rather than relying on a default that this virtual
/// printer never claims to be (`gtk_printer_is_default` is false for
/// it, even when it's the only printer registered).
fn find_pdf_printer_name() -> Option<String> {
    unsafe extern "C" fn on_printer(
        printer: *mut printer_ffi::GtkPrinter,
        data: *mut std::ffi::c_void,
    ) -> std::os::raw::c_int {
        let out = unsafe { &mut *(data as *mut Option<String>) };
        let is_match = unsafe {
            printer_ffi::gtk_printer_is_virtual(printer) != 0
                && printer_ffi::gtk_printer_accepts_pdf(printer) != 0
        };
        if is_match {
            let name_ptr = unsafe { printer_ffi::gtk_printer_get_name(printer) };
            if !name_ptr.is_null() {
                *out = Some(
                    unsafe { std::ffi::CStr::from_ptr(name_ptr) }
                        .to_string_lossy()
                        .into_owned(),
                );
            }
            return 1; // TRUE: stop enumerating, we found it.
        }
        0 // FALSE: keep enumerating.
    }

    let mut result: Option<String> = None;
    unsafe {
        printer_ffi::gtk_enumerate_printers(
            on_printer,
            &mut result as *mut Option<String> as *mut std::ffi::c_void,
            None,
            1, // wait: block until enumeration finishes (this runs on the GTK main thread).
        );
    }
    result
}

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
        //    `PrintOperation::print` is NOT synchronous — it kicks off
        //    the job and returns immediately; completion is reported
        //    later via the `finished`/`failed` signals, still on the
        //    main thread. `run_print` wires those signals to `pdf_tx`
        //    instead of sending a result itself.
        let (pdf_tx, pdf_rx) = oneshot::channel::<Result<(), String>>();
        let pdf_tx = Arc::new(Mutex::new(Some(pdf_tx)));
        let path_for_thread = path.clone();

        win.with_webview(move |webview| {
            // `with_webview` gives us a `PlatformWebview` whose
            // `inner()` returns a `webkit2gtk::WebView` (already cloned,
            // refcounted).
            let wv: webkit2gtk::WebView = webview.inner();
            if let Err(e) = run_print(&wv, &path_for_thread, pdf_tx.clone()) {
                let tx = pdf_tx.lock().unwrap().take();
                if let Some(tx) = tx {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;

        // 4. Wait for the `finished`/`failed` signal, relayed through
        //    `pdf_tx` by `run_print`. `PRINT_TIMEOUT` guards against a
        //    print job that never reports back.
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

/// Configure and start the print operation for PDF export. Runs on the
/// GTK main thread (we're inside `with_webview`). Does not block on the
/// print job itself — `print()` starts an async operation, so this
/// connects the `finished`/`failed` signals to relay the eventual
/// result through `pdf_tx` (shared with the caller's oneshot receiver).
fn run_print(
    webview: &webkit2gtk::WebView,
    path: &str,
    pdf_tx: Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>,
) -> Result<(), String> {
    let printer_name = find_pdf_printer_name().ok_or_else(|| {
        "no virtual PDF printer found (GTK's \"Print to File\" backend is missing or disabled)"
            .to_string()
    })?;

    let print_op = PrintOperation::new(webview);

    let settings = PrintSettings::new();
    // Without an explicit printer, WebKit's printer resolution comes up
    // empty on a machine with no real (CUPS) printers configured — see
    // `find_pdf_printer_name` for why this can't be hardcoded.
    settings.set_printer(&printer_name);
    // `gtk::PrintSettings` has no typed setters for these — only the
    // generic string-keyed `set`. Keys match `Gtk::PrintSettings` (see
    // `GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT` / `_OUTPUT_URI` in gtk-sys).
    settings.set("output-file-format", Some("pdf"));
    // GTK expects a file:// URI in the output-uri. The path is the
    // user-chosen absolute path on disk.
    let file_uri = format!("file://{path}");
    settings.set("output-uri", Some(&file_uri));

    print_op.set_print_settings(&settings);

    // WebKit keeps its own reference to the operation while it's
    // running (same convention as `GtkPrintOperation`), so it's safe
    // that no Rust-side owner outlives this function — the object
    // stays alive until one of these signals fires.
    let tx_finished = pdf_tx.clone();
    print_op.connect_finished(move |_op| {
        if let Some(tx) = tx_finished.lock().unwrap().take() {
            let _ = tx.send(Ok(()));
        }
    });
    print_op.connect_failed(move |_op, error| {
        if let Some(tx) = pdf_tx.lock().unwrap().take() {
            let _ = tx.send(Err(format!("WebKitPrintOperation: {error}")));
        }
    });

    // `WebKitPrintOperation::print` (unlike `Gtk::PrintOperation::run`)
    // takes no action argument and returns nothing — it always renders
    // to the configured `output-uri` without showing a dialog, and
    // reports completion asynchronously via the signals above.
    print_op.print();

    Ok(())
}
