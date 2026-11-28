//! macOS PDF export — prints the app's own `WKWebView` into a file.
//!
//! Flow mirrors the Windows path (see `windows.rs`): build a hidden
//! `WebviewWindow` with the export HTML, wait for `PageLoadEvent::Finished`
//! via a oneshot, then use `with_webview` to get the `WKWebView` pointer.
//!
//! It prints rather than calling `createPDFWithConfiguration:`: that one
//! captures the page as it looks on screen — one tall page, no `@media print`
//! and no page breaks. `printOperationWithPrintInfo:` paginates like the
//! other platforms (A4, the print styles, an entry per page in a bundle).
//! The `NSPrintInfo` saves the job to the chosen path (`NSPrintSaveJob`), no
//! panel is shown. WebKit prints asynchronously, so the operation runs
//! "modal for the window" with a delegate whose `didRun` selector reports
//! the end through a oneshot; a synchronous `runOperation` would print blank
//! pages.

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{class, define_class, msg_send, sel, AnyThread, DefinedClass};
use objc2_foundation::{NSRect, NSSize, NSString};
use objc2_web_kit::WKWebView;

use tauri::AppHandle;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

/// Maximum time we'll wait for the hidden WKWebView to finish loading
/// the export HTML before giving up.
const PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum time we'll wait for the print operation to finish.
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

/// The page margins, in points — the `@page { margin: 2cm 2.5cm }` of the
/// export's print styles (`PDF_MARGINS` in `src/lib/exportStyle.ts`), which WebKit's print path takes from `NSPrintInfo`.
const POINTS_PER_INCH: f64 = 72.0;
const MARGIN_VERTICAL: f64 = super::MARGIN_VERTICAL_IN * POINTS_PER_INCH;
const MARGIN_HORIZONTAL: f64 = super::MARGIN_HORIZONTAL_IN * POINTS_PER_INCH;

/// `NSPrintingPaginationMode`: fit the width, break the height automatically.
const PAGINATION_AUTOMATIC: usize = 0;
const PAGINATION_FIT: usize = 1;

// AppKit's own constants — their string values differ from their names.
#[link(name = "AppKit", kind = "framework")]
extern "C" {
    static NSPrintSaveJob: &'static NSString;
    static NSPrintJobSavingURL: &'static NSString;
}

type Done = Mutex<Option<oneshot::Sender<Result<(), String>>>>;

/// Receives `printOperationDidRun:success:contextInfo:` and passes the
/// result on.
struct DelegateIvars {
    done: Arc<Done>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "EmeraldPdfPrintDelegate"]
    #[ivars = DelegateIvars]
    struct PrintDelegate;

    impl PrintDelegate {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn did_run(&self, _operation: *mut AnyObject, success: Bool, _context: *mut c_void) {
            if let Some(tx) = self.ivars().done.lock().unwrap().take() {
                let result = if success.as_bool() { Ok(()) } else { Err("AppKit reported the print as failed".to_string()) };
                let _ = tx.send(result);
            }
            // The print operation does not retain its delegate: `ACTIVE` kept
            // it alive until now — this one, not another export's that may
            // still be running after a timeout. Released after this call returns.
            ACTIVE.with(|active| {
                let mut active = active.borrow_mut();
                if let Some(i) = active.iter().position(|d| std::ptr::eq(&**d, self)) {
                    let _ = Retained::autorelease_ptr(active.swap_remove(i));
                }
            });
        }
    }
);

impl PrintDelegate {
    fn new(done: Arc<Done>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { done });
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// The delegates of the print operations running on the main thread —
    /// normally one; a timed-out operation may still be running beside the next.
    static ACTIVE: RefCell<Vec<Retained<PrintDelegate>>> = const { RefCell::new(Vec::new()) };
}

