# Window, Boot and PDF Export

## Window Chrome

The title bar is drawn by the app, not the OS: a 40px bar (`h-10`) in `src/components/layout/titlebar/`, above the three-column shell in `AppShell`. From left to right:

- **Leading group** (`flex-shrink-0`): the Emerald logo and the application menu button (neither on macOS, which has the traffic lights and its native menu), the global-search magnifier, back/forward, and the Export and Import buttons. With tabs shown it grows to the left sidebar's width, so the tabs start flush with the sheet below.
- **Middle**: the tab strip (`TabBar`, see [Tabs and Workspace State](navigation.md#tabs-and-workspace-state)), or — without tabs (vault picker, boot still running) — an empty `flex-1` drag surface.

- **Trailing group**: the window controls on Windows/Linux. In an [MCP test instance](../mcp.md#the-instance) they are preceded by the branch of its checkout (`titlebar-branch`); everywhere else that label is compiled out.

Over the [vault picker](#vault-picker) (`TitleBar picker`) the bar keeps only the logo and the window controls (on macOS only the traffic lights), without Export, Import or the menu, and `WindowControls` drops maximise: the picker's window has one fixed size.

Every trigger is an icon-only `RailButton`, so nothing has to shrink, wrap or fold as the window narrows.

The logo (`EmeraldMark`, an inline SVG) is not a control. Its wrapper carries `data-tauri-drag-region` and the mark `pointer-events-none`, since the element under the cursor could otherwise be a `<polygon>` inside the SVG (see **Dragging** below).

**The application menu is a menu-icon button, not a bar.** `TitleBarMenuButton` (`RailButton` + an in-place `MenuDropdown`, dismissed via `useOutsideClick`) renders once for the app menu — **Switch Vault…**, **Check for Updates…** and **About Emerald App** (`switch-vault`, `check-updates`, `show-about`, as in the macOS app menu), then Edit and View as submenus, built in `useTitleBarMenus.ts` — and once each for Export and Import, with their own icons (`Download`/`Upload`, as in the vault export and import dialogs). Each opens independently; there is no shared `role="menubar"`.

**The split is per platform, and deliberately not uniform.** `src/lib/platform.ts` decides at module-eval time (a synchronous user-agent check, so the first paint is already right) and `main.tsx` mirrors the result onto `html[data-platform]` for CSS. `usesCustomWindowControls` additionally requires `isTauri` (`'__TAURI_INTERNALS__' in window`): in a plain browser the window APIs do not exist, and `getCurrentWindow()` would throw during render.

| | Windows / Linux | macOS |
|---|---|---|
| Window config | `decorations: false` | `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle` |
| Min / max / close | `WindowControls` (46x40, Fluent geometry) | Native traffic lights, positioned by `trafficLightPosition` |
| Application menu | `TitleBarMenuButton` | Native, in the system menu bar |
| Title bar left | the logo | no logo, a 5rem inset for the traffic lights |

Per-platform window settings live in `src-tauri/tauri.{windows,linux,macos}.conf.json`, which Tauri merges over `tauri.conf.json` — each repeats the complete window object, and `tauri.dev.conf.json` must never gain an `app.windows` key (why: [Per-platform Tauri configs](../build.md#per-platform-tauri-configs)). All four files set `minWidth` 720 and `minHeight` 600.

**Dragging** uses `data-tauri-drag-region`. Tauri reads it off the element directly under the cursor and does **not** walk up the tree, so every non-interactive wrapper in `TitleBar` carries the attribute and no interactive control does. Double-clicking a drag region maximises.

**Permissions** (`src-tauri/capabilities/default.json`): the window controls add `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close` to `core:default`; `core:webview:allow-set-webview-zoom` backs the interface-size setting. See [`security.md`](../security.md).

### Why the native menu is macOS-only

`install_native_menu` in `src-tauri/src/lib.rs` is gated to macOS. On Windows and Linux, `set_menu` attaches an in-window menu bar (an HMENU / a GTK menubar) regardless of `decorations`, which would sit beside the app's own title-bar menus. The menu commands (`update_menu_labels`, `set_view_menu_checked`) return early when `app.menu()` is `None`, so they are no-ops there without frontend branching. The native menu holds the app menu, Edit and View; Export and Import are only in the title bar.

Both forms run the same code. `src/lib/menuActions.ts` owns the actions (`runMenuAction`); the title bar's Export is one action, `export`, which opens the export menu. The native menu emits the event ids listed in [IPC Command Surface](../architecture.md#ipc-command-surface), which `AppShell` forwards; the HTML buttons call `dispatchMenuAction` directly. `View > Reset View` is the exception: it changes `AppShell`'s local sidebar widths, so the HTML menu re-emits `reset-sidebar-widths` and `AppShell`'s listener answers it on both platforms.

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
| Installing an update | yes — `StartUpdates` (the start page's Updates) asks before it calls `install_update`, which restarts the app without a close request |
| Quit from the Dock, logging out, shutting down, killing the process | no — nothing the app could answer. Entries are covered by the autosave, drafts by `drafts.json` |

Known limit: under Wayland a minimised window cannot be brought forward (there is no minimised state to read, and focus cannot be taken without an activation token), so a close from the panel while minimised may ask where it is not seen until the window is raised by hand. Untested on real hardware.

### Known limitations

- **Windows 11 Snap Layouts.** With `decorations: false` the hover flyout on the maximise button is missing; restoring it needs `WM_NCHITTEST` returning `HTMAXBUTTON` from Rust. `Win+Arrow` and drag-to-edge snapping work.
- **Paste in the HTML Edit menu**: `document.execCommand('paste')` is blocked in WebView2 and WKWebView, so `editCommands.ts` replays `navigator.clipboard.read()` as a synthetic `ClipboardEvent`. A real event (not `insertText`) keeps ProseMirror's paste handling and `text/html`; images ride along as `File` entries for `TextEditor`'s `handlePaste`. `Ctrl+V` always works natively.

### Loading Screen and Boot Order

The earliest step is `adopt_previous_identifier_dirs` (see [Adopting a previous identifier's data](storage.md#adopting-a-previous-identifiers-data)), which runs inside `Builder::build()` before Tauri creates the window.

The loading screen's markup (`#splash` in `index.html`) and styles (`public/splash.css`, linked from `<head>`) live outside the React tree on purpose: until the bundle has loaded and `main.tsx` has run the window would be blank, and a render-blocking `<link>` plus inline markup is the only way to show something in the first frame. `src/lib/splash.ts` owns everything after that:

- **`initSplash()`** runs at the top level of `main.tsx`, while `#splash` is still in the DOM. It clones `#splash` for `showSplash()` and removes the original's `id` (which disarms the 15 s timer in `index.html`, see below) and arms a 10 s fallback timer that calls `hideSplash()` regardless.
- **`hideSplash()`** is called from `AppShell`'s initial-load effect once the vault's data has loaded — success or failure, so a failed load still uncovers a usable screen. When the start ends in the vault picker, the picker calls it instead, once the window has shrunk to the picker's size, so the large empty window is never seen shrinking. `VaultKeyDialog` calls it on mount as well: the password question comes before the load, and the loading screen would otherwise cover it until the fallback timer fires. `openActiveVault` calls it after the vault has loaded, for every later open or switch. There is no minimum display time: it fades out as soon as loading is done, then is removed. Idempotent, since several callers and the fallback timer may reach it.
- **`resumeSplash()`** puts a fresh clone back up after the key dialog has been answered, because the vault's data is still to load and the empty window would show meanwhile. `hideSplash()` ends it again, from `AppShell`'s boot or `openActiveVault`. After Cancel nothing loads, so it is not called.
- **`extendSplashDuring(promise)`** gives the fallback timer a 2 minute limit while a keychain read is pending, then the regular 10 s again: a keychain prompt waits on the user and must not use up the loading time.
- **`showSplash()`** shows a fresh clone as a preview, dismissed by click or Escape — the View menu's **Show Loading Screen** (`show-splash`).
- **`showLoadingScreen()` / `hideLoadingScreen()`** put up a fresh clone without the click to dismiss while a vault chosen in the vault picker opens, and take it down once the window is back at its size.

The initial-load effect loads the active vault's settings (`loadForVault`) *before* `reloadAllStores()` — the trash purge on the first `getDb()` needs the retention setting — and `AppShell` renders its content only after that (`bootSettled`), so nothing calls `getDb()` on a vault whose settings haven't loaded (a restored tab pointing straight at Trash, for one).

**Dragging the loading screen.** The root carries `data-tauri-drag-region`, and a `.splash-drag` strip across the top (2.5rem, the title bar's height) repeats it, because the root's attribute is lost wherever a child takes the click: `showSplash()` removes it from the preview's root so a click can dismiss it, and `.splash-gem` (animated via `transform`, its 512px box reaching into the strip at minimum height) needs `pointer-events: none` to stay out of the strip's way.

**Two safety nets** cover different failures: the 10 s timer in `initSplash()` handles a stuck data load; a 15 s timer in the inline `<script>` in `index.html` handles a bundle that never loads or throws on import, where the first timer never runs. The second skips the fade; it finds `#splash` by its id, which `initSplash()` removes once the bundle has run, so it acts only when the bundle never got that far and cannot cut short a keychain prompt. A stuck loading screen would be unrecoverable on Windows and Linux, where it covers the app's own window chrome and so the only close button.

The inline boot script also sets `html[data-theme]` from `localStorage` before the first paint, so the loading screen appears in the right theme instead of flashing from one to the other. It is a deliberate, comment-flagged copy of `normalizeThemeId()` from `src/themes/theme.ts`, which lives in the bundle the script runs before.

### Vault Picker

The vault picker is the app's start page. `VaultPicker` is a view in the main window, not a modal and not a second window: there is one set of stores, and the question about unsaved edits stays in the window that holds the edits. `AppShell` renders it in place of the shell — `TitleBar picker`, the picker, `VaultKeyDialog` — whenever no vault is open (`hasActiveVault`) or `vaultPickerStore.open` is set. AppShell itself stays mounted, so its effects (automatic backup, menu listeners, the close guard) keep running; the shell's content unmounts and mounts again on return, with tabs and history still in `uiStore`.

- **Ways in.** `openVaultPicker()` settles the open edits first (`resolveOpenEdits`, as `switchVault` does) and then sets `open`; menu Emerald → Switch Vault… (`switch-vault`: the native macOS item emits it, the HTML menu calls `runMenuAction`) and the rail's start page button (at its very bottom, below Settings) both go through it; About Emerald App (`show-about`) opens it as it is; Check for Updates… (`check-updates`) and the start page button while it shows the update dot open it with a check running (`openVaultPicker('updates')`; `vaultPickerStore.focus`, taken once by the part it names). On start, `AppShell`'s initial-load effect falls back to the picker (`closeToSetup`) when the password is cancelled or the vault fails to open; the second case sets `vaultPickerStore.notice`, shown above the list. `vaults.json` keeps that vault as the active one for the next start.
- **Choosing.** `choose` in `VaultPicker` keeps `open` set throughout, also where the picker only showed for want of a vault: `switchVault` makes a vault active before opening it, and the shell must not mount on a database that is still locked. The password comes first (`ensureVaultReady`, inside the picker), then `showLoadingScreen()`, `switchVault(id, { editsResolved: true })`, `closeVaultPicker()`, and two frames later `hideLoadingScreen()`. A cancelled password leaves the picker as it was; a failed switch shows its error there. Choosing the open vault, the way back above the cards, or Escape only closes the picker.
- **While it is up**, the title bar leaves out Export and Import, and `runMenuAction` ignores them as it does without a vault; the macOS menu's Edit and View stay.
- **Layout.** The picker keeps the window as it is and fills it like the shell. On the frame at the left `StartBrand` (mark, name, tagline, links, version and author), its width dragged at a `.sidebar-resize-handle` as the entry list's is and kept in `localStorage` (`start-brand-width`, 300–560px, the sheet keeping at least 480); on the sheet (`.picker-sheet`) the way back as in an open entry (`.entry-back-link`), then one page of sections (`.start-content`, at most 1080px wide), each a `StartSection` — a label with its icon, actions on the right — with no box around it: the vaults as tiles across the width, and below them side by side `PickerServerPanel` (a placeholder: a panel saying that sync comes in a later version, nothing to act on) and `StartAppearance` (the device's theme as cards that show it in small: a built-in theme's colours read from its own stylesheet, imported `?raw`, a custom theme's from its file; language and theme are [Device Settings](storage.md#device-settings)). At the sheet's foot `StartLanguage` on the left (a `Dropdown`, a flag per language) and `StartUpdates` on the right: the check and installing, the release notes as the find's tooltip, and **Update server**, a popover above the foot (`StartUpdateSource`: the source and the check on start, saved to `update.json`; a changed source drops the old result) (`components/layout/start/`). The list holds the vaults in `vaults.json`. The tiles (`PickerRows.tsx`) are panels like a dashboard's cards, with "only here" under the name (or why the folder cannot be reached); edit and delete show in the corner on hover or focus; name and icon are edited in the tile, while creating and the confirmations open as a row across the grid, and only the open vault is tinted and marked open. The last tile creates a vault.

## PDF Export

Emerald renders PDFs by driving its own embedded webview rather than bundling an HTML-to-PDF engine. There is one module per platform, selected at compile time by `#[cfg(target_os = "…")]` in `src-tauri/src/pdf_export/mod.rs`, so `lib.rs` just calls `pdf_export::export_pdf(&app, html, path, page_size).await`.

The command backs one flow: the export menu's PDF (see [The export menu](#the-export-menu)) — one entry or several in one document — on A4 portrait on every system, whatever its paper setting (`A4_INCHES` and the margins in `pdf_export/mod.rs`). The command also takes an optional `page_size` in inches, which the frontend does not pass at present.

### Flow — entry text

```
frontend export.ts:exportAsPDF
    ↓  build full HTML (DOMPurify, transformInternalLinks, embedImages)
frontend save() dialog → user picks destination path
    ↓  invoke('export_pdf', { html, path })   // no page_size → A4 portrait
src-tauri/src/lib.rs:export_pdf
    ↓  pdf_export::export_pdf(&app, html, path, None).await
src-tauri/src/pdf_export/{windows,macos,linux}.rs
    ↓  write HTML to a unique temp file (file:// URL; `TempHtml` in `pdf_export/mod.rs`)
    ↓  build a hidden WebviewWindow pointing at that file
    ↓  wait for PageLoadEvent::Finished via tokio::sync::oneshot
    ↓  with_webview(...) → call platform's native PDF API
    ↓  close the hidden window + remove the temp file
    ↓  return Result<(), String> → frontend toasts success/failure
```

All three platforms share that shape, with a 30 s page-load and a 120 s print timeout and cleanup in a guard. The temp file holds the entry in plain text outside the vault, so `TempHtml` owns it: readable by its user only on Unix, never logged by path, deleted when dropped however the export ends, and `sweep_leftovers` removes `emerald-export-*.html` older than an hour at startup (see [`encryption.md`](encryption.md#leftovers-outside-the-vault)). The platforms differ only in the native API and in whether `page_size` is honoured.

### Per-platform implementations

- **Windows (`windows.rs`)** — tested end-to-end. Calls `PrintToPdf` on the WebView2 core (`ICoreWebView2_7`). The page is custom print settings (`CreatePrintSettings`, `SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)`, width/height in inches): A4 with the export's 2 cm / 2.5 cm margins, or a `page_size` with zero margins; if building them fails, the export falls back to WebView2's default page instead of aborting. The COM completion handler runs on a worker thread and is bridged back to async with a second `oneshot`.
- **macOS (`macos.rs`)** — verified on real hardware. Prints the `WKWebView` into the file: `printOperationWithPrintInfo:` with a copy of the shared `NSPrintInfo` (A4 as `paperSize`, the export's 2 cm / 2.5 cm margins, width fitted), saving to the path through AppKit's `NSPrintSaveJob` / `NSPrintJobSavingURL` — set on the operation's own print info too, or a save panel asks. It runs `runOperationModalForWindow:` on the hidden window without panels; a `define_class!` delegate reports `printOperationDidRun:success:contextInfo:` through a `oneshot`. `createPDFWithConfiguration:` is not used: it captures the screen as one tall page, without print styles or page breaks. `page_size` is unused; honouring it would replace the A4 `paperSize`.
- **Linux (`linux.rs`)** — verified on real hardware (spot-checked on Ubuntu 26.04; supported distributions in [`build.md`](../build.md)). Specific to GTK:
  - **Print settings** come from `gtk::PrintSettings` (`webkit2gtk` owns only `PrintOperation`), set through its string-keyed `set()`: `"output-file-format"` = `"pdf"`, `"output-uri"` = a `file://` URI. The paper is A4 (`iso_a4`), set on the settings and on a `gtk::PageSetup` (`set_page_setup`), with the export's margins in inches (`gtk::Unit::Inch`) — not yet tried on a Linux machine.
  - **Printer resolution via FFI.** `webkit_print_operation_print()` fails with "Printer not found" unless the `printer` key names an existing printer, and most machines have no CUPS printer. GTK's virtual "Print to File" printer is neither the default nor stably named (the name is translated). `gtk_enumerate_printers` is missing from the `gtk` crate's bindings, so a small `printer_ffi` module calls libgtk-3 directly; `find_pdf_printer_name()` returns the first virtual, PDF-capable printer, and the export fails fast if there is none.
  - **Async completion.** `PrintOperation::print()` returns immediately; `run_print` relays the result from the `finished`/`failed` signals through the `oneshot` the caller awaits.
  - `page_size` is unused; honouring it needs a custom `GtkPaperSize`.

### Frontend responsibilities

The hidden webview loads the HTML from a `file://` URL, which carries no CSP and which the `emerald-img` scheme does not reach (see [`security.md` → Content Security Policy](../security.md#content-security-policy)). The frontend therefore prepares the HTML completely before handing it to Rust:

- `transformInternalLinks(html, bundleIds?)` in `src/lib/export.ts` bakes every `<span data-type="internalLink">` into a static chip (icon `<img>`/`<span>` + label `<span>`); for the HTML export, `bundleIds` turns a link to an entry in the same file into an `#entry-…` anchor.
- `embedImages(html)` resolves every stored image to a base64 data-URL via `read_image_as_base64`; the hidden webview runs on a `file://` URL the `emerald-img` scheme does not reach.
- `resolveInternalLinkIcons(html)` fills missing `data-icon` attributes from the live stores, so chips saved without an icon still render.
- DOMPurify sanitises the HTML in TypeScript, with the TipTap internal-link attributes allowlisted so chips survive.

### The export menu

The title bar's Export is a button, not a menu: it runs the `export` action, which opens `ExportMenuModal` (`src/components/layout/export/`) through `store/exportMenuStore.ts`. The store records the entry or template on screen at that moment (`ExportTarget`); every opening remounts the dialog, so it starts from that view.

The dialog decides **what** goes out; the exports decide **how** it is written:

- `lib/exportMenu.ts` holds the rules without React: the remembered choices (`loadExportPrefs`/`saveExportPrefs`, `localStorage` key `export-menu-prefs`, the vault-bound dashboard, filter and database contents under `export-menu-prefs:<vaultId>`, everything but a password; "none" is read back as the vault key; categories and tags gone since drop out through `liveFilter`), what Normal fixes in place of the Advanced choices (`effectiveSettings`: pictures balanced, linked entries direct only, oldest first, custom blocks along, a collection by dashboard, the whole database without the Trash; PDF and HTML in the editor font and text size, `exportTypography`), the periods (`periodRange`, counted from the creation day) and the collection (`bulkEntries`: `matchesFilter` from `lib/dashboards.ts` with the dashboard's filter or the own one, then the period, then the order).
- Linked entries come from `linkedEntriesOf(ids, { recursive, blocked })` (blocked entries — ticked off — are listed but not followed further) (`block_refs`, not from the Trash); a collection's entries ticked off are kept out of them too.
- PDF and Markdown: `collectExportDataFor(id)` (`lib/exportData.ts`) per entry, then `exportAsPDF(items, file)` / `exportAsMarkdown(items, file)` (`lib/export.ts`) — one file, entries one after another, each PDF article from a new page; an item carries its picture level (`embedImages` compresses through `compressDataUrl`, `placeholder` strips them).
- HTML: the same items through `exportAsHTML(items, file)` (`lib/htmlExport.ts`): one self-contained file, every entry an article from `exportArticle` with its references, the sidebar grouped by category (`groupByCategory`), `file.order` its starting order. PDF and HTML get `file.typography` (`lib/exportFonts.ts`).
- `.emerald`: `exportItemsAsEmerald(options, defaultName)`; the whole database: `exportDatabase(options, protection)` (`lib/dbBackup.ts`).

**Blocks export through their own serializers, so there is no concealed-sigil gate.** `collectExportDataFor` runs `renderBlocksForExport` (`lib/blocks/exportRender.ts`, pure, texts passed in as `ExportText`): one serializer per block type, by the read-mode rules — hidden blocks and a concealed sigil's calculator and drawing are left out, field blocks list only what `isHiddenInRead` lets through, titles become `<h3>` where `showsTitleInRead` says so, unknown types go out as their stored inner HTML. The result is plain HTML without `<section>`, so DOMPurify, `embedImages`, the link-chip transform and Turndown work unchanged (Turndown has rules for `<dt>`/`<dd>`; `stripImages` keeps a block image's alt text as a placeholder). The `.emerald` export keeps blocks as stored, hidden ones flagged and concealed sigils concealed (see [The `.emerald` file](editing.md#the-emerald-file)).

### Bridging imperative menu-event code to a React modal

`import-markdown` is a menu action, so its handler (`importFromMarkdown()` in `src/lib/emeraldFormat.ts`) is plain imperative code with no component tree to render a dialog into. When the file's header names no category, the user has to pick a dashboard first. `src/store/importStore.ts` bridges this with a promise-based Zustand store:

- `askDestination(title)` sets `pending = { title, resolve }` and returns a `Promise<string | null>` (a dashboard id) that resolves only when `choose(dashboardId)` or `cancel()` is called.
- `ImportDestinationModal` (mounted once in `AppShell`, next to `UndoToast`) renders while `pending` is set, one option per dashboard; an option calls `choose`, clicking outside/Escape/Cancel calls `cancel` (resolves `null`).
- `importFromMarkdown()` awaits the promise and treats `null` as a full abort, before any DB write.

This pattern — an imperative caller `await`s a store method, a mounted-once modal resolves it — is the template for any non-component code that needs a blocking user decision.
