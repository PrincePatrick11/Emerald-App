# Window, Boot and PDF Export

## Window Chrome

The title bar is drawn by the app, not the OS: a 40px bar (`h-10`) in `src/components/layout/titlebar/`, above the three-column shell in `AppShell`. From left to right:

- **Leading group** (`flex-shrink-0`): the Emerald logo, the application menu button, the global-search magnifier, back/forward, and on Windows/Linux the Export and Import buttons. With tabs shown it grows to the left sidebar's width, so the tabs start flush with the sheet below.
- **Middle**: the tab strip (`TabBar`, see [Tabs and Workspace State](navigation.md#tabs-and-workspace-state)), or — without tabs (no vault yet, boot still running) — an empty `flex-1` drag surface.
- **Trailing group**: the window controls on Windows/Linux.

Every trigger is an icon-only `RailButton`, so nothing has to shrink, wrap or fold as the window narrows.

The logo (`EmeraldMark`, an inline SVG) is not a control. Its wrapper carries `data-tauri-drag-region` and the mark `pointer-events-none`, since the element under the cursor could otherwise be a `<polygon>` inside the SVG (see **Dragging** below).

**The application menu is a menu-icon button, not a bar.** `TitleBarMenuButton` (`RailButton` + an in-place `MenuDropdown`, dismissed via `useOutsideClick`) renders once for the app menu — Edit and View as submenus, built in `useTitleBarMenus.ts` — and once each for Export and Import, with their own icons (`Download`/`Upload`, matching Settings → Backup). Each opens independently; there is no shared `role="menubar"`.

**The split is per platform, and deliberately not uniform.** `src/lib/platform.ts` decides at module-eval time (a synchronous user-agent check, so the first paint is already right) and `main.tsx` mirrors the result onto `html[data-platform]` for CSS. `usesCustomWindowControls` additionally requires `isTauri` (`'__TAURI_INTERNALS__' in window`): in a plain browser the window APIs do not exist, and `getCurrentWindow()` would throw during render.

| | Windows / Linux | macOS |
|---|---|---|
| Window config | `decorations: false` | `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle` |
| Min / max / close | `WindowControls` (46x40, Fluent geometry) | Native traffic lights, positioned by `trafficLightPosition` |
| Application menu | `TitleBarMenuButton` (HTML, `usesHtmlMenuBar`) | Native, in the system menu bar |
| Title bar left inset | none | 5rem, reserved for the traffic lights |

Per-platform window settings live in `src-tauri/tauri.{windows,linux,macos}.conf.json`, which Tauri merges over `tauri.conf.json`. The merge is RFC 7396, which **replaces arrays wholesale**, so each file repeats the complete window object. `tauri.dev.conf.json` merges last (via `--config`) and must never gain an `app.windows` key, or it would wipe the platform settings. All four files set `minWidth` 720 and `minHeight` 600.

**Altar full-window mode.** The predicate is `isAltarFullscreen` in `uiStore`, shared by `AppShell` (hides the sidebars) and `TitleBar` (drops tabs, navigation and the magnifier), so the two cannot drift apart. The title bar itself stays: on Windows and Linux it holds the only way to close or move the window, *and* the only route to the altar's image export, which is usually why that mode was entered — so the menu button and Export/Import stay. `TitleBar` closes the search modal itself when the magnifier disappears (entering full-window mode, or the last vault closing), rather than leaving it open with nothing to reopen it.

**Dragging** uses `data-tauri-drag-region`. Tauri reads it off the element directly under the cursor and does **not** walk up the tree, so every non-interactive wrapper in `TitleBar` carries the attribute and no interactive control does. Double-clicking a drag region maximises.

**Permissions** (`src-tauri/capabilities/default.json`): the window controls add `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close` to `core:default`; `core:webview:allow-set-webview-zoom` backs the interface-size setting. See [`security.md`](../security.md).

### Why the native menu is macOS-only

`install_native_menu` in `src-tauri/src/lib.rs` is gated to macOS. On Windows and Linux, `set_menu` attaches an in-window menu bar (an HMENU / a GTK menubar) regardless of `decorations`, which would sit beside the app's own title-bar menus. The menu commands (`update_menu_labels`, `set_export_menu_enabled`, `set_altar_export_menu_enabled`, `set_view_menu_checked`) all return early when `app.menu()` is `None`, so they are no-ops there without frontend branching.

Both forms run the same code. `src/lib/menuActions.ts` owns the actions (`runMenuAction`) and the rules for which export items are available (`computeMenuEnabledState`). The native menu emits the event ids listed in [IPC Command Surface](../architecture.md#ipc-command-surface), which `AppShell` forwards; the HTML buttons call `dispatchMenuAction` directly. `View > Reset View` is the exception: it changes `AppShell`'s local sidebar widths, so the HTML menu re-emits `reset-sidebar-widths` and `AppShell`'s listener answers it on both platforms.

### Closing the window

Closing asks about unsaved edits first (see [Leaving an edit](editing.md#leaving-an-edit)): `AppShell` registers `onCloseRequested`, runs `settleBeforeExit()`, and prevents the close when the answer is "keep editing". Before the window goes it waits for writes still under way (`drainSerialized`, `flushDrafts`). A minimised window is restored and focused before the question, which would otherwise be asked where nobody sees it — on Linux (X11) only once the window no longer reports itself minimised, since tao drops a focus request before that.

A registered handler has a price: Tauri holds back *every* close while a JS listener exists, so a hung or crashed frontend would leave a window that cannot be closed — on Windows and Linux not even by Alt+F4 or the taskbar. Two safeguards:

- An error inside the handler is caught and lets the window close.
- `CloseWatch` (`src-tauri/src/lib.rs`): the handler acknowledges every request at once through `close_request_seen`. If a request stays unacknowledged, the next one after `CLOSE_ANSWER_TIMEOUT` (3 s) destroys the window from Rust, without asking.

| Way out | Asks |
|---|---|
| Title bar close button, Alt+F4, taskbar or window manager close (Windows, Linux) | yes |
| Red traffic light (macOS) | yes |
| Cmd+Q and "Quit" in the app menu (macOS) | yes — the menu has its own `quit` item that closes the window, instead of `PredefinedMenuItem::quit`, which terminates the app past the question. **Untested on real hardware.** |
| Installing an update | yes — `UpdatesPage` asks before it calls `install_update`, which restarts the app without a close request |
| Quit from the Dock, logging out, shutting down, killing the process | no — nothing the app could answer. Entries are covered by the autosave, drafts by `drafts.json` |

Known limit: under Wayland a minimised window cannot be brought forward (there is no minimised state to read, and focus cannot be taken without an activation token), so a close from the panel while minimised may ask where it is not seen until the window is raised by hand. Untested on real hardware.

### Known limitations

- **Windows 11 Snap Layouts.** With `decorations: false` the hover flyout on the maximise button is missing; restoring it needs `WM_NCHITTEST` returning `HTMAXBUTTON` from Rust. `Win+Arrow` and drag-to-edge snapping work.
- **Paste in the HTML Edit menu**: `document.execCommand('paste')` is blocked in WebView2 and WKWebView, so `editCommands.ts` replays `navigator.clipboard.read()` as a synthetic `ClipboardEvent`. A real event (not `insertText`) keeps ProseMirror's paste handling and `text/html`; images ride along as `File` entries for `RichEditor`'s `handlePaste`. `Ctrl+V` always works natively.

### Loading Screen and Boot Order

The earliest step is `adopt_previous_identifier_dirs` (see [Adopting a previous identifier's data](storage.md#adopting-a-previous-identifiers-data)), which runs inside `Builder::build()` before Tauri creates the window.

The loading screen's markup (`#splash` in `index.html`) and styles (`public/splash.css`, linked from `<head>`) live outside the React tree on purpose: until the bundle has loaded and `main.tsx` has run the window would be blank, and a render-blocking `<link>` plus inline markup is the only way to show something in the first frame. `src/lib/splash.ts` owns everything after that:

- **`initSplash()`** runs at the top level of `main.tsx`, while `#splash` is still in the DOM. It clones `#splash` for `showSplash()` and arms a 10 s fallback timer that calls `hideSplash()` regardless.
- **`hideSplash()`** is called from `AppShell`'s initial-load effect once the vault's data has loaded (or vault setup is showing) — success or failure, so a failed load still uncovers a usable screen. It keeps the screen up at least 900 ms so a fast load doesn't just flash it, fades it out, then removes it. Idempotent, since both the effect and the fallback timer call it.
- **`showSplash()`** shows a fresh clone as a preview, dismissed by click or Escape — the View menu's **Show Loading Screen** (`show-splash`).

The initial-load effect loads the active vault's settings (`loadForVault`) *before* `reloadAllStores()` — the trash purge needs the retention setting and migration v39 the language — and `AppShell` renders its content only after that (`bootSettled`), so nothing calls `getDb()` on a vault whose settings haven't loaded (a restored tab pointing straight at Trash, for one).

**Dragging the loading screen.** The root carries `data-tauri-drag-region`, and a `.splash-drag` strip across the top (2.5rem, the title bar's height) repeats it, because the root's attribute is lost wherever a child takes the click: `showSplash()` removes it from the preview's root so a click can dismiss it, and `.splash-gem` (animated via `transform`, its 512px box reaching into the strip at minimum height) needs `pointer-events: none` to stay out of the strip's way.

**Two safety nets** cover different failures: the 10 s timer in `initSplash()` handles a stuck data load; a 15 s timer in the inline `<script>` in `index.html` handles a bundle that never loads or throws on import, where the first timer never runs. The second skips the fade and deliberately outlasts the first. A stuck loading screen would be unrecoverable on Windows and Linux, where it covers the app's own window chrome and so the only close button.

The inline boot script also sets `html[data-theme]` from `localStorage` before the first paint, so the loading screen appears in the right theme instead of flashing from one to the other. It is a deliberate, comment-flagged copy of `normalizeThemeId()` from `src/themes/theme.ts`, which lives in the bundle the script runs before.

## PDF Export

Emerald renders PDFs by driving its own embedded webview rather than bundling an HTML-to-PDF engine. There is one module per platform, selected at compile time by `#[cfg(target_os = "…")]` in `src-tauri/src/pdf_export/mod.rs`, so `lib.rs` just calls `pdf_export::export_pdf(&app, html, path, page_size).await`.

The command backs two flows, chosen by what is open (see [Menu enablement gating](#menu-enablement-gating)): Journal/Wiki/Operations entries export their text at the default Letter/Portrait size; an open Altar in reading view exports its rendered image at a page size matching the altar's aspect ratio, via the optional `page_size`.

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

All three platforms share that shape, with a 30 s page-load and a 120 s print timeout and cleanup in a guard; they differ only in the native API and in whether `page_size` is honoured.

### Per-platform implementations

- **Windows (`windows.rs`)** — tested end-to-end. Calls `PrintToPdf` on the WebView2 core (`ICoreWebView2_7`). A `page_size` becomes custom print settings (`CreatePrintSettings`, `SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)`, page width/height in inches, zero margins); if building them fails, the export falls back to the default Letter/Portrait instead of aborting. The COM completion handler runs on a worker thread and is bridged back to async with a second `oneshot`.
- **macOS (`macos.rs`)** — verified on real hardware. Calls `createPDFWithConfiguration:completionHandler:` on the `WKWebView`, bridged with a `block2::RcBlock` + `oneshot`, and writes the bytes with `std::fs::write` (`NSData` has no `writeToFile:atomically:error:`). `page_size` is unused; honouring it needs `WKPDFConfiguration.rect` sized in points.
- **Linux (`linux.rs`)** — verified on real hardware (spot-checked on Ubuntu 26.04; supported distributions in [`build.md`](../build.md)). Specific to GTK:
  - **Print settings** come from `gtk::PrintSettings` (`webkit2gtk` owns only `PrintOperation`), set through its string-keyed `set()`: `"output-file-format"` = `"pdf"`, `"output-uri"` = a `file://` URI.
  - **Printer resolution via FFI.** `webkit_print_operation_print()` fails with "Printer not found" unless the `printer` key names an existing printer, and most machines have no CUPS printer. GTK's virtual "Print to File" printer is neither the default nor stably named (the name is translated). `gtk_enumerate_printers` is missing from the `gtk` crate's bindings, so a small `printer_ffi` module calls libgtk-3 directly; `find_pdf_printer_name()` returns the first virtual, PDF-capable printer, and the export fails fast if there is none.
  - **Async completion.** `PrintOperation::print()` returns immediately; `run_print` relays the result from the `finished`/`failed` signals through the `oneshot` the caller awaits.
  - `page_size` is unused; honouring it needs a custom `GtkPaperSize`.

### Frontend responsibilities

The hidden webview inherits the app CSP (`script-src 'self'`, see `tauri.conf.json`), so it cannot run inline scripts. The frontend therefore prepares the HTML completely before handing it to Rust:

- `transformInternalLinks(html)` in `src/lib/export.ts` bakes every `<span data-type="internalLink">` into a static chip (icon `<img>`/`<span>` + label `<span>`).
- `embedImages(html)` resolves every stored image to a base64 data-URL via `read_image_as_base64`; the hidden webview runs on a `file://` URL the `emerald-img` scheme does not reach.
- `resolveInternalLinkIcons(html)` fills missing `data-icon` attributes from the live stores, so chips saved without an icon still render.
- DOMPurify sanitises the HTML in TypeScript, with the TipTap internal-link attributes allowlisted so chips survive.

### Menu enablement gating

The three "Export as …" items (`export-pdf`, `export-markdown`, `export-emerald`) share one submenu but are gated differently. `computeMenuEnabledState(activeView)` in `src/lib/menuActions.ts` is the single rule set, read by both the native menu and the HTML title-bar menus:

| Item | Enabled for |
|---|---|
| `export-markdown` | an open Journal/Wiki/Operations entry |
| `export-pdf` | an entry, or an altar in reading view |
| `export-emerald` | an entry, an altar in reading view, or an open template page |
| `export-altar-image` submenu | an altar in reading view |

On macOS the items start disabled (`install_native_menu`), and one `useEffect` in `AppShell`, keyed on `activeView.type`, `.id` and `.mode`, pushes the state through `set_export_menu_enabled` (the three items independently) and `set_altar_export_menu_enabled` (the submenu and its three children).

There is one item per format, not one per content type: the handlers branch on what is open. `export-pdf` re-reads `useUIStore.getState().activeView` at click time and calls `saveAltarPDF()` (`src/lib/altarExport.ts`) for an altar in reading view, `exportAsPDF(data)` otherwise. `exportAsEmerald()` (`src/lib/emeraldFormat.ts`) branches the same way.

**Blocks export through their own serializers, so there is no concealed-sigil gate.** `collectExportData` runs `renderBlocksForExport` (`lib/blocks/exportRender.ts`, pure, texts passed in as `ExportText`): one serializer per block type, by the read-mode rules — hidden blocks and a concealed sigil's calculator and drawing are left out, field blocks list only what `isHiddenInRead` lets through, titles become `<h3>` where `showsTitleInRead` says so, unknown types go out as their stored inner HTML. The result is plain HTML without `<section>`, so DOMPurify, `embedImages`, the link-chip transform and Turndown work unchanged (Turndown has rules for `<dt>`/`<dd>`; `stripImages` keeps a block image's alt text as a placeholder). The `.emerald` export keeps blocks as stored, hidden ones flagged, but drops concealed ones via `withoutConcealed`.

**Altar "Export as Image" submenu.** `export-altar-image` (below a separator in `export-submenu`) holds `export-altar-jpeg`/`-png`/`-webp`; each reaches `runMenuAction`, which calls `saveAltarImage(format)` (`src/lib/altarExport.ts`). `update_menu_labels` descends into the nested submenu to relabel it on language change.

### Bridging imperative menu-event code to a React modal

`import-markdown` is a menu action, so its handler (`importFromMarkdown()` in `src/lib/emeraldFormat.ts`) is plain imperative code with no component tree to render a dialog into. When the file's frontmatter has no usable `type`, the user has to pick a destination first. `src/store/importStore.ts` bridges this with a promise-based Zustand store:

- `askDestination(title)` sets `pending = { title, resolve }` and returns a `Promise<ImportDestinationType | null>` that resolves only when `choose(type)` or `cancel()` is called.
- `ImportDestinationModal` (mounted once in `AppShell`, next to `UndoToast`) renders while `pending` is set; an option calls `choose`, clicking outside/Escape/Cancel calls `cancel` (resolves `null`).
- `importFromMarkdown()` awaits the promise and treats `null` as a full abort, before any DB write.

This pattern — an imperative caller `await`s a store method, a mounted-once modal resolves it — is the template for any non-component code that needs a blocking user decision.
