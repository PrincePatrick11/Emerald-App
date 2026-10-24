//! Dev-only bridge that lets the MCP server in `tools/mcp` drive the app
//! where the webview has no debug port of its own.
//!
//! On Windows the MCP server talks to WebView2 through the Chrome DevTools
//! Protocol. WKWebView and WebKitGTK offer nothing like it, so this module
//! serves the small part of that protocol the MCP server uses — the target
//! list under `/json`, and `Runtime.evaluate`, a few `Input.*` and `Page.*`
//! methods and the console events over a WebSocket — from inside the app. The
//! MCP server then works against either without knowing which it has.
//!
//! Scripts go into the page with `WebviewWindow::eval`, which returns nothing;
//! the page half (`devbridge.js`) hands results and console output back through
//! the two commands below.
//!
//! Whoever reaches the port runs JavaScript in the app. It therefore exists
//! only behind the `devbridge` cargo feature, which no release build can have
//! (see the `compile_error!` in `lib.rs`), listens on the loopback interface
//! only, stays closed unless `EMERALD_DEVBRIDGE_PORT` is set, and turns away
//! every connection that carries an `Origin` header — a web page open in a
//! browser on the same machine could otherwise connect.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

const PORT_ENV: &str = "EMERALD_DEVBRIDGE_PORT";
const HIDE_ENV: &str = "EMERALD_DEVBRIDGE_HIDE_WINDOW";
const PAGE_JS: &str = include_str!("devbridge.js");
/// The client gives up on its own, usually sooner; this only keeps an answer
/// that never comes from being waited for indefinitely.
const REPLY_TIMEOUT: Duration = Duration::from_secs(60);
const EVENT_BACKLOG: usize = 256;

pub struct Bridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<String>>>,
    events: broadcast::Sender<String>,
    listening: AtomicBool,
    /// Folder dialogs the Rust side asked for, waiting for the client.
    folder_dialogs: Mutex<Vec<oneshot::Sender<Option<PathBuf>>>>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            events: broadcast::channel(EVENT_BACKLOG).0,
            listening: AtomicBool::new(false),
            folder_dialogs: Mutex::new(Vec::new()),
        }
    }
}

#[tauri::command]
pub fn devbridge_reply(bridge: State<'_, Bridge>, id: u64, payload: String) {
    if let Some(waiting) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = waiting.send(payload);
    }
}

#[tauri::command]
pub fn devbridge_event(bridge: State<'_, Bridge>, payload: String) {
    // No receiver means no client is connected; the event is simply dropped.
    let _ = bridge.events.send(payload);
}

/// Stands in for a folder dialog opened from Rust: waits until the bridge's
/// client names a folder or cancels. `None` when nobody is listening, and the
/// native dialog is the one to open. Blocks, like the dialog it replaces.
pub fn pick_folder(app: &AppHandle) -> Option<Option<PathBuf>> {
    let bridge = app.state::<Bridge>();
    if !bridge.listening.load(Ordering::Relaxed) {
        return None;
    }
    let (answer_tx, answer) = oneshot::channel();
    bridge.folder_dialogs.lock().unwrap().push(answer_tx);
    Some(answer.blocking_recv().unwrap_or(None))
}

/// Whether the instance keeps its windows out of the user's way: asked for by
/// whoever starts it, and only while the bridge is what drives it.
fn out_of_sight() -> bool {
    std::env::var(PORT_ENV).is_ok() && std::env::var(HIDE_ENV).as_deref() == Ok("1")
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry, ()>::new("emerald-devbridge")
        .js_init_script(PAGE_JS.to_string())
        .on_window_ready(|window| {
            if out_of_sight() {
                native::hide(&window);
            }
        })
        .on_event(|app, event| {
            // Runs on the main thread, as the event loop does.
            // No Dock icon and no place in the app switcher. Set once the app
            // has finished launching: set during setup, it is overwritten by
            // the default policy when launching completes.
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Ready) && out_of_sight() {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            if let tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Focused(true), .. } = event {
                if out_of_sight() && !native::shown() {
                    let _ = app;
                    native::give_focus_back();
                }
            }
        })
        .setup(|app, _api| {
            app.manage(Bridge::default());
            #[cfg(target_os = "macos")]
            if out_of_sight() {
                native::remember_front_app();
            }
            match std::env::var(PORT_ENV).ok().and_then(|port| port.parse::<u16>().ok()) {
                Some(port) => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = serve(app, port).await {
                            eprintln!("emerald devbridge: stopped: {e}");
                        }
                    });
                }
                None => eprintln!("emerald devbridge: built in, but {PORT_ENV} is not set — not listening"),
            }
            Ok(())
        })
        .build()
}

async fn serve(app: AppHandle, port: u16) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    app.state::<Bridge>().listening.store(true, Ordering::Relaxed);
    eprintln!("emerald devbridge: listening on 127.0.0.1:{port}");
    loop {
        let (stream, _) = listener.accept().await?;
        tauri::async_runtime::spawn(connection(app.clone(), stream, port));
    }
}

