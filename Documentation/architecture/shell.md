# Window, Boot and PDF Export

## Window Chrome

The window's title bar is drawn by the app, not the OS — a slim 40px bar holding the Emerald logo, the application menu, back/forward navigation, a magnifier that opens global search, and the window buttons (`src/components/layout/titlebar/`). It sits above the three-column shell in `AppShell`. The logo is a plain inline SVG (`EmeraldMark`), not a control: it used to be the only route to the dashboard, which now has its own rail button. Its wrapper carries `data-tauri-drag-region` so the corner drags the window again, plus `pointer-events-none` on the mark itself — Tauri reads the drag attribute off the element directly under the cursor, which could otherwise be a `<polygon>` inside the SVG.

**Layout is flex, with fixed-width groups on both ends and empty drag space between them.** The left group (logo, menu button, magnifier, back/forward, and on Windows/Linux the Export/Import buttons) and the right group (window controls) are `flex-shrink-0`; the middle is a plain `flex-1` spacer that only exists as drag surface, not a flexible content column. Every trigger in the bar is an icon-only `RailButton`, so there is nothing to shrink, wrap, or fold as the window narrows — the width-measuring/folding machinery (`SEARCH_MIN_PX`, a `ResizeObserver` on the menu bar, a cached expanded width) that an inline search field and a always-visible menu bar once needed is gone along with them. In the Altar's distraction-free full-window mode (`isAltarFullscreen`) the magnifier, back and forward hide; the menu button and, on Windows/Linux, Export/Import stay, since they're still needed there (see below).

**The application menu is a menu-icon button, not a bar.** `TitleBarMenuButton` (`RailButton` + an in-place `MenuDropdown`, `useOutsideClick` for dismiss) renders once for the app menu — Edit and View as its two submenus, via `useTitleBarMenus.ts` — and once each for Export and Import, which get their own icon (`Download`/`Upload`, matching Settings → Backup) instead of living behind the app-menu icon. Each button opens and closes independently; there is no `role="menubar"` walking between them, since there is no shared bar. `menuActions.ts` still backs the menu content on both this HTML form and the native macOS menu.

**The split is per platform, and deliberately not uniform.** `src/lib/platform.ts` decides at module-eval time (a synchronous user-agent check, so the first paint is already correct) and `main.tsx` mirrors the result onto `html[data-platform]` for CSS. `usesCustomWindowControls` additionally requires `isTauri` (`'__TAURI_INTERNALS__' in window`): opened as a plain page in a browser the window APIs do not exist, and `getCurrentWindow()` would throw during render rather than fail softly like the rest of the desktop-only calls:

| | Windows / Linux | macOS |
|---|---|---|
| Window config | `decorations: false` | `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle` |
| Min / max / close | `WindowControls` (46x40, Fluent geometry) | Native traffic lights, positioned by `trafficLightPosition` |
| Application menu | `TitleBarMenuButton` (HTML, `usesHtmlMenuBar`) | Native, in the system menu bar |
| Title bar left inset | none | 5rem, reserved for the traffic lights |

Per-platform window settings live in `src-tauri/tauri.{windows,linux,macos}.conf.json`, which Tauri merges over `tauri.conf.json`. The merge is RFC 7396, which **replaces arrays wholesale**, so each file repeats the complete window object rather than only its deltas. `tauri.dev.conf.json` merges last (it is passed via `--config`) and must never gain an `app.windows` key, or it would wipe the platform settings. `minWidth` is 720px across all four files (`minHeight` stays 600) — lowered from 900px once the title bar's content became a row of fixed-width icons with nothing left to clip.

In the Altar's distraction-free full-window mode the title bar stays, minus the tabs, the navigation and the magnifier — on Windows and Linux it holds the only way to close or move the window, *and* the only route to the altar's image export, which is usually why that mode was entered. The predicate for that mode is `isAltarFullscreen` in `uiStore`, shared by `AppShell` (which hides the sidebars) and `TitleBar` (which drops the tabs it now holds), so the two cannot drift apart. `TitleBar` also closes the search modal itself the moment the magnifier that opened it would disappear (entering altar fullscreen, or the last vault closing), rather than leaving it stranded open with nothing to reopen it.

Dragging the window uses `data-tauri-drag-region`. Tauri reads the attribute off the element directly under the cursor and does **not** walk up the tree, so every non-interactive wrapper in `TitleBar` carries it and no interactive control does. Double-clicking a drag region maximises; Tauri handles that natively via `internal-toggle-maximize`.

