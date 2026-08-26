use base64::{engine::general_purpose, Engine as _};
use std::path::{Path, PathBuf};
use tauri::Manager;
// Every `emit` call site (the native menu's events and the mouse-navigation
// monitor) is macOS-only, so the trait is too.
#[cfg(target_os = "macos")]
use tauri::Emitter;
#[cfg(target_os = "macos")]
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

/// Native-webview PDF export. Each platform owns its own implementation
/// in `pdf_export/{windows,macos,linux}.rs`, all behind the same
/// `pub async fn export_pdf` signature; `mod.rs` does the
/// per-`#[cfg(target_os)]` re-export.
///
/// See `tmp/pdf-export-native-webview.md` for the design history (the
/// plan that replaced the old bundled `wkhtmltopdf.exe` subprocess with
/// driving the app's own webview).
mod pdf_export;

/// Content-addressed image storage plus the `emerald-img` URI scheme that
/// serves it to the webview.
mod images;
/// Vault directories and the id → path registry every storage command
/// resolves against.
mod vault;

// ── helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn ext_for_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase()
}

/// The directories file access is confined to.
///
/// Deliberately *not* extended by the registered vault directories, even
/// though a vault may live outside all of them. The registry is filled by
/// `register_vaults`, an ordinary command the frontend calls — so a frontend
/// that could add its own roots would be handing itself the very boundary that
/// exists to contain it. The folder-dialog guarantee lives in TypeScript and
/// cannot be checked from here.
///
/// Vault storage does not need it: `vault_dir()` resolves an id against the
/// registry and never consults these roots. What stays out of reach is writing
/// or reading a *document* — a backup file, a Markdown export — inside a vault
/// folder that sits outside the user directories. That is the intended trade.
pub(crate) fn resolve_allowed_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    // Cache gegen die sechs canonicalize-Syscalls pro Aufruf (jeder
    // Datei-Command laeuft hier durch, `copy_image_file` einmal pro Bild).
    // Gecacht wird NUR ein vollstaendig kanonisiertes Ergebnis: ein Root, bei
    // dem canonicalize scheiterte (Verzeichnis existiert noch nicht, ein
    // Windows-Known-Folder liegt auf einem gerade nicht verbundenen
    // Netzlaufwerk), faellt auf den rohen Pfad zurueck — und der matcht auf
    // Windows nie gegen kanonisierte Zielpfade mit Verbatim-Praefix.
    // Eingefroren waere das ein permanentes "access denied" bis zum Neustart;
    // ungecacht heilt es sich beim naechsten Aufruf.
    static ALLOWED_ROOTS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();

    if let Some(cached) = ALLOWED_ROOTS.get() {
        return Ok(cached.clone());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    let mut all_canonical = true;

    let mut push_root = |root: Result<PathBuf, _>| {
        if let Ok(path) = root {
            match std::fs::canonicalize(&path) {
                Ok(canonical) => roots.push(canonical),
                Err(_) => {
                    all_canonical = false;
                    roots.push(path);
                }
            }
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

    if all_canonical {
        Ok(ALLOWED_ROOTS.get_or_init(|| roots).clone())
    } else {
        Ok(roots)
    }
}

pub(crate) fn is_within_allowed_roots(path: &Path, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots.iter().any(|root| path.starts_with(root))
}

/// Resolves a user-chosen destination and returns the path that may be written.
///
/// `write_file` and `export_image` ran the same sequence side by side, and the
/// read side had quietly drifted: `read_file` never checked for a symlink while
/// the image reader did. One function per direction is what keeps the two
/// halves of the same boundary from disagreeing again.
///
/// A relative or `..`-laden path has to be resolved before "is it inside an
/// allowed root?" means anything, so everything is canonicalized first. Any
/// symlink at the target is refused — including a dangling one, which is the
/// shape that used to slip past — so a prepared link cannot redirect the write
/// out of the allowed roots.
fn guarded_write_target(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let allowed_roots = resolve_allowed_roots(app)?;
    let target = PathBuf::from(path);
    let parent = target.parent().ok_or("invalid path")?;

    // Der tiefste bereits existierende Vorfahre wird geprueft, *bevor*
    // irgendetwas angelegt wird. Andersherum legte ein abgelehnter Schreibzugriff
    // trotzdem Verzeichnisse ausserhalb der Grenze an.
    let mut existing = parent;
    while !existing.exists() {
        existing = existing.parent().ok_or("invalid path")?;
    }
    let canonical_existing =
        std::fs::canonicalize(existing).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical_existing, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical_parent, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }

    // `symlink_metadata` statt `target.exists()`: `exists()` folgt dem Link und
    // meldet fuer einen *kaputten* Symlink `false`. Der Zweig mit der
    // Symlink-Pruefung wurde damit uebersprungen, und `fs::write` legte die Datei
    // am Linkziel an — ausserhalb der erlaubten Wurzeln.
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("access denied: symlink targets are not allowed".to_string());
            }
            let canonical_target =
                std::fs::canonicalize(&target).map_err(|_| "invalid path".to_string())?;
            if !is_within_allowed_roots(&canonical_target, &allowed_roots) {
                return Err("access denied: path outside allowed directories".to_string());
            }
            Ok(canonical_target)
        }
        Err(_) => {
            let filename = target.file_name().ok_or("invalid path")?;
            Ok(canonical_parent.join(filename))
        }
    }
}