async fn connection(app: AppHandle, stream: TcpStream, port: u16) {
    // The target list is plain HTTP and the session a WebSocket, on one port
    // as with a real debug port. Peeking leaves the request in the socket for
    // the WebSocket handshake to read.
    let mut head = [0u8; 512];
    let Ok(read) = stream.peek(&mut head).await else { return };
    let head = String::from_utf8_lossy(&head[..read]).into_owned();
    let path = head.split_whitespace().nth(1).unwrap_or("");
    if path.starts_with("/json") {
        http_json(&app, stream, path, port).await;
        return;
    }
    let refuse_browsers = |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
        if request.headers().contains_key("origin") {
            let mut refusal = ErrorResponse::new(Some("the dev bridge takes no connections from web pages".into()));
            *refusal.status_mut() = StatusCode::FORBIDDEN;
            return Err(refusal);
        }
        Ok(response)
    };
    if let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, refuse_browsers).await {
        session(app, socket).await;
    }
}

async fn http_json(app: &AppHandle, mut stream: TcpStream, path: &str, port: u16) {
    // Read the request before answering: closing a socket with unread data in
    // it resets the connection, and the client sees an error instead of JSON.
    let mut request = Vec::new();
    let mut chunk = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") && request.len() < 16 * 1024 {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => request.extend_from_slice(&chunk[..n]),
        }
    }
    let body = if path.starts_with("/json/version") {
        json!({ "Browser": "EmeraldDevBridge/1", "Protocol-Version": "1.3" })
    } else {
        match app.get_webview_window("main") {
            Some(window) => json!([{
                "id": "main",
                "type": "page",
                "title": window.title().unwrap_or_default(),
                "url": window.url().map(|url| url.to_string()).unwrap_or_default(),
                "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/page/main"),
            }]),
            None => json!([]),
        }
    }
    .to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn session(app: AppHandle, socket: tokio_tungstenite::WebSocketStream<TcpStream>) {
    let mut events = app.state::<Bridge>().events.subscribe();
    let (mut sink, mut source) = socket.split();
    // Requests are answered out of order — an evaluation that awaits something
    // must not hold up the ones behind it — so answers come back through here.
    let (answers_tx, mut answers) = mpsc::unbounded_channel::<String>();
    loop {
        let outgoing = tokio::select! {
            message = source.next() => match message {
                Some(Ok(message)) if message.is_text() => {
                    if let Ok(text) = message.to_text().map(str::to_owned) {
                        let (app, answers_tx) = (app.clone(), answers_tx.clone());
                        tauri::async_runtime::spawn(async move {
                            let _ = answers_tx.send(answer(&app, &text).await);
                        });
                    }
                    continue;
                }
                Some(Ok(message)) if message.is_close() => break,
                Some(Ok(_)) => continue,
                _ => break,
            },
            Some(text) = answers.recv() => text,
            event = events.recv() => match event {
                Ok(text) => text,
                // Fell behind a burst of console output: the rest still counts.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
        };
        if sink.send(Message::text(outgoing)).await.is_err() {
            break;
        }
    }
}

async fn answer(app: &AppHandle, text: &str) -> String {
    let request: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match dispatch(app, method, &params).await {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(message) => json!({ "id": id, "error": { "code": -32000, "message": message } }),
    }
    .to_string()
}

async fn dispatch(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        // Nothing to switch on: console output is always forwarded, and the
        // page keeps taking input without the window having the focus.
        "Runtime.enable" | "Page.enable" | "Log.enable" | "Emulation.setFocusEmulationEnabled" => Ok(json!({})),
        "Runtime.evaluate" => {
            let expression = params.get("expression").and_then(Value::as_str).unwrap_or("");
            let by_value = params.get("returnByValue").and_then(Value::as_bool).unwrap_or(false);
            evaluate(app, expression, by_value).await
        }
        "Runtime.callFunctionOn" => {
            let function = params.get("functionDeclaration").and_then(Value::as_str).unwrap_or("");
            let object = params.get("objectId").cloned().unwrap_or(Value::Null);
            evaluate(app, &format!("({function}\n).call(window.__emeraldBridge.object({object}))"), true).await
        }
        "Runtime.releaseObjectGroup" => page_call(app, "release", &json!({})).await,
        "Page.getLayoutMetrics" => page_call(app, "layoutMetrics", &json!({})).await,
        "Input.dispatchMouseEvent" => {
            // Where the platform can hand the webview a real mouse event, it
            // does. Where it cannot, a press does not reach the page at all,
            // and the MCP server, seeing that nothing arrived, falls back to
            // its own way of clicking.
            let native = native::mouse(&main_window(app)?, params).await?;
            // A move is dispatched in the page as well, whatever the platform
            // did with it: WebKit drops real moves while the app is not the
            // active one, and handlers that wait for a hover would never run.
            if params.get("type").and_then(Value::as_str) == Some("mouseMoved") {
                return page_call(app, "mouseMoved", params).await;
            }
            let _ = native;
            Ok(json!({}))
        }
        // Not part of the DevTools protocol.
        "Emerald.dialogs" => dialogs(app, params).await,
        // An instance kept out of sight can be looked at after all, and put
        // away again. Without `visible` it only reports.
        "Emerald.window" => {
            if !out_of_sight() {
                return Ok(json!({ "visible": true, "hideable": false }));
            }
            if let Some(visible) = params.get("visible").and_then(Value::as_bool) {
                native::show(&main_window(app)?, visible);
            }
            Ok(json!({ "visible": native::shown(), "hideable": true }))
        }
        "Input.insertText" => page_call(app, "insertText", params).await,
        "Input.dispatchKeyEvent" => page_call(app, "key", params).await,
        "Page.navigate" => {
            let url = params.get("url").and_then(Value::as_str).unwrap_or("");
            let url = url::Url::parse(url).map_err(|e| format!("not a URL: {e}"))?;
            main_window(app)?.navigate(url).map_err(|e| e.to_string())?;
            Ok(json!({}))
        }
        "Page.reload" => {
            main_window(app)?.eval("location.reload()").map_err(|e| e.to_string())?;
            Ok(json!({}))
        }
        "Page.captureScreenshot" => {
            let png = screenshot::capture(&main_window(app)?, screenshot::Clip::from(params)).await?;
            use base64::Engine as _;
            Ok(json!({ "data": base64::engine::general_purpose::STANDARD.encode(png) }))
        }
        other => Err(format!("'{other}' is not available through the dev bridge")),
    }
}

