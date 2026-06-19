use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

// ── PDF export state ──────────────────────────────────────────────────────────

static EXPORT_HTML: Mutex<String> = Mutex::new(String::new());

// ── helpers ──────────────────────────────────────────────────────────────────

fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn images_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png"     => "png",
        "image/jpeg"    => "jpg",
        "image/gif"     => "gif",
        "image/webp"    => "webp",
        "image/svg+xml" => "svg",
        _               => "png",
    }
}

fn ext_for_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase()
}

fn resolve_allowed_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();

    let mut push_root = |root: Result<PathBuf, _>| {
        if let Ok(path) = root {
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            roots.push(canonical);
        }
    };

    push_root(app.path().home_dir());
    push_root(app.path().document_dir());
    push_root(app.path().download_dir());
    push_root(app.path().desktop_dir());
    push_root(app.path().app_data_dir());
    push_root(app.path().app_config_dir());

    if roots.is_empty() {
        return Err("no allowed storage roots available".to_string());
    }

    Ok(roots)
}

fn is_within_allowed_roots(path: &Path, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots.iter().any(|root| path.starts_with(root))
}

// ── commands ──────────────────────────────────────────────────────────────────

/// Saves a base64 data-URL image.
/// Uses SHA-256 of the raw bytes as filename → identical images share one file.
#[tauri::command]
fn save_image(app: tauri::AppHandle, data_url: String) -> Result<String, String> {
    let (mime_part, b64) = data_url
        .strip_prefix("data:")
        .and_then(|s| s.split_once(','))
        .ok_or("Invalid data URL")?;

    let ext = ext_for_mime(mime_part.split(';').next().unwrap_or(""));
    let bytes = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let path = images_dir(&app)?.join(format!("{}.{}", sha256_hex(&bytes), ext));

    if !path.exists() {
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Copies a file from an arbitrary location into the images dir.
/// Same deduplication as save_image: SHA-256 of content → skip if already exists.
/// Only image file extensions are accepted.
#[tauri::command]
fn copy_image_file(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let ext = ext_for_path(&source);
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") {
        return Err("unsupported file type".to_string());
    }

    let allowed_roots = resolve_allowed_roots(&app)?;
    let source_path = PathBuf::from(&source);
    let metadata = std::fs::symlink_metadata(&source_path).map_err(|_| "file not found".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("access denied: symlink targets are not allowed".to_string());
    }
    let canonical_source = std::fs::canonicalize(&source_path).map_err(|_| "unable to resolve path".to_string())?;
    if !is_within_allowed_roots(&canonical_source, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    let bytes = std::fs::read(&canonical_source).map_err(|e| format!("read {source}: {e}"))?;
    let path = images_dir(&app)?.join(format!("{}.{}", sha256_hex(&bytes), ext));

    if !path.exists() {
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Reads a local image file and returns it as a base64 data-URL for display.
/// Path must resolve to within the app images directory.
#[tauri::command]
fn read_image_as_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let allowed_dir = std::fs::canonicalize(images_dir(&app)?)
        .map_err(|e| e.to_string())?;
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("file not found".to_string());
    }
    let canon = std::fs::canonicalize(&path_buf)
        .map_err(|_| "invalid path".to_string())?;
    if !canon.starts_with(&allowed_dir) {
        return Err("access denied: path outside images directory".to_string());
    }
    let bytes = std::fs::read(&canon).map_err(|e| format!("read: {e}"))?;
    let mime = match ext_for_path(&path).as_str() {
        "png"  => "image/png",
        "jpg"  => "image/jpeg",
        "gif"  => "image/gif",
        "webp" => "image/webp",
        "svg"  => "image/svg+xml",
        _      => "image/png",
    };
    Ok(format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes)))
}