/// The read-side counterpart. Same roots, same symlink rule.
pub(crate) fn guarded_read_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let allowed_roots = resolve_allowed_roots(app)?;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "file not found".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("access denied: symlink targets are not allowed".to_string());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| "invalid path".to_string())?;
    if !is_within_allowed_roots(&canonical, &allowed_roots) {
        return Err("access denied: path outside allowed directories".to_string());
    }
    Ok(canonical)
}

// ── commands ──────────────────────────────────────────────────────────────────
//
// Die Datei-Commands sind `async` und wickeln ihre `std::fs`-Arbeit in
// `spawn_blocking`: eine `.emeralddb` mit eingebetteten Bildern ist
// zweistellige MB gross und blockierte frueher fuer die Dauer das Fenster.
// `async` allein genuegt nicht — ohne `spawn_blocking` laege die blockierende
// Arbeit auf einem Worker der Runtime und koennte auf kleinen Maschinen alle
// Worker belegen (SQL-Plugin, PDF-Export und IPC-Antworten hungern dann).
// Die vier Menue-Commands weiter unten bleiben absichtlich synchron: sie
// mutieren NSMenu, und das ist auf macOS Main-Thread-only.

/// Writes text content to a user-selected file path.
/// Only .md, .emerald, .emeralddb, .json, and .txt extensions are permitted.
#[tauri::command]
async fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = ext_for_path(&path);
        if !matches!(ext.as_str(), "md" | "emerald" | "emeralddb" | "json" | "txt") {
            return Err("unsupported file type".to_string());
        }

        let target = guarded_write_target(&app, &path)?;
        std::fs::write(target, content.as_bytes()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Exports a base64 data-URL image to a user-chosen path on disk.
/// Only .png, .jpg, .jpeg, and .webp extensions are permitted.
/// Path must resolve to within the allowed user directories.
#[tauri::command]
async fn export_image(app: tauri::AppHandle, path: String, data_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = ext_for_path(&path);
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            return Err("unsupported file type".to_string());
        }

        let (_mime_part, b64) = data_url
            .strip_prefix("data:")
            .and_then(|s| s.split_once(','))
            .ok_or("Invalid data URL")?;
        // Rust decodes the payload, so no text encoding or newline handling can
        // alter the bytes that reach disk.
        let bytes = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;

        let target = guarded_write_target(&app, &path)?;
        std::fs::write(target, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads a text file and returns its contents as a UTF-8 string.
/// Only .md, .emerald, .emeralddb, .json, and .txt extensions are permitted.
#[tauri::command]
async fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = ext_for_path(&path);
        if !matches!(ext.as_str(), "md" | "emerald" | "emeralddb" | "json" | "txt") {
            return Err("unsupported file type".to_string());
        }

        std::fs::read_to_string(guarded_read_path(&app, &path)?).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ensures platform-specific app storage directories exist before frontend
/// code writes vault metadata or opens SQLite databases.
#[tauri::command]
async fn ensure_app_storage_dirs(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;

        let app_config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renders the given HTML to a PDF file at `path` by driving the
/// platform's own webview. See `pdf_export::{windows,macos,linux}.rs`
/// for the per-platform implementation; `pdf_export::mod.rs` does the
/// `#[cfg(target_os = "…")]` re-export so this is a one-liner.
///
/// The frontend first prompts the user for a save location via the
/// `dialog` plugin and passes the chosen path here. The pre-migration
/// implementation bundled a `wkhtmltopdf.exe` subprocess (~42 MB, LGPL,
/// 2015-era Qt WebKit, no working macOS build); it was replaced because
/// the app's own WebView2 / WKWebView / WebKitGTK does the same job
/// with smaller install, modern CSS, and native color emoji.
///
/// `page_size`, when present, is `(width_in, height_in)` in inches and
/// overrides the default Letter/Portrait page with a custom size —
/// used by the Altar PDF export so the page matches the altar's own
/// aspect ratio instead of leaving it letterboxed on a portrait page.
#[tauri::command]
async fn export_pdf(app: tauri::AppHandle, html: String, path: String, page_size: Option<(f64, f64)>) -> Result<(), String> {
    pdf_export::export_pdf(&app, html, path, page_size).await
}

/// Builds and installs the native application menu.
///
/// macOS only: there the menu lives in the system menu bar at the top of the
/// screen, where it belongs. On Windows and Linux `set_menu` would attach an
/// in-window menu bar (HMENU / GTK menubar) that would collide with the
/// app's own menu bar in `TitleBar` — those platforms render the same items
/// in HTML instead (`src/components/layout/titlebar/TitleBarMenuBar.tsx`),
/// firing the identical events listed below.
///
/// `set_export_menu_enabled`, `set_altar_export_menu_enabled` and
/// `update_menu_labels` all bail out on `app.menu()` returning `None`, so
/// they become no-ops on the platforms that never get here.
#[cfg(target_os = "macos")]
fn install_native_menu(app: &tauri::App) -> tauri::Result<()> {
    let app_submenu = Submenu::with_items(app, "Emerald", true, &[
        &PredefinedMenuItem::about(app, None, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
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
    // Check items rather than plain ones: the sidebars are a visible-or-not
    // state, and a tick reads better than a label that flips between
    // "Show …" and "Hide …". `set_view_menu_checked` keeps them in sync with
    // the store, which the rail's own toggles can change just as well.
    //
    // Both start ticked because `uiStore`'s `leftListOpen` / `rightSidebarOpen`
    // both default to true. That is a second copy of a frontend default, and
    // what keeps it honest is `AppShell`'s mount-time `set_view_menu_checked`,
    // which corrects it on the first render regardless.
    let toggle_left_item = CheckMenuItem::with_id(
        app,
        "toggle-left-list",
        "Entry List",
        true,
        true,
        None::<&str>,
    )?;
    let toggle_right_item = CheckMenuItem::with_id(
        app,
        "toggle-right-sidebar",
        "Properties",
        true,
        true,
        None::<&str>,
    )?;
    let view_submenu = Submenu::with_id_and_items(app, "view-submenu", "View", true, &[
        &toggle_left_item,
        &toggle_right_item,
        &PredefinedMenuItem::separator(app)?,
        &reset_item,
    ])?;
    // Export items start disabled — the frontend enables them once a
    // journal / wiki / operations entry is actually open (PDF is also
    // enabled while an Altar's reading view is open).
    let export_pdf_item = MenuItem::with_id(
        app,
        "export-pdf",
        "Export as PDF…",
        false,
        None::<&str>,
    )?;
    let export_md_item = MenuItem::with_id(
        app,
        "export-markdown",
        "Export as Markdown…",
        false,
        None::<&str>,
    )?;
    let export_emerald_item = MenuItem::with_id(
        app,
        "export-emerald",
        "Export as Emerald…",
        false,
        None::<&str>,
    )?;
    // Altar image export — starts disabled, the frontend enables it
    // only while an Altar's reading view is open.
    let export_altar_jpeg_item = MenuItem::with_id(
        app,
        "export-altar-jpeg",
        "JPEG…",
        false,
        None::<&str>,
    )?;
    let export_altar_png_item = MenuItem::with_id(
        app,
        "export-altar-png",
        "PNG…",
        false,
        None::<&str>,
    )?;
    let export_altar_webp_item = MenuItem::with_id(
        app,
        "export-altar-webp",
        "WebP…",
        false,
        None::<&str>,
    )?;
    let export_altar_image_submenu = Submenu::with_id_and_items(
        app,
        "export-altar-image",
        "Export as Image",
        false,
        &[&export_altar_jpeg_item, &export_altar_png_item, &export_altar_webp_item],
    )?;
    let export_submenu = Submenu::with_id_and_items(
        app,
        "export-submenu",
        "Export",
        true,
        &[
            &export_pdf_item,
            &export_md_item,
            &export_emerald_item,
            &PredefinedMenuItem::separator(app)?,
            &export_altar_image_submenu,
        ],
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
            "toggle-left-list"     => { app.emit("toggle-left-list", ()).ok(); }
            "toggle-right-sidebar" => { app.emit("toggle-right-sidebar", ()).ok(); }
            "export-pdf"           => { app.emit("export-pdf", ()).ok(); }
            "export-markdown"      => { app.emit("export-markdown", ()).ok(); }
            "export-emerald"       => { app.emit("export-emerald", ()).ok(); }
            "export-altar-jpeg"    => { app.emit("export-altar-jpeg", ()).ok(); }
            "export-altar-png"     => { app.emit("export-altar-png", ()).ok(); }
            "export-altar-webp"    => { app.emit("export-altar-webp", ()).ok(); }
            "import-markdown"      => { app.emit("import-markdown", ()).ok(); }
            "import-emerald"       => { app.emit("import-emerald", ()).ok(); }
            _ => {}
        }
    });
    Ok(())
}

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

/// Toggles the enabled state of the "Export to …" menu items. `entry_enabled`
/// covers Markdown (journal / wiki / operations only); `pdf_enabled` covers
/// PDF, which is also available while an Altar's reading view is open (it
/// exports the rendered altar image instead of entry content in that case);
/// `emerald_enabled` covers the shared Emerald export, also available for an
/// open Altar. Called by the frontend on every view change.
#[tauri::command]
fn set_export_menu_enabled(app: tauri::AppHandle, entry_enabled: bool, pdf_enabled: bool, emerald_enabled: bool) {
    use tauri::menu::MenuItemKind;
    let Some(menu) = app.menu() else { return };

    for kind in menu.items().unwrap_or_default() {
        if let MenuItemKind::Submenu(sub) = &kind {
            if sub.id().0.as_str() != "export-submenu" { continue; }
            for child in sub.items().unwrap_or_default() {
                if let MenuItemKind::MenuItem(item) = &child {
                    match item.id().0.as_str() {
                        "export-pdf" => { item.set_enabled(pdf_enabled).ok(); }
                        "export-markdown" => { item.set_enabled(entry_enabled).ok(); }
                        "export-emerald" => { item.set_enabled(emerald_enabled).ok(); }
                        _ => {}
                    }
                }
            }
        }
    }
}

/// Mirrors the frontend's sidebar visibility onto the View menu's two check
/// items. Called on every change, because the rail's own toggle buttons can
/// flip the same state without the menu ever being opened.
#[tauri::command]
fn set_view_menu_checked(app: tauri::AppHandle, left_list: bool, right_sidebar: bool) {
    use tauri::menu::MenuItemKind;
    let Some(menu) = app.menu() else { return };

    for kind in menu.items().unwrap_or_default() {
        if let MenuItemKind::Submenu(sub) = &kind {
            if sub.id().0.as_str() != "view-submenu" { continue; }
            for child in sub.items().unwrap_or_default() {
                if let MenuItemKind::Check(item) = &child {
                    match item.id().0.as_str() {
                        "toggle-left-list" => { item.set_checked(left_list).ok(); }
                        "toggle-right-sidebar" => { item.set_checked(right_sidebar).ok(); }
                        _ => {}
                    }
                }
            }
        }
    }
}

/// Toggles the enabled state of the "Export as Image" submenu (and its
/// JPEG/PNG/WebP children). Called by the frontend whenever the active
/// view changes, so it's only clickable while an Altar's reading view is open.
#[tauri::command]
fn set_altar_export_menu_enabled(app: tauri::AppHandle, enabled: bool) {
    use tauri::menu::MenuItemKind;
    let Some(menu) = app.menu() else { return };

    for kind in menu.items().unwrap_or_default() {
        if let MenuItemKind::Submenu(sub) = &kind {
            if sub.id().0.as_str() != "export-submenu" { continue; }
            for child in sub.items().unwrap_or_default() {
                if let MenuItemKind::Submenu(image_sub) = &child {
                    if image_sub.id().0.as_str() != "export-altar-image" { continue; }
                    image_sub.set_enabled(enabled).ok();
                    for leaf in image_sub.items().unwrap_or_default() {
                        if let MenuItemKind::MenuItem(item) = &leaf {
                            let leaf_id = item.id().0.as_str();
                            if matches!(leaf_id, "export-altar-jpeg" | "export-altar-png" | "export-altar-webp") {
                                item.set_enabled(enabled).ok();
                            }
                        }
                    }
                }
            }
        }
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
    entry_list: String,
    properties: String,
    export_pdf: String,
    export_markdown: String,
    export_emerald: String,
    export_altar_image: String,
    export_altar_jpeg: String,
    export_altar_png: String,
    export_altar_webp: String,
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
                // The View menu's two toggles are `Check` items, not plain
                // ones — without their own arm they would keep the English
                // labels they were built with.
                if let MenuItemKind::Check(item) = &child {
                    let new_check_text = match item.id().0.as_str() {
                        "toggle-left-list" => Some(entry_list.as_str()),
                        "toggle-right-sidebar" => Some(properties.as_str()),
                        _ => None,
                    };
                    if let Some(text) = new_check_text {
                        item.set_text(text).ok();
                    }
                } else if let MenuItemKind::MenuItem(item) = &child {
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
                } else if let MenuItemKind::Submenu(image_sub) = &child {
                    if image_sub.id().0.as_str() != "export-altar-image" { continue; }
                    image_sub.set_text(export_altar_image.as_str()).ok();
                    for leaf in image_sub.items().unwrap_or_default() {
                        if let MenuItemKind::MenuItem(item) = &leaf {
                            let leaf_id = item.id().0.as_str().to_owned();
                            let new_leaf_text = match leaf_id.as_str() {
                                "export-altar-jpeg" => Some(export_altar_jpeg.as_str()),
                                "export-altar-png"  => Some(export_altar_png.as_str()),
                                "export-altar-webp" => Some(export_altar_webp.as_str()),
                                _ => None,
                            };
                            if let Some(text) = new_leaf_text {
                                item.set_text(text).ok();
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(vault::VaultRegistry::default());

    images::register(builder)
        .invoke_handler(tauri::generate_handler![
            images::save_image,
            images::copy_image_file,
            images::read_image_as_base64,
            images::adopt_legacy_images,
            images::list_image_files,
            images::delete_image_files,
            vault::register_vaults,
            vault::ensure_vault_dirs,
            vault::create_vault_dirs,
            vault::default_vault_dir,
            vault::new_vault_base_dir,
            vault::ensure_backup_dir,
            vault::probe_vault_dir,
            vault::legacy_default_db_exists,
            vault::migrate_vault_layout,
            vault::delete_vault_files,
            export_image,
            write_file,
            read_file,
            ensure_app_storage_dirs,
            export_pdf,
            set_export_menu_enabled,
            set_altar_export_menu_enabled,
            set_view_menu_checked,
            update_menu_labels,
        ])
        .setup(|_app| {
            // Both of these are macOS-only; `_app` keeps the parameter from
            // reading as unused on the platforms where the block is empty.
            #[cfg(target_os = "macos")]
            {
                install_mouse_nav_monitor(_app.handle().clone());
                install_native_menu(_app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