/// The app's dialogs, listed or answered.
///
/// Three kinds, in one list and in this order: those the page asked for, which
/// `devbridge.js` holds back so they can be answered at all; folder dialogs
/// the Rust side asked for through `pick_folder`; and native ones, which the
/// platform module reads from the app's own windows. While a native dialog
/// blocks the main thread the page does not answer, and its part is missing.
async fn dialogs(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let action = params.get("action").and_then(Value::as_str).unwrap_or("list");
    let bridge = app.state::<Bridge>();
    let page_held = || async {
        match tokio::time::timeout(Duration::from_secs(2), page_call(app, "dialogs", &json!({}))).await {
            Ok(Ok(Value::Array(held))) => held,
            _ => Vec::new(),
        }
    };
    let folder_held = || {
        let waiting = bridge.folder_dialogs.lock().unwrap().len();
        vec![json!({ "title": "Select Folder", "buttons": ["Open", "Cancel"], "file_field": true }); waiting]
    };
    let listing = |parts: [Vec<Value>; 3]| {
        let all = parts.into_iter().flatten().enumerate().map(|(index, mut dialog)| {
            dialog["index"] = json!(index);
            dialog
        });
        Value::Array(all.collect())
    };
    let from_page = page_held().await;
    if action == "list" {
        return Ok(json!({ "dialogs": listing([from_page, folder_held(), native::list_dialogs().await?]) }));
    }

    let index = params.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
    let from_rust = bridge.folder_dialogs.lock().unwrap().len();
    let mut request = params.clone();
    let mut outcome = if index < from_page.len() {
        page_call(app, "answerDialog", &request).await?
    } else if index < from_page.len() + from_rust {
        answer_folder_dialog(&bridge, index - from_page.len(), &request)?
    } else {
        request["index"] = json!(index - from_page.len() - from_rust);
        native::answer_dialog(&request).await?
    };
    outcome["dialogs"] = listing([page_held().await, folder_held(), native::list_dialogs().await?]);
    Ok(outcome)
}

fn answer_folder_dialog(bridge: &Bridge, index: usize, params: &Value) -> Result<Value, String> {
    let text = |key: &str| params.get(key).and_then(Value::as_str);
    let opens = match (text("action").unwrap_or(""), text("button").map(str::to_lowercase).as_deref()) {
        ("accept", _) | ("click", Some("open")) => true,
        ("cancel", _) | ("click", Some("cancel")) => false,
        ("click", _) => return Err("this dialog has: Open, Cancel".to_string()),
        (other, _) => return Err(format!("unknown action {other:?} - list, accept, cancel or click")),
    };
    let answer = match (opens, text("path")) {
        (true, Some(path)) => Some(PathBuf::from(path)),
        (true, None) => return Err("this dialog needs a full path - pass `path`".to_string()),
        (false, _) => None,
    };
    let mut waiting = bridge.folder_dialogs.lock().unwrap();
    if index >= waiting.len() {
        return Err("that dialog is no longer open".to_string());
    }
    let _ = waiting.remove(index).send(answer);
    Ok(json!({ "pressed": if opens { "Open" } else { "Cancel" }, "closed": true }))
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "the app has no main window right now".to_string())
}

/// Calls one of `window.__emeraldBridge`'s functions and returns what it
/// returned, which is already shaped like the protocol's answer.
async fn page_call(app: &AppHandle, function: &str, params: &Value) -> Result<Value, String> {
    let outcome = evaluate(app, &format!("window.__emeraldBridge.{function}({params})"), true).await?;
    if let Some(details) = outcome.get("exceptionDetails") {
        let description = details.pointer("/exception/description").and_then(Value::as_str);
        return Err(description.unwrap_or("the page raised an error").to_string());
    }
    Ok(outcome.pointer("/result/value").cloned().unwrap_or_else(|| json!({})))
}