/// `page_size` — `(width_in, height_in)` in inches, honoured on Windows only
/// (see `windows.rs`; the frontend passes none at present). Not
/// wired up here (would replace the A4 `paperSize`, in points).
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
    // URL. `TempHtml` removes it however the export ends — also on an early error.
    let temp_html = super::TempHtml::write(&html)?;

    // 1. Build the hidden window. The `on_page_load` callback signals a
    //    oneshot when the page finishes loading so we don't race the print.
    let (page_tx, page_rx) = oneshot::channel::<()>();
    let page_tx = Arc::new(Mutex::new(Some(page_tx)));

    let url = url::Url::from_file_path(temp_html.path())
        .map_err(|_| format!("could not build file:// URL for {}", temp_html.path().display()))?;

    let win = WebviewWindowBuilder::new(app, "pdf-export", WebviewUrl::External(url))
        .visible(false)
        .inner_size(800.0, 600.0)
        .title("Emerald App PDF Export")
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
        tokio::time::timeout(PAGE_LOAD_TIMEOUT, page_rx)
            .await
            .map_err(|_| format!(
                "timed out after {:?} waiting for hidden WKWebView to load the export HTML",
                PAGE_LOAD_TIMEOUT
            ))?
            .map_err(|_| "hidden WKWebView dropped the page-loaded signal".to_string())?;

        eprintln!("emerald pdf-export (wkwebview): page loaded, printing");

        // A file already at the path (the save dialog asked to replace it)
        // stays until the print overwrites it: only one changed since now
        // counts as this export's result.
        let before = modified(&path);

        // 3. Start the print operation on the main thread (`with_webview`
        //    dispatches there, an AppKit requirement).
        let (done_tx, done_rx) = oneshot::channel::<Result<(), String>>();
        let done: Arc<Done> = Arc::new(Mutex::new(Some(done_tx)));
        let path_for_print = path.clone();

        win.with_webview(move |webview| {
            let wkv: &WKWebView = unsafe { &*(webview.inner() as *const WKWebView) };
            if let Err(e) = start_print(wkv, &path_for_print, done.clone()) {
                if let Some(tx) = done.lock().unwrap().take() {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;

        // 4. Wait for the delegate's report.
        tokio::time::timeout(PRINT_TIMEOUT, done_rx)
            .await
            .map_err(|_| format!("timed out after {:?} waiting for the print to finish", PRINT_TIMEOUT))?
            .map_err(|_| "print callback channel dropped".to_string())??;
        match modified(&path) {
            Some(now) if before.is_none_or(|b| now > b) => Ok(()),
            _ => Err("the print finished but wrote no PDF".to_string()),
        }
    }
    .await;

    // 5. Close the hidden window. Done outside `with_webview` because
    //    we only hold the `WebviewWindow` handle.
    if let Err(e) = win.close() {
        eprintln!("emerald pdf-export (wkwebview): warning — close hidden window: {e}");
    }
    // Gone before anything else can fail.
    drop(temp_html);

    result?;
    eprintln!("emerald pdf-export (wkwebview): PDF written to {path}");
    Ok(())
}

/// When the file at `path` was last changed — `None` if there is none.
fn modified(path: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// A print info that saves into `url` without asking. The disposition comes
/// first: setting it may reset the job's other settings.
unsafe fn save_to(info: &AnyObject, url: &AnyObject) {
    let _: () = msg_send![info, setJobDisposition: NSPrintSaveJob];
    let dict: Retained<AnyObject> = msg_send![info, dictionary];
    let _: () = msg_send![&dict, setObject: url, forKey: NSPrintJobSavingURL];
}

/// Sets up `NSPrintInfo` to save into `path` and runs the web view's print
/// operation without panels. Main thread only.
fn start_print(wkv: &WKWebView, path: &str, done: Arc<Done>) -> Result<(), String> {
    unsafe {
        let shared: Retained<AnyObject> = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        let info: Retained<AnyObject> = msg_send![&shared, copy];

        let url: Option<Retained<AnyObject>> =
            msg_send![class!(NSURL), fileURLWithPath: &*NSString::from_str(path)];
        let url = url.ok_or("could not build a file URL for the PDF")?;
        save_to(&info, &url);

        // A4 on every system, whatever paper the Mac is set to.
        let a4 = NSSize::new(super::A4_INCHES.0 * POINTS_PER_INCH, super::A4_INCHES.1 * POINTS_PER_INCH);
        let _: () = msg_send![&info, setPaperSize: a4];
        let _: () = msg_send![&info, setTopMargin: MARGIN_VERTICAL];
        let _: () = msg_send![&info, setBottomMargin: MARGIN_VERTICAL];
        let _: () = msg_send![&info, setLeftMargin: MARGIN_HORIZONTAL];
        let _: () = msg_send![&info, setRightMargin: MARGIN_HORIZONTAL];
        let _: () = msg_send![&info, setHorizontalPagination: PAGINATION_FIT];
        let _: () = msg_send![&info, setVerticalPagination: PAGINATION_AUTOMATIC];
        let _: () = msg_send![&info, setHorizontallyCentered: false];
        let _: () = msg_send![&info, setVerticallyCentered: false];

        let operation: Option<Retained<AnyObject>> = msg_send![wkv, printOperationWithPrintInfo: &*info];
        let operation = operation.ok_or("the web view gave no print operation")?;
        let _: () = msg_send![&operation, setShowsPrintPanel: false];
        let _: () = msg_send![&operation, setShowsProgressPanel: false];
        // The operation works on a print info of its own: tell it the target
        // too, or it asks with a save panel.
        let op_info: Option<Retained<AnyObject>> = msg_send![&operation, printInfo];
        if let Some(op_info) = op_info {
            save_to(&op_info, &url);
        }

        // The operation's view starts without a size and would print blank.
        let view: Option<Retained<AnyObject>> = msg_send![&operation, view];
        if let Some(view) = view {
            let bounds: NSRect = msg_send![wkv, bounds];
            let _: () = msg_send![&view, setFrame: bounds];
        }

        let window: Option<Retained<AnyObject>> = msg_send![wkv, window];
        let window = window.ok_or("the hidden web view has no window")?;

        let delegate = PrintDelegate::new(done);
        ACTIVE.with(|active| active.borrow_mut().push(delegate.clone()));
        let _: () = msg_send![
            &operation,
            runOperationModalForWindow: &*window,
            delegate: &*delegate,
            didRunSelector: sel!(printOperationDidRun:success:contextInfo:),
            contextInfo: std::ptr::null_mut::<c_void>()
        ];
    }
    Ok(())
}