/// Writes text content to a user-selected file path.
/// Only .md, .emerald, .emeralddb, .json, and .txt extensions are permitted.
#[tauri::command]
fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let ext = ext_for_path(&path);
    if !matches!(ext.as_str(), "md" | "emerald" | "emeralddb" | "json" | "txt") {
        return Err("unsupported file type".to_string());
    }

    let allowed_roots = resolve_allowed_roots(&app)?;
    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .ok_or("invalid path")?;

    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical_parent, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    if target.exists() {
        let metadata = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("access denied: symlink targets are not allowed".to_string());
        }
        let canonical_target = std::fs::canonicalize(&target).map_err(|_| "invalid path".to_string())?;
        if !is_within_allowed_roots(&canonical_target, &allowed_roots) {
            return Err("access denied: path outside allowed directories".to_string());
        }
        return std::fs::write(canonical_target, content.as_bytes()).map_err(|e| e.to_string());
    }

    let filename = target.file_name().ok_or("invalid path")?;
    let canonical_target = canonical_parent.join(filename);
    std::fs::write(canonical_target, content.as_bytes()).map_err(|e| e.to_string())
}

/// Exports a base64 data-URL image to a user-chosen path on disk.
/// Only .png, .jpg, .jpeg, and .webp extensions are permitted.
/// Path must resolve to within the allowed user directories.
#[tauri::command]
fn export_image(app: tauri::AppHandle, path: String, data_url: String) -> Result<(), String> {
    let ext = ext_for_path(&path);
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("unsupported file type".to_string());
    }

    let (_mime_part, b64) = data_url
        .strip_prefix("data:")
        .and_then(|s| s.split_once(','))
        .ok_or("Invalid data URL")?;
    let bytes = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;

    let final_bytes = bytes;

    let allowed_roots = resolve_allowed_roots(&app)?;
    let target = PathBuf::from(&path);
    let parent = target.parent().ok_or("invalid path")?;

    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical_parent, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    if target.exists() {
        let metadata = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("access denied: symlink targets are not allowed".to_string());
        }
        let canonical_target = std::fs::canonicalize(&target).map_err(|_| "invalid path".to_string())?;
        if !is_within_allowed_roots(&canonical_target, &allowed_roots) {
            return Err("access denied: path outside allowed directories".to_string());
        }
        return std::fs::write(canonical_target, &final_bytes).map_err(|e| e.to_string());
    }

    let filename = target.file_name().ok_or("invalid path")?;
    let canonical_target = canonical_parent.join(filename);
    std::fs::write(canonical_target, &final_bytes).map_err(|e| e.to_string())
}

/// Reads a text file and returns its contents as a UTF-8 string.
/// Only .md, .emerald, .emeralddb, .json, and .txt extensions are permitted.
#[tauri::command]
fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let ext = ext_for_path(&path);
    if !matches!(ext.as_str(), "md" | "emerald" | "emeralddb" | "json" | "txt") {
        return Err("unsupported file type".to_string());
    }

    let allowed_roots = resolve_allowed_roots(&app)?;
    let canonical = std::fs::canonicalize(&path).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    std::fs::read_to_string(canonical).map_err(|e| e.to_string())
}

/// Ensures platform-specific app storage directories exist before frontend
/// code writes vault metadata or opens SQLite databases.
#[tauri::command]
fn ensure_app_storage_dirs(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;

    let app_config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;

    Ok(())
}