/// Runs `source` in the page and returns the protocol's `Runtime.evaluate`
/// answer: `{ result }` or `{ exceptionDetails }`.
///
/// The source is tried as an expression first, so its value can be returned.
/// A script that does not parse fails without a trace, which is why each
/// attempt is followed by a second script that reports when the first never
/// started. Statements run on the second attempt and have no value.
async fn evaluate(app: &AppHandle, source: &str, by_value: bool) -> Result<Value, String> {
    let window = main_window(app)?;
    let bridge = app.state::<Bridge>();
    let source = source.trim().trim_end_matches(';');
    let options = json!({ "returnByValue": by_value });

    for body in [format!("return (\n{source}\n);"), format!("{source}\n")] {
        let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply) = oneshot::channel();
        bridge.pending.lock().unwrap().insert(id, reply_tx);

        let sent = window
            .eval("window.__emeraldBridge && window.__emeraldBridge.probe(true);")
            .and_then(|_| window.eval(&format!("window.__emeraldBridge.run({id}, {options}, async () => {{ {body} }});")))
            .and_then(|_| {
                window.eval(&format!(
                    "(function () {{ var b = window.__emeraldBridge; if (b) b.probe(false); if (b && b.started({id})) return; \
                     window.__TAURI_INTERNALS__.invoke('devbridge_reply', {{ id: {id}, \
                     payload: JSON.stringify({{ bridgeError: b ? 'parse' : 'missing' }}) }}); }})();"
                ))
            });
        if let Err(e) = sent {
            bridge.pending.lock().unwrap().remove(&id);
            return Err(e.to_string());
        }

        let payload = match tokio::time::timeout(REPLY_TIMEOUT, reply).await {
            Ok(Ok(payload)) => payload,
            _ => {
                bridge.pending.lock().unwrap().remove(&id);
                return Err("the page did not answer — it may be loading".to_string());
            }
        };
        let outcome: Value = serde_json::from_str(&payload).map_err(|e| format!("unreadable answer from the page: {e}"))?;
        match outcome.get("bridgeError").and_then(Value::as_str) {
            None => return Ok(outcome),
            Some("parse") => continue,
            Some(_) => return Err("the page has not loaded the dev bridge yet".to_string()),
        }
    }
    Ok(json!({ "exceptionDetails": {
        "text": "Uncaught",
        "exception": { "description": "SyntaxError: the script could not be parsed" },
    } }))
}

mod screenshot {
    use serde_json::Value;
    use tauri::WebviewWindow;

    /// The part of the page to capture, in CSS pixels, and the factor to
    /// scale it by.
    #[derive(Clone, Copy)]
    pub struct Clip {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
        pub scale: f64,
    }

    impl Clip {
        pub fn from(params: &Value) -> Option<Self> {
            let clip = params.get("clip")?;
            let number = |key: &str| clip.get(key).and_then(Value::as_f64);
            Some(Self {
                x: number("x")?,
                y: number("y")?,
                width: number("width")?,
                height: number("height")?,
                scale: number("scale").unwrap_or(1.0),
            })
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn capture(_window: &WebviewWindow, _clip: Option<Clip>) -> Result<Vec<u8>, String> {
        Err("screenshots through the dev bridge are only implemented on macOS".to_string())
    }

    #[cfg(target_os = "macos")]
    pub async fn capture(window: &WebviewWindow, clip: Option<Clip>) -> Result<Vec<u8>, String> {
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::{MainThreadMarker, NSData, NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize, NSString};
        use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
        use tokio::sync::oneshot;

        // NSBitmapImageFileTypePNG
        const PNG: usize = 4;

        let (done_tx, done) = oneshot::channel::<Result<Vec<u8>, String>>();
        let done_tx = Arc::new(Mutex::new(Some(done_tx)));

        window
            .with_webview(move |webview| {
                let webview: &WKWebView = unsafe { &*(webview.inner() as *const WKWebView) };
                let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
                let config = unsafe { WKSnapshotConfiguration::new(mtm) };
                if let Some(clip) = clip {
                    let rect = NSRect::new(NSPoint::new(clip.x, clip.y), NSSize::new(clip.width, clip.height));
                    let width = NSNumber::new_f64(clip.width * clip.scale);
                    unsafe {
                        let _: () = msg_send![&*config, setRect: rect];
                        let _: () = msg_send![&*config, setSnapshotWidth: &*width];
                    }
                }

                // The handler receives an NSImage; PNG data comes out of it by
                // way of its bitmap representation.
                let handler = block2::RcBlock::new(move |image: *mut AnyObject, error: *mut NSError| {
                    let result = (|| -> Result<Vec<u8>, String> {
                        if !error.is_null() {
                            let description: Option<Retained<NSString>> = unsafe { msg_send![&*error, localizedDescription] };
                            return Err(description.map(|s| s.to_string()).unwrap_or_else(|| "unknown error".to_string()));
                        }
                        if image.is_null() {
                            return Err("the webview returned no image".to_string());
                        }
                        unsafe {
                            let tiff: Option<Retained<NSData>> = msg_send![&*image, TIFFRepresentation];
                            let tiff = tiff.ok_or("the image has no bitmap data")?;
                            let bitmap: Option<Retained<AnyObject>> =
                                msg_send![class!(NSBitmapImageRep), imageRepWithData: &*tiff];
                            let bitmap = bitmap.ok_or("the image could not be read as a bitmap")?;
                            let properties = NSDictionary::<NSString, AnyObject>::new();
                            let png: Option<Retained<NSData>> =
                                msg_send![&*bitmap, representationUsingType: PNG, properties: &*properties];
                            let png = png.ok_or("the image could not be encoded as PNG")?;
                            let bytes: *const u8 = msg_send![&*png, bytes];
                            let length: usize = msg_send![&*png, length];
                            Ok(std::slice::from_raw_parts(bytes, length).to_vec())
                        }
                    })();
                    if let Some(done_tx) = done_tx.lock().unwrap().take() {
                        let _ = done_tx.send(result);
                    }
                });
                unsafe {
                    let _: () = msg_send![webview, takeSnapshotWithConfiguration: &*config, completionHandler: &*handler];
                }
            })
            .map_err(|e| format!("with_webview: {e}"))?;

        tokio::time::timeout(Duration::from_secs(15), done)
            .await
            .map_err(|_| "the webview did not deliver a screenshot in time".to_string())?
            .map_err(|_| "the screenshot was abandoned".to_string())?
            .map_err(|e| format!("screenshot failed: {e}"))
    }
}

/// What only the platform can do: real mouse events for the webview, and the
/// app's native dialogs.
#[cfg(not(target_os = "macos"))]
mod native {
    use serde_json::Value;
    use tauri::WebviewWindow;