Beyond `core:default`, the window controls need four permissions in `src-tauri/capabilities/default.json`: `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close`. `allow-is-maximized` and `allow-internal-toggle-maximize` are already in the default set. `core:webview:allow-set-webview-zoom` is a fifth, unrelated addition backing the interface-size setting (Settings → General) — see [Vault Settings](storage.md#vault-settings) above and [`security.md`](../security.md).

### Why the native menu is macOS-only

`install_native_menu` in `src-tauri/src/lib.rs` is gated to macOS. On Windows and Linux, `set_menu` attaches an in-window menu bar (an HMENU / a GTK menubar) regardless of `decorations`, which would sit alongside the app's own title-bar menu buttons. The three menu commands (`update_menu_labels`, `set_export_menu_enabled`, `set_altar_export_menu_enabled`) all bail out when `app.menu()` returns `None`, so they become no-ops on those platforms without any frontend branching.

Both forms resolve to the same code. `src/lib/menuActions.ts` owns the action implementations (`runMenuAction`) and the rules for which export items are available (`computeMenuEnabledState`); the native macOS menu reaches them by emitting the event ids listed above, which `AppShell` forwards, while the HTML title-bar buttons call them directly. `View > Reset View` is the one exception: it manipulates `AppShell`'s local sidebar widths, so the HTML menu re-emits `reset-sidebar-widths` rather than calling a function, and `AppShell`'s existing listener answers it on both platforms.

### Closing the window

Closing asks about unsaved edits first (see [Leaving an edit](editing.md#leaving-an-edit)): `AppShell`
registers `onCloseRequested`, runs `settleBeforeExit()`, and prevents the close when the answer
is "keep editing". Before the window goes it waits for the writes still under way
(`drainSerialized`, `flushDrafts`). A window that is minimised is restored and focused before
the question, which would otherwise be asked where nobody sees it — on Linux (X11) only once
the window no longer reports itself as minimised, since tao drops a focus request before that.

A registered handler has a price: Tauri holds back *every* close while a JS listener exists,
so a frontend that hangs or has crashed would leave a window that cannot be closed — and on
Windows and Linux, without system decorations, Alt+F4 and the taskbar run into the same
handler. Two safeguards:

- An error inside the handler is caught and lets the window close.
- `CloseWatch` (`src-tauri/src/lib.rs`): the handler acknowledges every request at once
  through `close_request_seen`. If a request stays unacknowledged, the next one after
  `CLOSE_ANSWER_TIMEOUT` (3 s) destroys the window from Rust, without asking.

What reaches the question, and what does not:

| Way out | Asks |
|---|---|
| Title bar close button, Alt+F4, taskbar or window manager close (Windows, Linux) | yes |
| Red traffic light (macOS) | yes |
| Cmd+Q and "Quit" in the app menu (macOS) | yes — the menu carries its own `quit` item that closes the window instead of `PredefinedMenuItem::quit`, which terminates the app past it. **Untested on real hardware.** |
| Installing an update | yes — `UpdatesPage` asks before it calls `install_update`, which restarts the app without a close request |
| Quit from the Dock, logging out, shutting down, killing the process | no — nothing the app could answer. Entries are covered by the autosave, drafts by `drafts.json` |

Known limit: on Linux under Wayland a minimised window cannot be told to come forward (there
is no minimised state to read, and focus cannot be taken without an activation token), so a
close from the panel while minimised may show the question where it is not seen until the
window is raised by hand. Untested on real hardware.

### Known limitations

- **Windows 11 Snap Layouts.** With `decorations: false` the hover flyout on the maximise button is gone; restoring it needs `WM_NCHITTEST` returning `HTMAXBUTTON` from Rust. `Win+Arrow` and drag-to-edge snapping still work.
- **Paste in the HTML Edit menu** goes through `navigator.clipboard.read()` replayed as a synthetic `ClipboardEvent` (`editCommands.ts`), because `document.execCommand('paste')` is blocked in WebView2 and WKWebView. Going through a real event rather than `insertText` lets ProseMirror apply its own paste handling and keep `text/html` formatting; images are carried as `File` entries on the `DataTransfer` so `RichEditor`'s `handlePaste` still finds them via `getAsFile()`. `Ctrl+V` always works natively regardless.

### Loading Screen and Boot Order

An earlier stage than anything below runs before this: `adopt_previous_identifier_dirs` (see [Adopting a previous identifier's data](storage.md#adopting-a-previous-identifiers-data) under Vault Layout) executes inside `Builder::build()`, before Tauri creates the window this section's markup ever paints into.

The loading screen's markup (`#splash` in `index.html`) and its styles (`public/splash.css`, linked from `<head>`) exist outside the React tree on purpose: React only takes over once the bundle has loaded and `main.tsx` has run, and by then a plain white window would already have been visible for however long that takes. A render-blocking `<link>` and inline markup are the only way to have something on screen in the very first frame. `src/lib/splash.ts` owns everything past that point:

- **`initSplash()`** runs at the top level of `main.tsx` — module-eval time, while `#splash` is still guaranteed to be in the DOM — and does two things: it clones `#splash` for later reuse by `showSplash()`, and it arms a 10s fallback timer that calls `hideSplash()` regardless of what the rest of the app is doing.
- **`hideSplash()`** is called from `AppShell`'s initial-load effect once the vault's data has loaded (or, on a fresh install, once vault setup itself is showing) — success or failure both count, so a failed load still uncovers a usable screen instead of leaving the loading screen up forever. It enforces a roughly 900ms minimum display time so a fast local SQLite read doesn't just flash the screen once, and fades the element out (CSS `transition`) before removing it. It is idempotent, since both the initial-load effect and the fallback timer can call it. The initial-load effect itself now loads the active vault's settings (`useSettingsStore.getState().loadForVault(...)`) *before* `reloadAllStores()` — the trash purge needs the vault's retention setting and migration v39 needs its language — and `AppShell` gates its own render on that finishing (`bootSettled`) the same way it already gated on knowing whether a vault exists at all, so nothing can call `getDb()` on a vault whose settings haven't loaded yet (a restored tab pointing straight at Trash, for one).
- **`showSplash()`** clones the saved template again and shows it as a preview, dismissed by a click or Escape — used by the View menu's **Show Loading Screen** item (`show-splash` in the menu-event table above).

The screen's root carries `data-tauri-drag-region`, but a `.splash-drag` strip across its
top (2.5rem, matching the title bar's `h-10` behind it) repeats the attribute a second
time. Tauri reads `data-tauri-drag-region` off the element directly under the cursor and
does not walk up the tree, so a click swallowed by a child never reaches the root's own
attribute — which happens twice here: `.splash-gem` sits on top of the strip in paint
order (it animates via `transform` and, at minimum window height, its 512px box reaches
into the strip through a negative margin) and so needs `pointer-events: none` to stay out
of the way, and `showSplash()`'s preview deliberately *removes* the attribute from its
clone's root so a click can dismiss it — which used to mean the preview could not be
dragged at all. The strip keeps its own attribute regardless of what the root's is doing,
so the window stays draggable during normal boot and in the preview alike.

Two independent safety nets exist because they cover different failure modes: the 10s timer in `initSplash()` (inside the bundle) handles a slow or stuck data load; a second, harder-edged 15s timer inside the inline `<script>` in `index.html` itself handles the bundle never loading or throwing on import, which the first timer can't — it lives in the same code that might not run. That second timer skips the fade and just removes the element, and deliberately outlasts the first so it never fires ahead of the normal path. Left stuck, the loading screen would be unrecoverable on Windows and Linux, where it sits over the app's own window chrome (`decorations: false`) and hides the only close button.

The inline boot `<script>` also sets `html[data-theme]` from `localStorage` before the loading screen's first paint, so the screen appears in the correct theme's colours rather than defaulting to one and flashing to the other. It is a deliberate, comment-flagged copy of `normalizeThemeId()` from `src/themes/theme.ts` — the real function lives in the bundle this script runs before.

## PDF Export

Emerald renders PDFs by driving the app's own embedded webview rather than bundling a separate HTML-to-PDF engine. The implementation is split across one module file per platform, dispatched at compile time by `#[cfg(target_os = "…")]` in `src-tauri/src/pdf_export/mod.rs`, so `lib.rs` only has to call `pdf_export::export_pdf(&app, html, path, page_size).await` regardless of the host OS.

The same command backs two distinct export flows, distinguished by what's currently open (see [Menu enablement gating](#menu-enablement-gating) below): Journal/Wiki/Operations entries export their text content at the default Letter/Portrait page size; an open Altar (reading view) instead exports its rendered image at a page size matching the altar's own aspect ratio, via the optional `page_size` parameter.

### Flow — Journal / Wiki / Operations (entry text)

```
frontend export.ts:exportAsPDF
    ↓  build full HTML (DOMPurify, transformInternalLinks, embedImages)
frontend save() dialog → user picks destination path
    ↓  invoke('export_pdf', { html, path })   // no page_size → default Letter/Portrait
src-tauri/src/lib.rs:export_pdf
    ↓  pdf_export::export_pdf(&app, html, path, None).await
src-tauri/src/pdf_export/{windows,macos,linux}.rs
    ↓  write HTML to a unique temp file (file:// URL)
    ↓  build a hidden WebviewWindow pointing at that file
    ↓  wait for PageLoadEvent::Finished via tokio::sync::oneshot
    ↓  with_webview(...) → call platform's native PDF API
    ↓  close the hidden window + remove the temp file
    ↓  return Result<(), String> → frontend toasts success/failure
```

### Flow — Altar (rendered image)

```
frontend altarExport.ts:saveAltarPDF
    ↓  exportCurrentAltarImage('png')  // same capture path as "Export as Image"
    ↓  pdfPageSizeForResolution(resolution) → [widthIn, heightIn]
    ↓  build minimal HTML: single <img> filling the page (object-fit: cover, 2% overscan
    ↓    to hide a rounding-induced hairline gap at some aspect ratios)
frontend save() dialog → user picks destination path
    ↓  invoke('export_pdf', { html, path, pageSize: [widthIn, heightIn] })
src-tauri/src/lib.rs:export_pdf
    ↓  pdf_export::export_pdf(&app, html, path, Some((widthIn, heightIn))).await
    ↓  (same hidden-webview flow as above; Windows applies page_size as a
    ↓   custom print media size, macOS/Linux currently ignore it — see below)
```

All three platforms share the same shape — hidden webview, oneshot-coordinated page-load wait, `with_webview` to reach the platform webview, native PDF API call, hidden window + temp file cleanup in a `Drop`-style guard. The differences are entirely in step 4 (the platform webview API) and in how (or whether) `page_size` is honored.

### Per-platform implementations

- **Windows (`src-tauri/src/pdf_export/windows.rs`)** — implemented and tested end-to-end. Builds a hidden `WebviewWindow` with `WebviewWindowBuilder`, waits for `PageLoadEvent::Finished` via a `oneshot` signalled from `on_page_load`, then calls `with_webview` to reach the WebView2 controller. Casts the core to `ICoreWebView2_7` and invokes `PrintToPdf(PCWSTR, settings, ICoreWebView2PrintToPdfCompletedHandler)`. When `page_size` is `Some`, it is applied as a custom media size before printing: `ICoreWebView2_2::Environment` → `ICoreWebView2Environment6::CreatePrintSettings` builds an `ICoreWebView2PrintSettings`, cast to `ICoreWebView2PrintSettings2` to call `SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)`, then `SetPageWidth`/`SetPageHeight` (inches) and all four margins set to 0. If building the custom settings fails for any reason, the export falls back to `PrintToPdf`'s default Letter/Portrait settings rather than aborting. The COM completion handler runs on a worker thread; the Rust side bridges it back to async with a second `oneshot` wrapped in `Arc<Mutex<Option<_>>>` so the handler can move it out. Two timeouts cap the operation: 30 s for the page-load wait and 120 s for `PrintToPdf` itself.
- **macOS (`src-tauri/src/pdf_export/macos.rs`)** — implemented and verified on real hardware. Same shape. Reaches the `WKWebView` pointer via `with_webview` and calls `createPDFWithConfiguration:completionHandler:`. The completion handler runs on a background queue and is bridged back to async with a `block2::RcBlock` + `oneshot`; the closure parameters are raw Objective-C pointer types (`*mut NSData`, `*mut NSError`) as required by the `IntoBlock` trait in block2 0.6. `WKPDFConfiguration::new` is called inside an `unsafe` block (required by `objc2-web-kit` 0.3). `MainThreadMarker` is acquired inside the `with_webview` closure because that closure dispatches us to the AppKit main thread. PDF bytes are extracted from the `NSData` result via `msg_send![data, bytes]` / `msg_send![data, length]` and written to disk with Rust's `std::fs::write` (the `NSData` selector `writeToFile:atomically:error:` does not exist; use `writeToFile:atomically:` or `writeToFile:options:error:` if switching back to the ObjC API). `page_size` is accepted but currently unused (`_page_size`) — honoring it would need `WKPDFConfiguration.rect` sized in points; left for a future change.
- **Linux (`src-tauri/src/pdf_export/linux.rs`)** — implemented and verified on real hardware (spot-checked on a fresh Ubuntu 26.04 install; the supported/build distro matrix is unchanged — Ubuntu 22.04 LTS and 24.04 LTS. See `Documentation/build.md` for the CI/release runner matrix). Same overall shape as Windows/macOS, but with two Linux-specific wrinkles:
  - **Crate split.** Print settings and the output-format/URI keys come from `gtk::PrintSettings`, not `webkit2gtk` — the WebKit crate only owns `PrintOperation`/`PrintOperationExt`. `gtk::PrintSettings` has no typed setters, only a generic string-keyed `set(key, value)`; the code sets `"output-file-format"` to `"pdf"` and `"output-uri"` to a `file://<path>` URI this way (keys match `GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT`/`_OUTPUT_URI` in gtk-sys).
  - **Printer resolution via FFI.** `webkit_print_operation_print()` always routes through GTK's normal printer resolution and fails with "Printer not found" unless `PrintSettings`' `printer` key names a printer that actually exists — most dev/CI machines have no real CUPS printer. GTK ships a built-in virtual "Print to File" printer, but it isn't flagged as the OS default (`gtk_printer_is_default` is false for it even when it's the only registered printer) and its display name is locale-translated, so it can't be hardcoded. `gtk_enumerate_printers` isn't covered by the `gtk` crate's bindings (excluded from its gir scan), so a small hand-written `printer_ffi` module declares the C signatures (`gtk_enumerate_printers`, `gtk_printer_get_name`, `gtk_printer_is_virtual`, `gtk_printer_accepts_pdf`) and calls directly into libgtk-3, which is already linked via the `gtk`/`webkit2gtk` crates. `find_pdf_printer_name()` enumerates printers and returns the first virtual, PDF-capable one; export fails fast with a descriptive error if none is found.
  - **Async completion.** `PrintOperation::print()` is not synchronous — it starts the job and returns immediately. `run_print` connects the operation's `finished`/`failed` GObject signals, relaying the eventual result through the same `Arc<Mutex<Option<oneshot::Sender<_>>>>` the caller is awaiting on, rather than checking for the output file right after `print()` returns.

  `page_size` is accepted but currently unused (`_page_size`) — honoring it would need a custom `GtkPaperSize`; left for a future change.

### Frontend responsibilities

Because the hidden webview inherits the app CSP (`script-src 'self'`, see `tauri.conf.json`), the frontend does everything that the old print-window approach did with inline JavaScript before it hands the HTML to Rust:

- `transformInternalLinks(html)` in `src/lib/export.ts` walks every `<span data-type="internalLink">` and bakes the chip (icon `<img>`/`<span>` + label `<span>`) into the DOM. This replaces the `TRANSFORM_LINKS_JS` inline `<script>` that the old print window ran, and is required because the new webview's CSP blocks inline scripts.
- `embedImages(html)` resolves every file-backed `src="…"` to a base64 data-URL via the `read_image_as_base64` IPC command before export. The hidden webview runs on a `file://` URL and would otherwise not have access to images stored outside the document directory.
- `resolveInternalLinkIcons(html)` fills in missing `data-icon` attributes from the live store state at export time, so chips saved without an icon still render correctly.
- DOMPurify sanitisation runs in TypeScript before the HTML is passed to the backend, with the TipTap internal-link attributes explicitly allowlisted so chips survive the pass intact.

### Menu enablement gating

The three "Export as …" menu items (`export-pdf`, `export-markdown`, `export-emerald`) share one submenu but are not all gated identically: Markdown is entry-only, while PDF and Emerald are also available for altars. There is no separate "Export Altar as PDF" menu item — `export-pdf` is reused and its handler branches on what's currently open. The gating is done in two places:

- **Rust (`src-tauri/src/lib.rs`)** — the menu items are constructed with `enabled: false` in the `setup` block, so they start greyed out. The `set_export_menu_enabled(app, entry_enabled, pdf_enabled, emerald_enabled)` Tauri command walks the `export-submenu` and sets `export-markdown` from `entry_enabled`, `export-pdf` from `pdf_enabled`, and `export-emerald` from `emerald_enabled`, all independently.
- **Frontend (`src/components/layout/AppShell.tsx`)** — a single `useEffect` keyed on `activeView.type`, `activeView.id`, and `activeView.mode` calls `invoke('set_export_menu_enabled', { entryEnabled, pdfEnabled, emeraldEnabled })` with `entryEnabled = (activeView.type ∈ {journal, wiki, operations}) && !!activeView.id`, and both `pdfEnabled` and `emeraldEnabled` set to `entryEnabled || (activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit')`. The same effect also calls `set_altar_export_menu_enabled` (see below), since all three depend on the same view-state inputs. The `export-pdf` listener itself re-reads `useUIStore.getState().activeView` at click time: if it resolves to an Altar reading view, it calls `saveAltarPDF()` (`src/lib/altarExport.ts`) instead of the usual `exportAsPDF(data)` path.

  **Blocks export through their own serializers, so there is no concealed-sigil gate.** `collectExportData` runs `renderBlocksForExport` (`lib/blocks/exportRender.ts`, pure, texts passed in as `ExportText`): one serializer per block type, by the read-mode rules — hidden blocks and a concealed sigil's calculator and drawing are left out, field blocks list only what `isHiddenInRead` lets through, titles become `<h3>` where `showsTitleInRead` says so, unknown types go out as their stored inner HTML (sanitized by the PDF path like any content). The result is plain HTML without `<section>`, so DOMPurify, `embedImages`, the link-chip transform and Turndown work unchanged; Turndown gets rules for `<dt>`/`<dd>`, and `stripImages` leaves an image's alt text as a placeholder (the sigil drawing). The `.emerald` export keeps blocks as they are (hidden ones are data, flagged as hidden) but drops concealed ones via `withoutConcealed`.

There is still only one `export-emerald` menu item — it is not duplicated per content type; `exportAsEmerald()` in `src/lib/emeraldFormat.ts` branches internally on `activeView.type` to export either the open entry or the open altar. The same one-menu-item-branches-internally pattern now also applies to `export-pdf`.

**Altar "Export as Image" submenu.** A nested `Submenu` (id `export-altar-image`, containing `MenuItem`s `export-altar-jpeg` / `export-altar-png` / `export-altar-webp`) sits inside `export-submenu`, separated from the entry-export items by a `PredefinedMenuItem::separator`. It follows the same two-place gating pattern, but with a different condition — it is only meaningful while an Altar is open in **reading view** (not edit mode):

- **Rust** — `set_altar_export_menu_enabled(app, enabled)` walks `export-submenu` to find the `export-altar-image` submenu, toggles the submenu itself (`enabled: false` at construction) plus its three child `MenuItem`s in one call.
- **Frontend** — a separate `useEffect` keyed on `activeView.type`, `activeView.id`, and `activeView.mode` calls `invoke('set_altar_export_menu_enabled', { enabled })` with `enabled = activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit'`.
- Clicking a leaf item emits `export-altar-jpeg` / `export-altar-png` / `export-altar-webp`, which `AppShell.tsx` listens for and forwards to `saveAltarImage(format)` (`src/lib/altarExport.ts`) — the same `exportCurrentAltarImage()` capture path formerly wired to the in-sidebar "Save Image" button.
- `update_menu_labels` was extended with `export_altar_image` / `export_altar_jpeg` / `export_altar_png` / `export_altar_webp` params and traverses into the nested submenu to relabel it and its children on language change.

### Bridging imperative menu-event code to a React modal

`import-markdown` is a Tauri menu event, so its handler (`importFromMarkdown()` in `src/lib/emeraldFormat.ts`) runs as plain imperative code with no component tree to render a confirmation dialog into. When the parsed file's frontmatter has no usable `type`, the import needs the user to pick a destination before it can continue — `src/store/importStore.ts` bridges this gap with a promise-based Zustand store: `askDestination(title)` sets `pending = { title, resolve }` and returns a `Promise<ImportDestinationType | null>` that does not resolve until the store's `choose(type)` or `cancel()` action is called. `ImportDestinationModal` (mounted globally in `AppShell`, alongside `UndoToast`) subscribes to `pending` and renders only when it's non-null; clicking an option calls `choose`, clicking outside/Escape/Cancel calls `cancel` (resolves `null`). `importFromMarkdown()` awaits the promise and treats `null` as a full import abort (`return` before any DB write). This pattern — an imperative caller `await`s a store method, a mounted-once modal component resolves it — is the template for any future case where non-component code needs a blocking user decision.