/// Triggers the system print dialog on the pdf-export window.
#[tauri::command]
fn trigger_print(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("pdf-export") {
        w.print().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Opens a new window that renders the given HTML and immediately triggers
/// the system print dialog — on macOS the user can "Save as PDF" there.
#[tauri::command]
fn open_pdf_export(app: tauri::AppHandle, html: String) -> Result<(), String> {
    *EXPORT_HTML.lock().map_err(|e| e.to_string())? = html;

    // Close any leftover export window
    if let Some(w) = app.get_webview_window("pdf-export") {
        w.close().ok();
    }

    let url = url::Url::parse("export-html://localhost/")
        .map_err(|e| e.to_string())?;

    tauri::WebviewWindowBuilder::new(&app, "pdf-export", tauri::WebviewUrl::CustomProtocol(url))
        .title("Export as PDF")
        .inner_size(816.0, 1100.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Deletes image files in the images dir that are not in `used_paths`
/// AND are older than `min_age_secs` (default 300 s = 5 min).
/// The age guard prevents deleting files that were just saved but whose
/// owning entry hasn't been persisted yet.
#[tauri::command]
fn cleanup_unused_images(
    app: tauri::AppHandle,
    used_paths: Vec<String>,
    min_age_secs: Option<u64>,
) -> Result<u32, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");

    if !dir.exists() {
        return Ok(0);
    }

    let used: std::collections::HashSet<String> = used_paths.into_iter().collect();
    let min_age = std::time::Duration::from_secs(min_age_secs.unwrap_or(300));
    let mut deleted = 0u32;

    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let path_str = path.to_string_lossy().into_owned();
        if used.contains(&path_str) {
            continue;
        }
        // Only delete files older than min_age to avoid races with unsaved entries
        let old_enough = path
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|age| age >= min_age)
            .unwrap_or(false);

        if old_enough {
            if std::fs::remove_file(&path).is_ok() {
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ── macOS mouse back/forward button support ───────────────────────────────────

#[cfg(target_os = "macos")]
fn install_mouse_nav_monitor(app_handle: tauri::AppHandle) {
    use block::ConcreteBlock;
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;

    unsafe {
        let block = ConcreteBlock::new(move |event: *mut Object| -> *mut Object {
            let event_type: u64 = msg_send![event, type];
            match event_type {
                // NSEventTypeSwipe (31) — drivers like Logitech Options+ convert
                // side buttons to swipe gestures; deltaX arrives at PhaseEnded (8)
                31 => {
                    let phase: u32 = msg_send![event, phase];
                    if phase == 8 {
                        let delta_x: f64 = msg_send![event, deltaX];
                        if delta_x > 0.0 { app_handle.emit("navigate-back", ()).ok(); }
                        else if delta_x < 0.0 { app_handle.emit("navigate-forward", ()).ok(); }
                    }
                }
                // NSEventTypeOtherMouseDown (25) — standard mice send raw button events
                // buttonNumber 3 = back, 4 = forward
                25 => {
                    let button: i64 = msg_send![event, buttonNumber];
                    if button == 3 { app_handle.emit("navigate-back", ()).ok(); }
                    else if button == 4 { app_handle.emit("navigate-forward", ()).ok(); }
                }
                _ => {}
            }
            event
        });
        let block = block.copy();
        // NSEventMaskSwipe (1<<31) | NSEventMaskOtherMouseDown (1<<25)
        let mask: u64 = (1 << 31) | (1 << 25);
        let monitor: *mut Object = msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: mask
            handler: &*block
        ];
        // Retain the monitor manually — the returned object is autoreleased,
        // so without an explicit retain it is released at the next run-loop
        // drain and the monitor silently stops working.
        if !monitor.is_null() {
            let _: () = msg_send![monitor, retain];
        }
        // block can be dropped here; the monitor already copied/retained it.
    }
}

#[tauri::command]
fn update_menu_labels(
    app: tauri::AppHandle,
    edit: String,
    view: String,
    export: String,
    import: String,
    reset_view: String,
    export_pdf: String,
    export_markdown: String,
    export_emerald: String,
    import_markdown: String,
    import_emerald: String,
) {
    use tauri::menu::MenuItemKind;
    let Some(menu) = app.menu() else { return };

    // Update top-level submenus by ID
    for kind in menu.items().unwrap_or_default() {
        if let MenuItemKind::Submenu(sub) = &kind {
            let id = sub.id().0.as_str().to_owned();
            let new_text = match id.as_str() {
                "edit-submenu"   => Some(edit.as_str()),
                "view-submenu"   => Some(view.as_str()),
                "export-submenu" => Some(export.as_str()),
                "import-submenu" => Some(import.as_str()),
                _ => None,
            };
            if let Some(text) = new_text {
                sub.set_text(text).ok();
            }
            // Update items inside this submenu
            for child in sub.items().unwrap_or_default() {
                if let MenuItemKind::MenuItem(item) = &child {
                    let child_id = item.id().0.as_str().to_owned();
                    let new_child_text = match child_id.as_str() {
                        "reset-sidebar-widths" => Some(reset_view.as_str()),
                        "export-pdf"           => Some(export_pdf.as_str()),
                        "export-markdown"      => Some(export_markdown.as_str()),
                        "export-emerald"       => Some(export_emerald.as_str()),
                        "import-markdown"      => Some(import_markdown.as_str()),
                        "import-emerald"       => Some(import_emerald.as_str()),
                        _ => None,
                    };
                    if let Some(text) = new_child_text {
                        item.set_text(text).ok();
                    }
                }
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("export-html", |_app, _request| {
            let html = EXPORT_HTML.lock().unwrap().clone();
            tauri::http::Response::builder()
                .status(200)
                .header("content-type", "text/html; charset=utf-8")
                .body(html.into_bytes())
                .unwrap()
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_image,
            copy_image_file,
            read_image_as_base64,
            cleanup_unused_images,
            export_image,
            write_file,
            read_file,
            ensure_app_storage_dirs,
            open_pdf_export,
            trigger_print,
            update_menu_labels,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            install_mouse_nav_monitor(app.handle().clone());

            #[cfg(target_os = "macos")]
            let app_submenu = Submenu::with_items(app, "Emerald", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;
            #[cfg(not(target_os = "macos"))]
            let app_submenu = Submenu::with_items(app, "Emerald", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;
            let edit_submenu = Submenu::with_id_and_items(app, "edit-submenu", "Edit", true, &[
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])?;
            let reset_item = MenuItem::with_id(
                app,
                "reset-sidebar-widths",
                "Reset View",
                true,
                None::<&str>,
            )?;
            let view_submenu = Submenu::with_id_and_items(app, "view-submenu", "View", true, &[&reset_item])?;
            let export_pdf_item = MenuItem::with_id(
                app,
                "export-pdf",
                "Export as PDF…",
                true,
                None::<&str>,
            )?;
            let export_md_item = MenuItem::with_id(
                app,
                "export-markdown",
                "Export as Markdown…",
                true,
                None::<&str>,
            )?;
            let export_emerald_item = MenuItem::with_id(
                app,
                "export-emerald",
                "Export as Emerald…",
                true,
                None::<&str>,
            )?;
            let export_submenu = Submenu::with_id_and_items(
                app,
                "export-submenu",
                "Export",
                true,
                &[&export_pdf_item, &export_md_item, &export_emerald_item],
            )?;
            let import_md_item = MenuItem::with_id(
                app,
                "import-markdown",
                "From Markdown…",
                true,
                None::<&str>,
            )?;
            let import_emerald_item = MenuItem::with_id(
                app,
                "import-emerald",
                "From Emerald…",
                true,
                None::<&str>,
            )?;
            let import_submenu = Submenu::with_id_and_items(
                app,
                "import-submenu",
                "Import",
                true,
                &[&import_md_item, &import_emerald_item],
            )?;
            let menu = Menu::with_items(app, &[&app_submenu, &edit_submenu, &view_submenu, &export_submenu, &import_submenu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "reset-sidebar-widths" => { app.emit("reset-sidebar-widths", ()).ok(); }
                    "export-pdf"           => { app.emit("export-pdf", ()).ok(); }
                    "export-markdown"      => { app.emit("export-markdown", ()).ok(); }
                    "export-emerald"       => { app.emit("export-emerald", ()).ok(); }
                    "import-markdown"      => { app.emit("import-markdown", ()).ok(); }
                    "import-emerald"       => { app.emit("import-emerald", ()).ok(); }
                    _ => {}
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