    pub async fn mouse(_window: &WebviewWindow, _params: &Value) -> Result<bool, String> {
        Ok(false)
    }

    /// Putting a window out of sight is worked out for macOS only.
    pub fn hide(_window: &tauri::Window) {}
    pub fn remember_front_app() {}
    pub fn give_focus_back() {}
    pub fn show(_window: &tauri::WebviewWindow, _visible: bool) {}
    pub fn shown() -> bool {
        true
    }

    pub async fn list_dialogs() -> Result<Vec<Value>, String> {
        Ok(Vec::new())
    }

    pub async fn answer_dialog(_params: &Value) -> Result<Value, String> {
        Err("a dialog the app opens from its Rust side can be driven through the dev bridge on macOS only".to_string())
    }
}

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::c_void;
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect, NSString};
    use serde_json::{json, Value};
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;

    // NSEventType
    const LEFT_MOUSE_DOWN: usize = 1;
    const LEFT_MOUSE_UP: usize = 2;
    const MOUSE_MOVED: usize = 5;
    const LEFT_MOUSE_DRAGGED: usize = 6;

    /// Hands the webview a mouse event of the kind AppKit itself would, so the
    /// page sees a trusted event and hover states follow. Returns `false` for
    /// what stays with the page: the right and middle buttons, whose native
    /// handling may open a menu that holds the main thread until it is closed.
    pub async fn mouse(window: &WebviewWindow, params: &Value) -> Result<bool, String> {
        let text = |key: &str| params.get(key).and_then(Value::as_str).unwrap_or("");
        // A move with the left button held is a drag, which is what selects
        // text or moves what was grabbed; DevTools says so in `buttons`.
        let left_held = params.get("buttons").and_then(Value::as_u64).unwrap_or(0) & 1 == 1;
        let kind = match (text("type"), text("button")) {
            ("mouseMoved", _) if left_held => LEFT_MOUSE_DRAGGED,
            ("mouseMoved", _) => MOUSE_MOVED,
            ("mousePressed", "left") => LEFT_MOUSE_DOWN,
            ("mouseReleased", "left") => LEFT_MOUSE_UP,
            _ => return Ok(false),
        };
        let x = params.get("x").and_then(Value::as_f64).unwrap_or(0.0);
        let y = params.get("y").and_then(Value::as_f64).unwrap_or(0.0);
        let clicks = params.get("clickCount").and_then(Value::as_i64).unwrap_or(0) as isize;

        let (done_tx, done) = oneshot::channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                let view = unsafe { &*(webview.inner() as *const AnyObject) };
                let _ = done_tx.send(unsafe { send_mouse(view, kind, x, y, clicks) });
            })
            .map_err(|e| format!("with_webview: {e}"))?;
        done.await.map_err(|_| "the mouse event was abandoned".to_string())??;
        Ok(true)
    }

    // NSWindowCollectionBehavior: transient | stationary | ignoresCycle
    const OUT_OF_THE_WAY: usize = (1 << 3) | (1 << 4) | (1 << 6);

    /// Makes a window invisible where it stands, instead of hiding it or
    /// moving it off the screen: WebKit stops rendering a page whose window
    /// is not on screen, and a snapshot of it would be stale. Fully
    /// transparent, it lets every click through to what is behind it and
    /// stays out of Mission Control and the window cycle; the bridge hands
    /// its own mouse events to the view directly, so those still arrive.
    pub fn hide(window: &tauri::Window) {
        if let Ok(ns_window) = window.ns_window() {
            let ns_window = ns_window as usize;
            let _ = window.run_on_main_thread(move || unsafe { put_away(ns_window) });
        }
    }

    /// Whether the user asked to see the instance, through the bridge.
    static SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn shown() -> bool {
        SHOWN.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Brings an instance that is out of sight in front of the user, or puts
    /// it away again. It still has no Dock icon either way.
    pub fn show(window: &WebviewWindow, visible: bool) {
        let Ok(ns_window) = window.ns_window() else { return };
        let ns_window = ns_window as usize;
        SHOWN.store(visible, std::sync::atomic::Ordering::Relaxed);
        let _ = window.run_on_main_thread(move || unsafe {
            if !visible {
                put_away(ns_window);
                give_focus_back();
                return;
            }
            // Whoever is in front now gets the keyboard back when it is put away.
            remember_front_app();
            let window = &*(ns_window as *const AnyObject);
            let _: () = msg_send![window, setAlphaValue: 1.0f64];
            let _: () = msg_send![window, setIgnoresMouseEvents: false];
            let _: () = msg_send![window, setHasShadow: true];
            let _: () = msg_send![window, setCollectionBehavior: 0usize];
            let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![&*app, activateIgnoringOtherApps: true];
            let _: () = msg_send![window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
            // macOS may not let a background app activate itself; the window
            // comes to the front all the same.
            let _: () = msg_send![window, orderFrontRegardless];
        });
    }

    unsafe fn put_away(ns_window: usize) {
        let ns_window = &*(ns_window as *const AnyObject);
        let _: () = msg_send![ns_window, setAlphaValue: 0.0f64];
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: true];
        let _: () = msg_send![ns_window, setHasShadow: false];
        let _: () = msg_send![ns_window, setCollectionBehavior: OUT_OF_THE_WAY];
    }

    /// The app that was in front when this one started, as a pid.
    static IN_FRONT_BEFORE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

    /// Called first thing, before AppKit puts this app in front.
    pub fn remember_front_app() {
        unsafe {
            let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
            let front: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
            if let Some(front) = front {
                let pid: i32 = msg_send![&*front, processIdentifier];
                IN_FRONT_BEFORE.store(pid, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// Starting up makes the app the active one. With nothing to see, it
    /// would take the user's typing without their knowing, so the app that
    /// was in front gets the keyboard back. Main thread only.
    pub fn give_focus_back() {
        unsafe {
            let pid = IN_FRONT_BEFORE.load(std::sync::atomic::Ordering::Relaxed);
            let before: Option<Retained<AnyObject>> =
                msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
            let own: i32 = msg_send![&*{ let p: Retained<AnyObject> = msg_send![class!(NSProcessInfo), processInfo]; p }, processIdentifier];
            match before {
                Some(before) if pid != 0 && pid != own => {
                    let _: bool = msg_send![&*before, activateWithOptions: 0usize];
                }
                _ => {
                    let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
                    let _: () = msg_send![&*app, deactivate];
                }
            }
        }
    }

    unsafe fn send_mouse(view: &AnyObject, kind: usize, x: f64, y: f64, clicks: isize) -> Result<(), String> {
        let ns_window: Option<Retained<AnyObject>> = msg_send![view, window];
        let ns_window = ns_window.ok_or("the webview is in no window")?;
        // Page coordinates are CSS pixels from the top left; the view's own
        // are points, scaled by the page zoom, from whichever corner it uses.
        let zoom: f64 = msg_send![view, pageZoom];
        let flipped: bool = msg_send![view, isFlipped];
        let bounds: NSRect = msg_send![view, bounds];
        let in_view = NSPoint::new(x * zoom, if flipped { y * zoom } else { bounds.size.height - y * zoom });
        let in_window: NSPoint = msg_send![view, convertPoint: in_view, toView: std::ptr::null::<AnyObject>()];
        let window_number: isize = msg_send![&*ns_window, windowNumber];
        let process_info: Retained<AnyObject> = msg_send![class!(NSProcessInfo), processInfo];
        let now: f64 = msg_send![&*process_info, systemUptime];
        let event: Option<Retained<AnyObject>> = msg_send![
            class!(NSEvent),
            mouseEventWithType: kind,
            location: in_window,
            modifierFlags: 0usize,
            timestamp: now,
            windowNumber: window_number,
            context: std::ptr::null::<AnyObject>(),
            eventNumber: 0isize,
            clickCount: clicks,
            pressure: if kind == LEFT_MOUSE_DOWN || kind == LEFT_MOUSE_DRAGGED { 1.0f32 } else { 0.0f32 },
        ];
        let event = event.ok_or("AppKit made no event")?;
        // Straight to the view rather than through the window: the instance's
        // window is usually not the active one, and need not be.
        match kind {
            LEFT_MOUSE_DOWN => { let _: () = msg_send![view, mouseDown: &*event]; }
            LEFT_MOUSE_UP => { let _: () = msg_send![view, mouseUp: &*event]; }
            LEFT_MOUSE_DRAGGED => { let _: () = msg_send![view, mouseDragged: &*event]; }
            _ => { let _: () = msg_send![view, mouseMoved: &*event]; }
        }
        Ok(())
    }

    // ── Dialogs ──────────────────────────────────────────────────────────

    const CLOSE_WAIT: Duration = Duration::from_secs(3);

    #[repr(C)]
    struct DispatchQueue {
        _opaque: [u8; 0],
    }

    extern "C" {
        static _dispatch_main_q: DispatchQueue;
        fn dispatch_async_f(queue: *const DispatchQueue, context: *mut c_void, work: extern "C" fn(*mut c_void));
    }

    /// Runs `work` on the main thread through the main dispatch queue. Unlike
    /// the app's own event loop, that queue is still served while a modal
    /// dialog is up — which is exactly when this is needed.
    fn on_main<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> oneshot::Receiver<T> {
        extern "C" fn run(context: *mut c_void) {
            let work = unsafe { Box::from_raw(context as *mut Box<dyn FnOnce() + Send>) };
            work();
        }
        let (done_tx, done) = oneshot::channel();
        let boxed: Box<Box<dyn FnOnce() + Send>> = Box::new(Box::new(move || {
            let _ = done_tx.send(work());
        }));
        unsafe { dispatch_async_f(&_dispatch_main_q, Box::into_raw(boxed) as *mut c_void, run) };
        done
    }

    struct Button {
        label: String,
        default: bool,
        cancels: bool,
        control: Option<Retained<AnyObject>>,
    }

    /// A dialog as found on the main thread. `window` never leaves it.
    struct Dialog {
        window: Retained<AnyObject>,
        number: isize,
        title: String,
        text: String,
        buttons: Vec<Button>,
        file_panel: bool,
    }

    impl Dialog {
        fn describe(&self, index: usize) -> Value {
            let mut out = json!({ "index": index, "title": self.title });
            if !self.text.is_empty() {
                out["text"] = json!(self.text);
            }
            out["buttons"] = json!(self.buttons.iter().map(|b| b.label.clone()).collect::<Vec<_>>());
            if self.file_panel {
                out["file_field"] = json!(true);
            }
            out
        }
    }

    unsafe fn string(value: Option<Retained<NSString>>) -> String {
        value.map(|s| s.to_string()).unwrap_or_default()
    }

    unsafe fn is_kind(object: &AnyObject, class: &objc2::runtime::AnyClass) -> bool {
        msg_send![object, isKindOfClass: class]
    }

    unsafe fn items(array: Option<Retained<AnyObject>>) -> Vec<Retained<AnyObject>> {
        let Some(array) = array else { return Vec::new() };
        let count: usize = msg_send![&*array, count];
        (0..count).filter_map(|i| msg_send![&*array, objectAtIndex: i]).collect()
    }

    /// The labels and push buttons below `view`, in the order they lie there.
    unsafe fn collect(view: &AnyObject, texts: &mut Vec<String>, buttons: &mut Vec<Button>) {
        let hidden: bool = msg_send![view, isHidden];
        if hidden {
            return;
        }
        if is_kind(view, class!(NSButton)) {
            let label = string(msg_send![view, title]);
            let key = string(msg_send![view, keyEquivalent]);
            if !label.is_empty() {
                buttons.push(Button {
                    default: key == "\r",
                    cancels: key == "\u{1b}",
                    label,
                    control: Some(Retained::retain(view as *const AnyObject as *mut AnyObject).unwrap()),
                });
            }
            return;
        }
        if is_kind(view, class!(NSTextField)) {
            let editable: bool = msg_send![view, isEditable];
            let text = string(msg_send![view, stringValue]);
            if !editable && !text.trim().is_empty() {
                texts.push(text.trim().to_string());
            }
            return;
        }
        for child in items(msg_send![view, subviews]) {
            collect(&child, texts, buttons);
        }
    }

    /// Every dialog the app has open, the newest first: file panels, alerts,
    /// and whatever else is a sheet or runs modally.
    unsafe fn open_dialogs() -> Vec<Dialog> {
        let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
        let modal: Option<Retained<AnyObject>> = msg_send![&*app, modalWindow];
        let mut found = Vec::new();
        for window in items(msg_send![&*app, windows]) {
            let visible: bool = msg_send![&*window, isVisible];
            let file_panel = is_kind(&window, class!(NSSavePanel));
            let sheet: bool = msg_send![&*window, isSheet];
            let is_modal = modal.as_ref().is_some_and(|m| Retained::as_ptr(m) == Retained::as_ptr(&window));
            if !visible || !(file_panel || sheet || is_modal) {
                continue;
            }
            let mut texts = Vec::new();
            let mut buttons = Vec::new();
            if file_panel {
                // The panel's contents are drawn by a system service and not
                // to be found among its views; its own properties say the same.
                let message = string(msg_send![&*window, message]);
                if !message.is_empty() {
                    texts.push(message);
                }
                let directory: Option<Retained<AnyObject>> = msg_send![&*window, directoryURL];
                if let Some(directory) = directory {
                    texts.push(format!("in {}", string(msg_send![&*directory, path])));
                }
                let name = string(msg_send![&*window, nameFieldStringValue]);
                if !name.is_empty() {
                    texts.push(format!("name: {name}"));
                }
                buttons.push(Button { label: string(msg_send![&*window, prompt]), default: true, cancels: false, control: None });
                buttons.push(Button { label: "Cancel".to_string(), default: false, cancels: true, control: None });
            } else {
                let content: Option<Retained<AnyObject>> = msg_send![&*window, contentView];
                if let Some(content) = content {
                    collect(&content, &mut texts, &mut buttons);
                }
            }
            found.push(Dialog {
                number: msg_send![&*window, windowNumber],
                title: string(msg_send![&*window, title]),
                text: texts.join("\n"),
                buttons,
                file_panel,
                window,
            });
        }
        found.reverse();
        found
    }

    unsafe fn respond(dialog: &Dialog, action: &str, button: Option<&str>) -> Result<String, String> {
        let labels = || dialog.buttons.iter().map(|b| b.label.as_str()).collect::<Vec<_>>().join(", ");
        let chosen = match action {
            "click" => {
                let wanted = button.ok_or("action 'click' needs the button's label")?.trim().to_lowercase();
                dialog
                    .buttons
                    .iter()
                    .find(|b| b.label.to_lowercase() == wanted)
                    .or_else(|| dialog.buttons.iter().find(|b| b.label.to_lowercase().starts_with(&wanted)))
                    .ok_or_else(|| format!("no button {wanted:?} - this dialog has: {}", labels()))?
            }
            "accept" => dialog.buttons.iter().find(|b| b.default).ok_or_else(|| {
                format!("cannot tell which button accepts - use action 'click' with one of: {}", labels())
            })?,
            "cancel" => match dialog.buttons.iter().find(|b| b.cancels) {
                Some(button) => button,
                None => {
                    let _: () = msg_send![&*dialog.window, performClose: std::ptr::null::<AnyObject>()];
                    return Ok("(closed)".to_string());
                }
            },
            other => return Err(format!("unknown action {other:?} - list, accept, cancel or click")),
        };
        match &chosen.control {
            Some(control) => { let _: () = msg_send![&**control, performClick: std::ptr::null::<AnyObject>()]; }
            None if chosen.cancels => { let _: () = msg_send![&*dialog.window, cancel: std::ptr::null::<AnyObject>()]; }
            None => confirm_panel(&dialog.window)?,
        }
        Ok(chosen.label.clone())
    }

    // NSModalResponseOK
    const RESPONSE_OK: isize = 1;

    /// Ends a file panel as its default button would. `-[NSSavePanel ok:]`
    /// raises on current macOS, and the button itself is drawn by a system
    /// service and out of reach, so the session the panel runs in is ended
    /// with the answer that button gives.
    unsafe fn confirm_panel(panel: &AnyObject) -> Result<(), String> {
        let parent: Option<Retained<AnyObject>> = msg_send![panel, sheetParent];
        if let Some(parent) = parent {
            let _: () = msg_send![&*parent, endSheet: panel, returnCode: RESPONSE_OK];
            return Ok(());
        }
        let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
        let modal: Option<Retained<AnyObject>> = msg_send![&*app, modalWindow];
        if modal.is_some_and(|m| std::ptr::eq(Retained::as_ptr(&m), panel)) {
            let _: () = msg_send![&*app, stopModalWithCode: RESPONSE_OK];
            return Ok(());
        }
        Err("this file dialog is neither a sheet nor modal, and cannot be confirmed from outside".to_string())
    }

    async fn listed() -> Result<Vec<(isize, Value)>, String> {
        on_main(|| unsafe { open_dialogs().iter().enumerate().map(|(i, d)| (d.number, d.describe(i))).collect() })
            .await
            .map_err(|_| "the main thread did not answer".to_string())
    }

    pub async fn list_dialogs() -> Result<Vec<Value>, String> {
        Ok(listed().await?.into_iter().map(|(_, dialog)| dialog).collect())
    }

    pub async fn answer_dialog(params: &Value) -> Result<Value, String> {
        let action = params.get("action").and_then(Value::as_str).unwrap_or("").to_string();
        let index = params.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let button = params.get("button").and_then(Value::as_str).map(str::to_owned);
        if params.get("path").is_some_and(|path| !path.is_null()) {
            // AppKit keeps a file panel's answer in the system service that
            // draws it; `-[NSSavePanel setURL:]` raises.
            return Err("this dialog was opened by the app's Rust side, and macOS lets nothing outside it \
                        choose its path - cancel it, or accept the location it shows"
                .to_string());
        }

        let (number, pressed) = on_main(move || unsafe {
            let found = open_dialogs();
            if found.is_empty() {
                return Err("no native dialog is open for this instance".to_string());
            }
            let dialog = found.get(index).ok_or_else(|| format!("no dialog {index} - {} open", found.len()))?;
            Ok::<_, String>((dialog.number, respond(dialog, &action, button.as_deref())?))
        })
        .await
        .map_err(|_| "the main thread did not answer".to_string())??;

        // A dialog that stays is not necessarily a failure: one asking a
        // follow-up question shows up among the dialogs still open.
        let deadline = tokio::time::Instant::now() + CLOSE_WAIT;
        loop {
            let closed = !listed().await?.iter().any(|(n, _)| *n == number);
            if closed || tokio::time::Instant::now() >= deadline {
                return Ok(json!({ "pressed": pressed, "closed": closed }));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}
