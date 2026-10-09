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
use std::sync::atomic::{AtomicU64, Ordering};
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
const PAGE_JS: &str = include_str!("devbridge.js");
/// The client gives up on its own, usually sooner; this only keeps an answer
/// that never comes from being waited for indefinitely.
const REPLY_TIMEOUT: Duration = Duration::from_secs(60);
const EVENT_BACKLOG: usize = 256;

pub struct Bridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<String>>>,
    events: broadcast::Sender<String>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            events: broadcast::channel(EVENT_BACKLOG).0,
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

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry, ()>::new("emerald-devbridge")
        .js_init_script(PAGE_JS.to_string())
        .setup(|app, _api| {
            app.manage(Bridge::default());
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
        // Only the move reaches the page. Presses do not: a dispatched press
        // would not be a real one either, and the MCP server, seeing that
        // nothing arrived, falls back to its own way of clicking an element.
        "Input.dispatchMouseEvent" if params.get("type").and_then(Value::as_str) == Some("mouseMoved") => {
            page_call(app, "mouseMoved", params).await
        }
        "Input.dispatchMouseEvent" => Ok(json!({})),
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
