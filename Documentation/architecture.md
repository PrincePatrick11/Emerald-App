# Architecture

Emerald is a desktop app built on Tauri v2 (Rust backend) and React 19 (TypeScript frontend). The two sides communicate through Tauri's IPC bridge: the frontend calls Rust commands via `invoke()`, and Rust emits events the frontend subscribes to.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x |
| UI framework | React 19 + TypeScript |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 3 |
| Rich text editor | TipTap v2 |
| State management | Zustand |
| Database | SQLite via `tauri-plugin-sql` |
| Internationalisation | react-i18next |
| Icons | lucide-react |
| UI motion / drag reordering | framer-motion |
| Date formatting | date-fns |
| Markdown parsing | marked |
| Markdown serialisation | turndown |
| HTML sanitisation | DOMPurify |

## Module Map

```
src/
├── components/
│   ├── layout/       AppShell, LeftSidebarRail, LeftSidebarEntryList, RightSidebar, MainArea,
│   │                 SettingsModal, TabBar
│   │   └── titlebar/ TitleBar (custom window chrome), WindowControls, TitleBarMenuBar,
│   │                 MenuDropdown, TitleBarSearchButton, useIsMaximized, editCommands
│   ├── editor/       RichEditor, InternalLinkExtension,
│   │                 TagInput, ResizableImageExtension, ExternalDropExtension,
│   │                 EditorToolbar, LinkPickerModal, SuggestionList
│   ├── views/        HomeView, JournalView, WikiView, TagsView, AltarView,
│   │                 OperationsView, OperationSigilView, TrashView, TasksView
│   ├── sidebar/
│   │   ├── panels/   JournalPropertiesPanel, WikiPropertiesPanel, OperationPropertiesPanel,
│   │   │             AltarSidebarPanel, RoutinesPanel (currently unrendered), BacklinksPanel
│   │   │             (currently unrendered)
│   │   └── fields/   PropertiesReadView / PropertiesEditView (read vs. edit layout shell),
│   │                 PropertySummaryRow, Favicon, Banner,
│   │                 AltarReadingSummary, LinkedOpsInput, LinkedWikiInput, PlacedElementRow
│   ├── wiki/         WikiList (rendering + category emoji helper)
│   └── ui/           ListToolbar, FilterPanel, UndoToast, ContextMenu, ImportDestinationModal,
│                     Modal (shared modal wrapper), EmojiPicker (shared emoji-picker popover),
│                     Button (shared button — primary/secondary/ghost/danger variants, plus a
│                     separate tone-coded jade/amber/danger/neutral row-action mode),
│                     Dashboard (shared module-overview chrome: topbar/toolbar/filter/grouping),
│                     RailButton (icon-button for the sidebar rail), TabIconButton (active/idle
│                     tab toggle), EntryListTab (generic searchable/renameable/draggable list,
│                     shared by all five sidebar entry-list tabs)
├── store/            journalStore, wikiStore, uiStore, tagStore, operationStore, taskStore,
│                     altarStore, routineStore, undoStore,
│                     trashStore, vaultStore, importStore
├── hooks/            useCategoryEditor (shared add/edit/delete-with-confirm category logic,
│                                      used by TasksView, WikiView, OperationsView)
├── lib/              db.ts, schema.ts, normalizeSchema.ts, row.ts,
│                     links.ts, tabs.ts, dragState.ts, altarDragState.ts,
│                     routineDragState.ts, moonPhase.ts, export.ts, menuActions.ts,
│                     platform.ts,
│                     exportData.ts, emeraldFormat.ts, vaultManager.ts, dbBackup.ts,
│                     helpers.ts (incl. isImageIcon, generateId,
│                                      hexToRgb, isValidHexColor, readFileAsDataUrl,
│                                      ACCEPTED_IMAGE_MIME, isAcceptedImageFile),
│                     altarConstants.ts, altarExport.ts, styleClasses.ts,
│                     emojiSearchData/{en,de,es,fr}.json (localised emoji search datasets,
│                                      generated from emojibase-data, lazy-loaded per locale)
├── themes/           emerald-noctis.css, emerald-parchment.css, theme.ts
├── i18n/             react-i18next setup + locales/en.json de.json es.json fr.json
└── types/index.ts    Shared TypeScript interfaces

src-tauri/
└── src/
    ├── lib.rs           Tauri commands, native menu, mouse nav monitor, application setup
    └── pdf_export/      Native-webview PDF export (one file per platform, #[cfg(target_os)] dispatch)
        ├── mod.rs           #[cfg(target_os = "…")] re-export of the platform `export_pdf`
        ├── windows.rs       WebView2 + ICoreWebView2_7::PrintToPdf
        ├── macos.rs         WKWebView createPDFWithConfiguration
        └── linux.rs         WebKitGTK WebKitPrintOperation + gtk::PrintSettings, virtual "Print to File" printer resolved via FFI
```

## Key Architectural Patterns

### Known Boundary Caveat

`getCategoryEmoji` currently lives in `src/components/wiki/WikiList.tsx` and is imported by both UI and non-UI modules (for example export helpers). This works, but it is a layering compromise because a pure utility function is sourced from a component file. If category emoji mappings become more complex, move this helper into `src/lib/` (or a shared constants module) to keep library code independent from React component modules.

### Edit Mode Architecture

The main content area renders only the title and body. All metadata — tags, category, icon, cover image — is edited exclusively in the right sidebar's Properties panel. The sidebar writes directly to the relevant store; the main area subscribes to the same store fields and updates accordingly.

Unlike earlier versions, the Properties panel itself is now gated by the entry's edit state (`activeView.mode === 'edit'`): each panel renders a read-only summary (`PropertiesReadView` + `PropertySummaryRow`) while viewing, and swaps to editable form fields (`PropertiesEditView`) only once the entry is opened for editing. Entering/leaving edit mode is triggered from the sidebar's own action bar, not from the main content area.

### Right Sidebar Action Bar

`RightSidebar.tsx` renders a `RightSidebarActionBar` pinned above the scrollable Properties content, replacing what used to be separate Edit/Save/Cancel/Delete buttons duplicated in every entry view's header. The bar reads `uiStore.editActions` (set via `setEditActions({ onSave, onCancel, onDelete? })`) to know what to call — in edit mode it shows Done/Delete/Cancel; in view mode it shows Edit (plus a Fullscreen toggle for Altar); a loaded Sigil operation shows nothing, matching `OperationSigilView`'s existing edit-mode guard.

Each of the five entry views registers its handlers the same way:

```ts
const editHandlersRef = useRef({ onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
editHandlersRef.current = { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete };

useEffect(() => {
  if (!isEditing) return;
  setEditActions({
    onSave: () => editHandlersRef.current.onSave(),
    onCancel: () => editHandlersRef.current.onCancel(),
    onDelete: () => editHandlersRef.current.onDelete(),
  });
  return () => setEditActions(null);
}, [isEditing]);
```

The ref exists for the same stale-closure reason as the auto-save pattern below: `setEditActions` only needs to run when `isEditing` flips, not on every keystroke, but the handlers it registers must still see the latest `title`/`content`/etc. at call time. An earlier version of this effect had no dependency array and called `setEditActions` unconditionally on every render, which combined with a whole-store `useUIStore()` subscription in the same component to produce an infinite render loop (each `setEditActions` call re-rendered the subscriber, which re-ran the effect, which called `setEditActions` again) and a blank screen on startup. Keep the effect scoped to `[isEditing]` and keep sidebar-consuming components on per-field selectors (see Store Selectors above) to avoid reintroducing it.

### Store Selectors

Every component subscribes to individual store fields, never the whole store:

```ts
// correct
const entries = useJournalStore((s) => s.entries);

// wrong — re-renders on any store change
const store = useJournalStore();
```

This prevents unnecessary re-renders when unrelated fields change.

### Rules of Hooks

All `useState`, `useEffect`, `useRef`, `useMemo`, and `useCallback` calls must appear before any early `return` statement in a component. Hooks placed after a conditional return crash the app with a "rendered fewer hooks than expected" error. Move the hook above the condition and use the condition inside the hook's callback if needed.

### Category CRUD (shared hook)

`useCategoryEditor<C>(store, options)` in `src/hooks/useCategoryEditor.ts` extracts the add/edit/delete-with-confirm state and handlers for a module's category list — this logic was near-duplicated across `TasksView`, `WikiView`, and `OperationsView`. It takes the four category-store actions (`addCategory`, `updateCategory`, `deleteCategory`, `restoreCategory`) generically over any `{ id, name, emoji }`-shaped category type, plus a `defaultEmoji` and an optional `onAdded` callback (used by callers that need to auto-select or auto-save after a category is created). Delete-with-confirm pushes an undo entry via `useUndoStore`. Category creation failures are caught and logged consistently across all three call sites (previously only `TasksView` guarded against a failed `addCategory` call).

### Auto-Save (stale-closure-safe)

The editor writes the current title and content into a ref on every render. A debounced timer (1.5 s) reads from the ref when it fires, never from a closure. This means the save always uses the latest content regardless of when the timer was scheduled.

`triggerAutoSave()` takes no arguments. Callers must not pass a snapshot of `pendingRef.current` as an argument — doing so would capture stale state at call time and cause the debounced write to overwrite changes made between the call and the timer firing (for example, a sidebar category change made 200 ms after the title change would be lost). All three views that use this pattern (JournalView, WikiView, OperationsView) read `pendingRef.current` and `isEditingRef.current` exclusively inside the timer callback.

### Internal Links

`createInternalLinkExtension(getItems, getIcon, getLabel)` creates a TipTap extension that renders linked entries as inline chips. Callbacks are typed via the `InternalLinkOptions` interface (no `as any` cast) and are ref-backed so they always see the current store state. Each chip stores `data-type="internalLink"`, `data-id`, `data-entry-type`, `data-label`, and `data-icon` attributes.

Chips are rendered identically in both edit mode and view mode — the `[[Label(id)]]` raw-text edit representation was removed. The node view no longer tracks `editor.isEditable` via `useState`/`useEffect`; editability checks (e.g. click handling) read `editor.isEditable` directly at event time.

After every save, `syncLinks(sourceId, sourceType, htmlContent)` in `src/lib/links.ts` parses the saved HTML, deletes the old link rows for that source, and inserts fresh rows. This keeps the `links` table accurate without requiring a separate link-tracking mechanism.

Backlinks are fetched on demand by `fetchBacklinks(targetId)`, which joins the `links` table with each content table to return entry titles and types.

### Drag and Drop

Tauri's WKWebView does not pass HTML5 drag events to JavaScript. All drag-and-drop uses Pointer Events:

1. `onPointerDown` on the draggable element calls a setter in a module-level drag state module (e.g. `dragState.ts`, `altarDragState.ts`).
2. The drop target registers `pointermove` and `pointerup` listeners on `document` while a drag is in progress.
3. On `pointerup`, the target reads the drag state and applies the drop.

### Tabs and Workspace State

Emerald uses browser-like tabs to keep multiple pieces of content open at the same time. The tab state is managed in `uiStore`:

- `tabs` stores the list of open tabs.
- `activeTabId` stores which tab is currently selected.
- Each tab contains an `ActiveView`, so a tab can represent a journal entry, wiki article, operation, sigil, altar, or a top-level view.

Tab IDs and helper functions live in `src/lib/tabs.ts`.

Tabs are persisted in `localStorage` using:

- `open-tabs`
- `active-tab-id`

This keeps the user's workspace available after restarting the app without adding database tables or migrations.

Tab reordering is implemented in `src/components/layout/TabBar.tsx` with Framer Motion (`LazyMotion`, `Reorder.Group`, `Reorder.Item`). `Reorder.Group` emits the reordered tab ID list via `onReorder`, and `uiStore.setTabsOrder(ids)` validates the payload (length and uniqueness) before rebuilding the tab array and saving it through `saveTabs(...)`. Because `saveTabs` writes the full `tabs` array to `open-tabs`, tab order persists across restarts.

An overflowing tab bar scrolls horizontally on a vertical mouse-wheel gesture. `TabBar` holds a `ref` on the `Reorder.Group` element (it renders a `<ul>`) and, in a `useEffect`, attaches a native `wheel` listener with `{ passive: false }` — React's synthetic `onWheel` is passive, so `preventDefault()` there would not stop the page from also scrolling. The handler only acts when `scrollWidth > clientWidth` (tabs actually overflow) and `|deltaY| > |deltaX|` (so horizontal trackpad scrolling isn't also redirected into `scrollLeft`), then adds `deltaY` onto `el.scrollLeft`.

Closing a tab with a middle-click needs a second handler, not just `onAuxClick`: Chromium enters its native autoscroll/pan mode on a middle-click's `mousedown`, before `auxclick` ever fires, which felt like the close was fighting the pointer. Each tab's select button also calls `event.preventDefault()` on `onMouseDown` when `event.button === 1`, suppressing that native mode so the click purely closes the tab.

When `setActiveView()` is called while a tab is active, the current tab's view is updated. Opening content in a new tab creates a new tab with its own `ActiveView`. Selecting a tab restores that tab's view into the main area.

Tabs and navigation history are related but separate:

- Tabs represent the user's current workspace.
- Navigation history represents back/forward movement within that workspace.

This means users can keep several entries open while still using back/forward navigation inside the active tab context.

### Navigation History

`uiStore` maintains a `history` array and `historyIndex`. `setActiveView` pushes a new entry only when the type or id changes — switching between read and edit mode for the same entry is not recorded as a new step. Mouse back/forward buttons are handled by a macOS NSEvent local monitor in `lib.rs` that emits `navigate-back` and `navigate-forward` Tauri events; `AppShell` listens for these and calls `uiStore.navigateBack()` / `navigateForward()`.

### Left Sidebar (Rail + Entry List)

The left sidebar is two independent components rendered side by side inside `AppShell`'s `app-sidebar-left` container:

- **`LeftSidebarRail`** (`src/components/layout/LeftSidebarRail.tsx`) — a fixed-width (56px, `RAIL_WIDTH` in `AppShell.tsx`) icon column: the entry-list collapse/expand toggle, the right-sidebar collapse/expand toggle (sharing the `PanelToggleIcon` component via a `mirrored` variant so the two icons read as left/right mirrors), then the six navigation icons (Home/Journal/Tasks/Operations/Wiki/Altar), and a bottom nav block: Tags/Trash grouped together, then — below a divider — Vault (opens `VaultModal`) and Settings. The app logo, back/forward and the search shortcut are *not* here; they moved into the title bar (see [Window Chrome](#window-chrome)). The nav icons only call `setActiveView(...)` — they carry no active/selected styling and are intentionally decoupled from `leftListTab` below, since navigating the main view and browsing a different module's entry list are independent actions. Home is the one whose target is not a content view: `isContentView` is false for it, so it overwrites the active tab rather than opening a new one. Note for MCP selectors that lucide exports `Home` as an alias of `House`, so its SVG carries `.lucide-house`, not `.lucide-home`.
- **`LeftSidebarEntryList`** (`src/components/layout/LeftSidebarEntryList.tsx`) — the adjoining panel, shown only while `uiStore.leftListOpen` is true. Its six tabs (`TabIconButton`) write to `uiStore.leftListTab`; the active tab determines which list renders below: five per-module lists (`JournalList`, `TasksList`, `OperationsList`, `WikiList`, `AltarList`) plus `AllList`, which combines all five into one list sorted by `updated_at` descending. Each per-module list is a one-line `<EntryListTab {...config} />` wrapper around a `use*Config()` hook (`useJournalConfig`, `useTasksConfig`, `useOperationsConfig`, `useWikiConfig`, `useAltarConfig`) returning an `EntryListTabProps<T>` object; `AllList` calls all five hooks and flattens their configs through `toAllRows()` into type-erased `AllRow` objects, so the combined list reuses each module's real handlers (duplicate, delete-with-undo, rename, context menu) rather than reimplementing them. `EntryListTabProps<T>` itself is the shared contract with `EntryListTab<T>` (`src/components/ui/EntryListTab.tsx`), which owns search filtering, inline rename, the "+" quick-create flow, drag-start wiring, and the right-click `ContextMenu`; callers supply accessor functions (`getId`/`getTitle`/`getIcon`/`getDateStr`) and the action list. Tasks is the one caller that needs a materially different row (an independent checkbox toggle) and opts out via the `renderRow` render-prop instead of the accessor props — which also means `renderRow` cannot survive `toAllRows()`'s type erasure, so Tasks fall back to the plain accessor-based row inside `AllList`. `EntryListTab` also takes an optional `canDrag(item)` gate so a mixed list can withhold the grab cursor from rows that aren't drag sources (Tasks, Altar) while still allowing it for the rest.

`AppShell` owns the width/resize logic: the rail is fixed at `RAIL_WIDTH`, and only the entry-list panel's width (`entry-list-width` in `localStorage`, `ENTRY_LIST_MIN` = 180) is user-resizable via the same drag-handle pattern used for the right sidebar. The outer `<aside>` width is computed as `RAIL_WIDTH + (leftListOpen ? entryListWidth : 0)`, and the resize handle only renders while the list is open.

**Both defaults are derived, not chosen.** `ENTRY_LIST_DEFAULT` is `ENTRY_LIST_TABS_WIDTH`, exported by `LeftSidebarEntryList` and computed from the tab strip's own geometry (`12*2 + 6*32 + 5*2` = 226px), so the list opens exactly wide enough for its six tabs and no wider. `RIGHT_DEFAULT` is `RAIL_WIDTH + ENTRY_LIST_DEFAULT` (282px), so the right sidebar matches the whole left side rather than an unrelated round number. Both keys are only ever written on drag-end, so an installation that never resized has no key at all and picks the derived defaults up on its own; one that did resize keeps the width it was dragged to.

The tab strip is `flex-wrap` with `min-h-14` rather than a fixed `h-14`: dragged narrower than 226px it breaks into a second row instead of running silently past its edge. Flexbox decides that on its own — no threshold, no `ResizeObserver`, nothing that could oscillate. The cost is that `RightSidebarActionBar`'s deliberately matching `h-14` no longer puts the two sidebars' bottom borders on one line while the strip is wrapped; the comment on `ACTION_BAR_CLASSES` records that. `TabIconButton` carries `border border-transparent` in its idle state so an active tab's 1px themed border does not make it 2px wider than its neighbours — without it the row jittered on every tab switch and the six tabs no longer fit their own default width. The 226px is exact only at a 16px root font size; the utilities underneath are rem-based, so a WebKitGTK build under GTK text scaling can wrap at the default width too. That degrades into the handled case rather than a broken one.

Opening and closing either sidebar animates `width` (200ms) via the `.app-sidebar-animated` CSS class in `index.css` — a class rather than an inline `transition` style, so the `prefers-reduced-motion` override sitting right after it in the stylesheet can win by source order instead of losing to inline specificity. `AppShell`'s `resizing` state removes the class for the duration of a drag so the edge cannot lag the pointer. Both asides are `overflow-hidden` and their content keeps its pixel width inside them — the left row is sized `RAIL_WIDTH + entryListWidth`, the right content is `absolute right-0` at `rightWidth` — so the content is clipped rather than squeezed, which is also what stops the tab strip wrapping mid-animation. The right sidebar's divider line sits on that content element, not on the `<aside>`, or it would remain as a 1px stripe at the window edge when collapsed to zero. `useDeferredUnmount` keeps each panel mounted for the length of the animation and drops it afterwards (a timeout, not `transitionend`, so it still fires when `prefers-reduced-motion` removes the transition) — `AllList` calls all five module config hooks and `AltarSidebarPanel` brings its own effects and drag listeners, neither of which should run while invisible. While a panel is closed but still mounted for the animation, its wrapper carries `inert` and `aria-hidden` so it stays out of both focus order and the accessibility tree — `inert` alone is a no-op on older WebKit, hence both.

## Data Flow

```
SQLite (emerald.db)
    ↓  read on startup (getDb + runMigrations)
    ↓  fromRow.* (row.ts)
Zustand stores (in-memory)
    ↓  React subscriptions
Components (render)
    ↓  user edits
Store actions (updateEntry, updateOperation, …)
    ↓  toInt / toJson (row.ts)
    ↓  db.execute / db.select
SQLite (persisted)
```

Stores are the single source of truth for in-memory state. Components never query SQLite directly. All SQL happens inside store action functions in `src/store/*.ts`.

`src/lib/row.ts` sits on both edges of that flow and is the only place that translates between SQLite rows and the types in `src/types`. SQLite has neither booleans nor arrays — booleans arrive as the numbers `0`/`1`, arrays as JSON text — so something has to convert, and doing it per store is how the same field ended up holding a number in one code path and a boolean in another.

The schema itself lives in `src/lib/schema.ts`, not in `db.ts`: fresh vaults execute that DDL directly, existing ones reach the same shape through the migration chain and the rebuild in `normalizeSchema.ts`. `npm run check:schema` builds a vault each way and compares them. See [`database.md`](database.md) for the details.

## Image Storage System

Images are content-addressed, stored outside SQLite, and belong to one vault.

- **Location**: `{vaultDir}/images/{sha256}.{ext}`. The vault directory is wherever the user put it — see [Vault Layout](#vault-layout).
- **What the database stores**: the bare filename. No directory, no drive letter. That is what makes a vault folder copyable to another machine, and why the backup importer no longer has to rewrite absolute paths into local ones.
- **Insert path**: `save_image` (data-URL) and `copy_image_file` (a file on disk) decode, hash, write into the active vault's folder if absent, and return the filename. Both are reached through `src/lib/images.ts`, never invoked directly.
- **Display path**: the `emerald-img` URI scheme. `imageSrc(filename)` builds `emerald-img://localhost/{vaultId}/{filename}` — on Windows `http://emerald-img.localhost/{vaultId}/{filename}`, since WebView2 serves custom schemes over `http` — and the webview fetches the bytes itself. No IPC round trip, no base64, no data-URL cache: the two module-level `Map`s that used to hold every displayed image for the length of a session are gone, along with `useAltarBackgroundPreview.ts`.
- **Caching**: the handler answers with `Cache-Control: max-age=31536000, immutable`. The filename *is* the hash of the content, so a given URL can never return anything else.
- **Canvas access**: the altar export draws its images onto a canvas and reads it back with `toBlob()`, which only works while nothing foreign is on that canvas. Images served over a custom scheme *are* foreign, so that one path does not use the scheme at all — `canvasImageSrc()` fetches the bytes as a data-URL instead, which counts as the page's own source on every engine. The handler still sends `Access-Control-Allow-Origin: *`, but nothing depends on it any more.

  The earlier approach — the CORS header plus `img.crossOrigin = 'anonymous'` — worked on WebView2 but rested on an assumption that could not be checked from a Windows host: wry registers a custom scheme as *secure* and never as *CORS-enabled*, so whether WebKitGTK and WKWebView honour the header for it was unknown. The failure would have been silent, with the export simply producing nothing. The data-URL detour costs one IPC round trip per image, on export and thumbnail capture only.
- **Deduplication**: per vault. The same image in two vaults is two files — isolation is worth more than the bytes.
- **Cleanup**: Settings → Storage → *Unused images*, on demand. `findUnusedImages()` diffs `list_image_files` against `collectUsedImageFilenames(db)`. Deliberately not automatic: an image that so far only exists in an unsaved editor buffer would count as unused. The predecessor `cleanup_unused_images` had to be removed because one image directory served every vault while the used-set came from one of them; per-vault folders are what make the check safe again.
- **Legacy pool**: `{appDataDir}/images/` still holds everything written before the per-vault layout. Migration v35 copies each referenced file into its vault, and the protocol handler falls back to the pool for anything it missed. Nothing writes there any more, and the cleanup action never proposes deleting from it — vaults that have not been opened since the migration still read from it.

## Vault Layout

A vault is a directory: `emerald.db` and `images/` inside it, nothing else. The user picks where it lives, so a vault can sit in Documents, in a synced folder, or on another drive.

`{appDataDir}/vaults.json` maps ids to directories:

```json
{
  "version": 2,
  "vaults": [{ "id": "uuid", "name": "My Vault", "path": "…/Documents/Emerald/My Vault", "createdAt": "…", "icon": "🌿" }],
  "activeVaultId": "uuid"
}
```

`version` stays `2` even though `icon` is new: nothing reads the version field, and records travel through `vaultManager.ts` whole (`vaults.push(entry)`, `{ ...v, ...patch }`), so a field a newer build wrote survives an older build round-tripping the file untouched. It would only need bumping for a change that needs *handling*, not per field added.

A genuinely fresh installation starts with an **empty** vault list and no `activeVaultId` — there is no guaranteed `default` entry any more. `readVaultsFile()` only synthesizes one when `vaults.json` is missing *and* `legacy_default_db_exists` finds a database from before multi-vault support (`app_config_dir`, `app_data_dir`, or the migration target below); an empty list from a user who removed every vault is left empty, not repopulated. `getActiveVaultPath()` throws `NO_ACTIVE_VAULT` rather than falling back to `vaults[0]` — falling back would silently open a different vault under the wrong id. `AppShell` gates on vault membership (`vaults.some(v => v.id === activeVaultId)`, not list length, since `switchVault` rolls `activeVaultId` back to `''` on a failed open) and, while it fails, mounts only the title bar plus a non-dismissible `VaultModal` — every other component would call `getDb()` and hit that error.

- **`vaultManager.ts`** owns that file and is its only writer. Every write calls `register_vaults`, which mirrors `id → path` into Rust state.
- **Commands take a vault id, never a path.** `vault_dir()` resolves the id against the registry. A path handed in over IPC, or read out of stored content, is not evidence that the user authorised it.
- **`resolve_allowed_roots()`** deliberately leaves the registered directories out — see [`security.md`](security.md). Vault storage resolves by id and never consults those roots, so a vault outside `~` works in full; only writing a *document* into such a folder is out of reach — and `document_dir()` is itself one of the allowed roots, so that only bites a vault placed somewhere else entirely, not the default location below.
- **Creating vs. opening**: `create_vault_dirs` builds the tree and is called once, from `addVault`. `ensure_vault_dirs`, called on every `getDb()`, deliberately does *not* create — SQLite would happily put a fresh empty database into a recreated folder, so a vault on an unplugged drive would come back as an empty vault instead of an error.
- **Not there vs. not allowed**: `directory_state()` separates the two, because `is_dir()` collapses them. On macOS a folder under `~/Documents`, `~/Desktop` or iCloud is readable only after the user grants access — the app is not sandboxed, so picking it in a dialog grants nothing by itself. `probe_vault_dir` reports that as `denied`, and the vault modal says "no access" rather than "not found", which is the difference between "look elsewhere" and "allow it".
- **The `.db` path**: `getDb()` loads `sqlite:{vaultDir}/emerald.db`. `tauri-plugin-sql` joins its connection string onto the app directory with `PathBuf::push`, and an absolute path replaces the base outright, so a full path lands where it says.
- **Where a new vault defaults to**: `new_vault_base_dir` returns `{documentDir}/Emerald` (falling back to `{appDataDir}/vaults` where the platform has no documents folder), and the vault modal joins the vault's name onto it, sanitized by `vaultFolderName()` — separators, `..`, the Windows-reserved characters, and reserved device names stripped or suffixed. The device-name check runs against the name's stem before its first dot, so `CON.txt` is caught the same as `CON`, and includes the two console streams `CONIN$`/`CONOUT$`. The result is then capped at 200 UTF-8 bytes without splitting a character: ext4 and APFS limit a path component in bytes, NTFS in UTF-16 units, and a name built from emoji can cross the byte limit long before the character limit. This is deliberately a *different* function from `default_dir_for` / `default_vault_dir` below: that one is the migration target and has to keep pointing at `{appDataDir}/vaults/{id}` for every installation that has not moved yet, and it still backs the `add-vault` backup import, where an id-named folder is what keeps two same-named imports from colliding.
- **Opening and relocating go through the `.db` file, not the folder.** A folder dialog lists no files, so nothing shows whether a chosen folder actually holds a vault before confirming; a dialog filtered to `.db` does. The vault's directory is the file's parent. On macOS, choosing a file inside `~/Documents`, `~/Desktop` or iCloud does not by itself grant access to *list* that folder (TCC) — `probe_vault_dir` reports `denied` for it, and the vault modal says "no access" rather than a misleading "no vault here".

### Migrating an older installation

Vaults used to be flat files — `emerald.db` and `emerald-{uuid}.db` side by side in the app directory, sharing one `images/` folder. Two steps lift them:

1. **`migrate_vault_layout`**, triggered from `loadVaultsFile()` when a record still carries `dbName` instead of `path`. It moves the database into `{appDataDir}/vaults/{id}/` and returns the directory. Not a SQL migration — the file moves before anything opens it. Idempotent, and `vaults.json` is only rewritten once the move succeeded.
   The two legacy locations are not the same folder everywhere: `tauri-plugin-sql` joined onto **`app_config_dir`**, the image pool was written to **`app_data_dir`**. Windows and macOS resolve both to one directory; on Linux they are `~/.config/…` and `~/.local/share/…`, so both are searched.
2. **Migration v35 `vault_scoped_images`**, once the database is open. It copies the referenced images out of the shared pool (`adopt_legacy_images`) and rewrites every absolute path down to its filename — in the `html` and `plain` columns of `IMAGE_FIELDS`, not the `legacy` ones. If a copy fails the rewrite still happens — the handler's legacy fallback keeps the image visible; the reverse would lose it.

## Theming System

Emerald uses CSS custom properties scoped to `html[data-theme]` for all visual theming. Two named themes ship with the app: **Emerald Noctis** (dark, default) and **Emerald Parchment** (light).

### Architecture

```
src/themes/
├── emerald-noctis.css      # Dark theme — applied to :root and [data-theme='emerald-noctis']
├── emerald-parchment.css   # Light theme — applied to [data-theme='emerald-parchment']
└── theme.ts                # Theme helpers: DEFAULT_THEME_ID, THEME_OPTIONS, normalizeThemeId, applyTheme
```

Each theme file defines the same set of CSS custom properties. Components reference these variables rather than hardcoded colours. The Noctis theme is attached to both `:root` and its `data-theme` selector, making it the visual default when no theme attribute is present. Parchment is scoped only to its `data-theme` selector.

### Token Strategy

CSS custom properties follow a tiered naming convention:

| Tier | Prefix | Purpose | Examples |
|---|---|---|---|
| **Core surfaces** | `--bg-*` | App background, surface layers, elevated panels | `--bg-app`, `--bg-surface-1`, `--bg-surface-2`, `--bg-elevated` |
| **Text** | `--text-*` | Text colour hierarchy from primary to subtle | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle` |
| **Borders** | `--border-*` | Divider and edge styling | `--border-soft`, `--border-strong` |
| **Interactive** | `--interactive-*` | Hover and active state backgrounds | `--interactive-hover`, `--interactive-active` |
| **Accent** | `--accent*` | Primary action colour and contrast | `--accent`, `--accent-strong`, `--accent-contrast`, `--focus-ring` |
| **Component** | `--<component>-*` | Per-component tokens for complex UI | `--link-chip-*`, `--editor-*`, `--menu-*`, `--panel-*`, `--tab-*`, `--settings-*`, `--danger-*`, `--select-option-*`, `--linked-chip-*` |
| **Shell** | `--shell-*`, `--sidebar-*` | Top-level layout backgrounds | `--shell-bg`, `--sidebar-bg` |
| **Utility** | `--scrollbar`, `--code-bg` | Shared utility tokens | `--scrollbar`, `--scrollbar-hover`, `--code-bg` |

When adding a new themed component, define component-scoped tokens (e.g. `--my-component-bg`) in both theme files and reference them from CSS. Avoid adding hardcoded colours to component stylesheets.

### Normalization Flow

Theme resolution follows this pipeline in `src/themes/theme.ts`:

```
localStorage ('theme-id' or legacy 'theme')
    ↓
normalizeThemeId(raw)
    ├─ raw is a valid ThemeId → return as-is
    ├─ raw === 'light'        → return 'emerald-parchment'
    └─ anything else          → return DEFAULT_THEME_ID ('emerald-noctis')
    ↓
applyTheme(themeId)
    ↓
document.documentElement.dataset.theme = themeId
```

`uiStore` calls `loadSavedTheme()` at initialization, which reads `localStorage.getItem('theme-id')` first, then falls back to the legacy `'theme'` key. `setTheme()` writes to `theme-id` only — the legacy key is never written to again.

### Theme application

`App.tsx` subscribes to `uiStore.theme` and calls `applyTheme(themeId)` on every change:

```ts
// App.tsx
const theme = useUIStore((s) => s.theme);
useEffect(() => { applyTheme(theme); }, [theme]);
```

`applyTheme` sets `document.documentElement.dataset.theme = themeId`, which activates the matching `html[data-theme='…']` CSS rules.

### Theme selection and persistence

`uiStore` stores the current theme as `ThemeId` (`'emerald-noctis' | 'emerald-parchment'`). The Settings modal renders the theme picker from `THEME_OPTIONS` exported by `theme.ts`.

### Tailwind bridge

Because the app uses many Tailwind utility classes with hardcoded stone/jade colours, `src/index.css` contains a large Tailwind bridge section that overrides those classes under each `html[data-theme='…']` selector. This ensures that classes like `.bg-stone-900`, `.text-stone-100`, and `.border-stone-700` map to the correct theme variables. Both themes require bridge overrides — Noctis for jade accent adjustments and component-specific refinements, Parchment for the full light-mode colour mapping.

The Parchment bridge is organised into feature-scoped comment blocks at the end of `src/index.css`. The Altar module has its own block covering: sidebar control button backgrounds and borders, danger-button colours (mapped to `--danger-*` variables), jade CTA/fullscreen buttons (solid green), the slider track colour (warm translucent brown), the format-picker hover state, the `AltarReadingSummary` item-preview area background, the `from-stone-900` gradient-from colour used by category scroll-fade overlays, and the `.altar-cat-scroll-fade` utility class which sets a wider fade width (`3.5rem`) in Parchment. When new Altar controls are added that use hardcoded Tailwind classes, append their overrides to this Altar block rather than scattering them through the file.

### Adding a new theme

1. Create `src/themes/emerald-<name>.css` with all required custom properties (copy an existing file as a template).
2. Add the theme ID to the `ThemeId` union in `src/store/uiStore.ts`.
3. Register it in `THEME_OPTIONS` and add any legacy mapping in `normalizeThemeId` in `src/themes/theme.ts`.
4. Import the new CSS file from `src/main.tsx` (or add it to `index.html`).
5. Add Tailwind bridge overrides in `src/index.css` under `html[data-theme='emerald-<name>']` for any hardcoded utility classes the theme needs to override.

### Shared style constants

Two modules centralise reusable Tailwind class strings to avoid duplication across components:

- **`src/lib/styleClasses.ts`** — Shared select class string for operation properties (`OP_PROP_SELECT_CLASSES`). The former `CUSTOM_PROP_INPUT_CLASSES`/`CUSTOM_PROP_SMALL_INPUT_CLASSES` were removed along with Custom Properties.
- **`src/lib/altarConstants.ts`** — Altar background presets (`ALTAR_BACKGROUND_PRESETS`, `ALTAR_BACKGROUND_STYLES`), photographic image presets (`ALTAR_IMAGE_PRESETS` — a readonly tuple of 16 preset names; `AltarImagePresetName` type), the default background (`DEFAULT_ALTAR_BACKGROUND`), canonical grid defaults (`DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`), the background overlay defaults (`DEFAULT_BACKGROUND_OVERLAY` = `0.2`; `DEFAULT_OVERLAY_COLOR` = `'dark'`), and the resolution system: `DEFAULT_ALTAR_RESOLUTION` (`'1920x1080'`), `BASE_RESOLUTION_WIDTH` (1920), `MAX_ALTAR_RESOLUTION_W` (7680), `MAX_ALTAR_RESOLUTION_H` (4320), `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `sizeAndRatioFromResolution`, `parseResolution`, `resolveResolutionPixels`, `isRatioFormat`, and `ratioFromResolution`. `resolveResolutionPixels(res)` is the preferred helper when the input may be either a ratio string or a pixel string: ratio inputs are mapped to their `ALTAR_RESOLUTION_MAP.lg` canonical pixel size first, then passed through `parseResolution`; pixel inputs go straight to `parseResolution`. All dashboard-facing code (`AltarCard`, `AltarCardPreview`, `AltarCanvas` thumbnail renderer) must use `resolveResolutionPixels` rather than calling `parseResolution` directly on `altar.resolution`. Also exports `getAltarBackgroundStyle(altar, imageSrc)` — the **single source of truth** for constructing the altar CSS background object; it accepts the altar record (to read `background_overlay` and `background_overlay_color`) and prepends a `buildOverlayGradient(opacity, color)` layer when the overlay value is greater than 0. The overlay layer is applied to **all** background types: custom images, image presets, gradient-color presets, and legacy colour presets. For custom image-backed backgrounds it interpolates `backgroundSrc` into CSS whenever it is non-empty — that value has to come from `imageSrc()`, which is what narrows it to a stored image or an inline source; for image presets it constructs a `url("/backgrounds/{name}.webp")` CSS background; for gradient presets it prepends the overlay to the `generateGradientStyle(hex)` result; for colour presets it prepends the overlay to the value from `ALTAR_BACKGROUND_STYLES`. Unknown preset values fall back to `DEFAULT_ALTAR_BACKGROUND`. All components that need a background style must call this function rather than constructing the CSS inline. Gradient-colour preset helpers: `GRADIENT_PRESET_COLORS` (readonly tuple of 7 dark hex values used as colour-gradient presets), `LEGACY_GRADIENT_COLORS` (maps each preset name to its base hex value), `isGradientPreset(preset)` (returns true when the preset string matches one of the gradient preset names), `getGradientColor(preset)` (returns the hex string for a gradient preset or `null` for unknown inputs), and `generateGradientStyle(hex)` (builds the radial-gradient CSS string from a hex colour). These are used internally by `getAltarBackgroundStyle` and by `AltarSidebarPanel` to render the gradient swatch buttons. Category emoji helpers: `CATEGORY_EMOJIS` (a `Record<string, string[]>` of emoji suggestions keyed by default category name), `FALLBACK_CATEGORY_EMOJIS` (fallback array used when no entry matches a custom category name), and `ALTAR_CAT_EMOJIS` (flat palette array for the category emoji picker). `ALTAR_CATEGORIES` and `ALTAR_CATEGORY_EMOJI` have been removed — the authoritative category list is now stored in the `altar_categories` database table and loaded via `altarStore.fetchCategories()`. The SQL migration defaults for altar grid, resolution, and overlay columns must stay in sync with the constants in this file. `parseResolution` validates the input string against `/^\d+x\d+$/` and clamps both dimensions before returning `{ w, h }`. `isRatioFormat` tests whether a string is a ratio (e.g. `"16:9"`). `ratioFromResolution` returns the matching `AltarRatio` for either format.

## Altar UI Composition

Altar rendering and editing were split into focused components:

- **`src/components/altar/AltarItemVisual.tsx`** — shared visual renderer for altar items (emoji/image and candle animation treatment).
- **`src/components/altar/AltarCanvas.tsx`** — canvas scene rendering, placement transforms, drag/drop interactions, lock handling, and grid overlay drawing. The internal `_renderAltar(altar, backgroundSrc, placements, nativeW, nativeH, outW)` function owns the off-screen canvas draw pipeline and is shared by two exported helpers: `captureCurrentAltar(): Promise<string | null>` renders at 640 px wide with adaptive JPEG/WebP quality (0.85 → 0.65 → 0.45) capped at 512 KB — used for dashboard thumbnails, safe to call after unmount; `exportCurrentAltarImage(format?: 'jpeg' | 'png' | 'webp'): Promise<string | null>` renders at the full native resolution with no size limit — used by `saveAltarImage()` in `src/lib/altarExport.ts`, which backs the native menu's Export → Export as Image items. The `format` parameter (default `'jpeg'`) controls the output encoding: JPEG at quality 0.97, WebP at quality 0.92, PNG lossless. `captureCurrentAltar` reads altar state from `useAltarStore.getState()` synchronously and is safe to call from a `useEffect` cleanup. The `captureRef` prop mechanism that previously threaded a capture callback through the component tree was removed in favour of these module-level exports. `_renderAltar` draws the grid after the overlay pass (step 3) using the same `resolveResolutionPixels` + `grid_size` → `numCols`/`numRows` arithmetic as the live SVG grid, so captured images and thumbnails are pixel-consistent with the on-screen grid.
- **`src/components/altar/AltarLibraryStrip.tsx`** — docked library strip under canvas (edit mode), compact tiles, and modal CRUD for altar items. The add/edit item dialog is implemented as an `ItemModal` sub-component and the add/edit/delete category dialog as a `CategoryModal` sub-component; each manages its own form state independently. `CategoryModal.save()` wraps the store call in try/catch; a `nameError` state displays the rejection message (e.g. "Category already exists") inline under the name input and clears automatically when the user resumes typing. The strip itself holds only strip-level state (selected tab, library height, drag/reorder state, scroll fade state). `LIBRARY_DEFAULT_HEIGHT` and `UNCATEGORIZED_TAB` are module-scope constants. Category tab drag-to-reorder uses Pointer Events (not HTML5 drag API) for Tauri/WKWebView compatibility. The FLIP animation (`applyFlipAndUpdate`) snapshots tab positions before the state update, applies inverse `translateX` transforms after the DOM updates via `flushSync`, then removes them in a `requestAnimationFrame` tick with a `transition: transform 150ms ease` so tabs visually slide to their new positions. `dragCatIdRef`, `tabRefs`, `liveOrderRef`, and `lastHoverIdRef` coordinate drag state without stale closures; the `pointerup` handler reads the final order from `liveOrderRef` and calls `useAltarStore.getState().reorderCategories(finalOrder)`. The category scroll container hides its scrollbar (`scrollbar-none`) and shows left/right gradient fade overlays (`transition-opacity duration-150`) when content overflows in that direction; `checkCatScroll()` is called on `onScroll` and via `useEffect` after `displayCategories` changes. The `+ Category` button is placed outside the scroll container so it remains visible at all scroll positions.
- **`src/components/altar/AltarCard.tsx`** — `AltarCard`, `AltarListRow`, and `buildAltarContextMenuActions` — a plain function (not a component) that returns the action list for the altar dashboard context menu. `AltarCard` and `AltarListRow` render the saved thumbnail (`thumbnail_data`) when it is present and is anything `imageSrc()` resolves; otherwise they fall back to `AltarCardPreview`. The thumbnail area is capped at `max-h-44` in card view. `resolveResolutionPixels` is used (not `parseResolution`) to derive aspect ratio values from the stored resolution string.
- **`src/components/altar/AltarCardPreview.tsx`** — preview scene used by the dashboard cards and list rows (background + placed items, both compact and full-size variants).
- **`src/components/altar/AltarRenameField.tsx`** — inline rename input used by the dashboard cards and list rows.
- **`src/components/sidebar/fields/PlacedElementRow.tsx`** — `PlacedElementRow` and `PlacedElementInspector` for the sidebar's placed-elements list and its inline inspector. `PlacedElementRow` manages its own right-click context-menu state (position + portal render via `createPortal`). The delete button is in the row (Trash icon, rightmost). `PlacedElementInspector` shows a compact 4-column input grid (X, Y, Rot, Scale) plus a custom jade opacity slider (track/fill/thumb with a transparent range overlay). Inspector fields, labels, and unit symbols (`%`, `°`) use stone colour tokens; jade is used only for the selected row highlight (border and background) and the slider fill/thumb. Z-order buttons are not in the inspector — layer order is set by dragging rows in `AltarSidebarPanel`. A `focusedFieldRef` (`useRef<string | null>`) tracks which input is currently focused; the `useEffect` that syncs placement values from the store into draft state depends on all relevant placement fields (`x`, `y`, `width`, `height`, `rotation`, `opacity`, `id`) and skips updating the focused field so canvas drag-resize does not overwrite mid-edit input.
- **`src/components/sidebar/fields/AltarReadingSummary.tsx`** — read-only sidebar panel shown in altar view mode. Displays a "Enter Fullscreen" button at the top, then a compact summary grid: aspect ratio, background (with swatch preview), overlay (percentage + color), grid (active/inactive + size), and placed element count. Resolves background info (preset name, gradient color, or custom image preview) via `useMemo` and the same constants used by the full editor. It no longer contains an image-export control — that moved to the native Export menu (see `src/lib/altarExport.ts` and [Menu enablement gating](#menu-enablement-gating)).

Supporting hooks:


**Altar grid rendering.** The grid overlay is rendered as a single SVG `<path>` element (not a CSS tiled background). Line positions are computed as exact percentages — `(i / gridNumCols) * nativeW` for vertical lines, `(i / gridNumRows) * nativeH` for horizontal lines — drawn in a single `<path d="…">` string via `useMemo`. This eliminates sub-pixel rounding errors that accumulate in tiled `background-size` approaches, particularly on Retina displays.

Grid cell count (`gridNumCols`, `gridNumRows`) is derived from a **stable reference resolution** computed once per altar resolution change via `resolveResolutionPixels(resolution)`, not from the live container dimensions. This means the number of grid lines does not change when the window is resized — the grid scales visually with the canvas exactly as placed items do.

The same reference values drive all snapping logic:

- **Position snap** step sizes are `100 / gridNumCols` and `100 / gridNumRows` in percentage units, so snapped positions always land exactly on a grid line.
- **Scale snap** computes N (number of cells to span) from the item's display width in reference pixels (`gridCellW = refW / gridNumCols`), rounds N to the nearest even integer, then applies that same N to both width and height using `gridCellH = refH / gridNumRows`. Items therefore snap as square-cell boxes aligned on both axes.

`gridCellW`, `gridCellH`, and `gridScaledBase` are derived values computed at component level from `refW`/`refH`; they are not recomputed per pointer event.

**Altar canvas scaling model.** The canvas container in `AltarView` is rendered at the altar's native resolution. A `ResizeObserver` on the viewport div handles two resolution formats stored in `altars.resolution`:

- **Ratio format** (e.g. `"16:9"`): `nativeW` and `nativeH` are computed from the current viewport size so the canvas fills the viewport at the given proportion. `scale` is set to `1`; only `offsetX` and `offsetY` center the canvas.
- **Pixel format** (e.g. `"1920x1080"`): a uniform CSS `scale` factor (`Math.min(vw/nw, vh/nh)`) is computed; `nativeW`/`nativeH` are fixed. `offsetY` is 0 in normal mode and `(vh − nativeH × scale)/2` in full-window mode.

Both formats store the result as `canvasTransform` (`{ scale, offsetX, offsetY, nativeW, nativeH }`) with a default of `{ scale:1, offsetX:0, offsetY:0, nativeW:1920, nativeH:1080 }` to avoid a flash on first render. The canvas container receives `transform: translate(offsetX, offsetY) scale(scale)` with `transform-origin: 0 0`. `AltarCanvas` receives `resolution` (raw string), `nativeW`, `nativeH` (already resolved by the observer), and `cssScale`. `canvasScale` is derived from `nativeW / BASE_RESOLUTION_WIDTH` directly inside `AltarCanvas`, so `parseResolution` is no longer called there. Handle sizes are divided by `cssScale` so they appear at a constant screen-pixel size. Placement coordinates (`x/y`) remain percentage-based (0–100).

Store integration details:

- `uiStore` provides altar scene UI controls (fullscreen toggle). Grid settings were moved out of `uiStore` in 0.1.3 — see below.
- Altar screens consume `uiStore` with granular selectors to reduce unrelated rerenders.
- `altarStore` is the source of truth for altar records, items, placements, placement patch clamping, per-altar grid/snap configuration, and the item category list. The store holds a `categories: AltarCategory[]` slice and exposes five category actions: `fetchCategories` (loads all rows from `altar_categories` ordered by `sort_order ASC, created_at ASC, name ASC`), `addCategory` (inserts a new row with `sort_order = MAX(sort_order) + 1` and appends to the slice), `updateCategory` (updates name and emoji in the DB; no cascade is needed since `altar_items.category_id` holds the ID, which a rename does not change), `deleteCategory` (moves the category's items to `other` via `reassignCategoryContent`, then removes the row — a foreign key with `ON DELETE RESTRICT` would otherwise refuse the delete), and `reorderCategories(ids: string[])` (writes a new `sort_order` for each category ID in the provided array and re-sorts the in-memory slice to match). `fetchCategories` is called automatically at the start of `fetchAltars`. The store also exposes `clearActiveAltar`, `bumpAltarUpdatedAt`, `updateAltarGrid`, `updateAltarResolution`, and `duplicatePlacement` actions. `bumpAltarUpdatedAt` updates only the `updated_at` column on placement edits. `updateAltarGrid(id, patch)` is the sole write path for all eight altar settings fields (grid_enabled, grid_size, grid_opacity, grid_color, snap_to_grid, rotation_snap_enabled, rotation_snap_angle, snap_scale_to_grid); it clamps all numeric values, validates the hex color, sets `updated_at`, and sorts the in-memory altar list by `updated_at`. `updateAltarResolution(id, resolution)` accepts either a ratio string (e.g. `"16:9"`) or a pixel string (`"WxH"`): ratio strings that are valid `AltarRatio` values are stored as-is; pixel strings are passed through `parseResolution` for clamping. Changing the resolution also sets `thumbnail_data = NULL` in SQL and clears the field in memory so the dashboard does not display a stale thumbnail at the old aspect ratio. `duplicatePlacement(id)` inserts a new row into `altar_placements` with a fresh UUID, copies width/height/rotation/opacity from the source, positions it +2% in both axes (capped at 100), assigns `z_index = max + 1`, sets locked and hidden to false, and immediately selects the new element. `updateAltar(id, patch)` applies the patch on top of the current live record inside the Zustand `set()` callback — it does not compute the merged object before calling `set()`. This is required because two rapid `updateAltar` calls (e.g. title then thumbnail from `handleDone`) must each see the previous call's result, not a shared pre-computed snapshot.
- `AltarSidebarPanel` manages drag-to-reorder Z-order via Pointer Events directly (no dedicated store action): on pointer-up it reads the final visual order from `visualPlacementsRef` and calls `updatePlacement(id, { z_index })` for each element whose index changed. A `visualPlacements` `useMemo` computes the reordered list during the drag gesture; `visualPlacementsRef` is kept in sync via `useEffect` to avoid stale closures inside the `pointerup` handler. (`visualPlacementsRef` exists specifically to bridge the mutable drag state into the `pointerup` listener without causing re-renders.) In view mode (`activeView.mode !== 'edit'`), `AltarSidebarPanel` renders `AltarReadingSummary` instead of the editor UI — all edit controls (canvas options, background pickers, overlay, grid, placed-elements list) are guarded behind `isEditing` checks. The six collapsible section states (backgroundOpen, overlayOpen, gridOpen, faviconOpen, canvasOptionsOpen, placementsOpen) are persisted to `localStorage` under `altar-sidebar-sections-<altarId>` and reloaded on altar switch. A load-effect keyed on `altarId` reads the stored JSON and applies defaults where values are missing. A separate save-effect keyed on the six section booleans writes the current state; it reads `altarId` from an `altarIdRef` (not from the effect dependency list) to avoid writing the incoming altar's state while the load-effect is still applying its values.
- `altarStore` uses module-private helpers `mapEachPreview(fn)` and `filterEachPreview(fn)` (not on the store interface) that operate on the `previewPlacements` map and return a new map; they replace the repeated `Object.fromEntries(Object.entries(previewPlacements).map/filter(…))` pattern in store actions. `insertAltarRow` is an internal helper that owns the `INSERT INTO altars …` SQL — including `thumbnail_data` and `icon_data` — so both `createAltar` and `duplicateAltar` delegate to it; `duplicateAltar` therefore copies the thumbnail and favicon icon to the new row. `addCategory` and `updateCategory` validate uniqueness before writing: they check the in-memory `categories` slice for a name collision and throw `"Category \"…\" already exists"` if one is found; callers (e.g. `CategoryModal`) catch this and display the message inline. `reorderCategories` issues a single bulk `UPDATE altar_categories SET sort_order = CASE id … END` statement for the full reordered set, replacing N sequential writes. `sendPlacementToBack` issues a single bulk `UPDATE altar_placements SET z_index = CASE … END` statement plus one `bumpAltarUpdatedAt` call instead of N individual writes. `swapPlacementZIndex` (previously `_swapPlacementZIndex`) swaps two placements' z-index values in a single transaction.

**Altar thumbnail capture.** Thumbnails are generated on every exit from edit mode — Done button, Cancel button, back-arrow breadcrumb, and component unmount (tab/module switch). The mechanism uses a `useEffect` on `isEditing` in `AltarView` whose cleanup function calls `captureCurrentAltar()`. Because `useEffect` cleanup runs before the component unmounts and before `clearActiveAltar()` clears the store, `getState()` still has the correct altar and placements at that point. `handleDone` and `handleCancel` set `thumbnailSavingRef.current = true` before starting their own capture so the cleanup effect skips them and avoids a duplicate write. `handleDone` sequences writes title-first then thumbnail to prevent the full-row title write from overwriting a thumbnail saved a moment earlier. The thumbnail is capped at 640 px wide and uses adaptive JPEG quality (0.85 → 0.65 → 0.45) with a 512 KB budget. On macOS WKWebView, `canvas.toBlob('image/webp')` may silently return a PNG; the encoder probes the MIME type of the result and falls back directly to JPEG if WebP encoding is not supported.

**Altar drag performance.** `movePlacement` updates only the `placements` slice (used by `AltarCanvas`) on every pointer-move event. It intentionally does not touch `previewPlacements` (used by `AltarCard` thumbnails), because rebuilding that map at 60–120 Hz causes `AltarView` to re-render at pointer rate. `savePlacementPosition` (called on mouse-up) syncs the final position into `previewPlacements`, which is sufficient for thumbnail accuracy.

**Altar render memoisation.** `AltarItemVisual` is exported as `memo()`. `PlacedItem` (inside `AltarCanvas`) uses stable `useCallback` references for `onStartDrag`, `onSelect`, `onResize`, and `onRotate` — each callback now accepts `id` as a parameter instead of being recreated per-item inside the render loop. This allows `React.memo` on `PlacedItem` to bail out correctly: only the element being dragged re-renders during a drag gesture. `handleMouseMove`, `handleMouseUp`, and `coordsToPercent` in `AltarCanvas` are also wrapped in `useCallback`; `coordsToPercent` is included in the dependency array of the sidebar-drag `useEffect` where it was previously missing.

## Font System

Emerald supports two independent font selections applied via CSS custom properties on `html`:

```
src/themes/theme.ts          # DEFAULT_UI_FONT_ID, DEFAULT_EDITOR_FONT_ID,
                             # FONT_OPTIONS, normalizeUIFontId, normalizeEditorFontId,
                             # applyUIFont, applyEditorFont
src/index.css                # --font-ui and --font-editor variable definitions,
                             # html[data-ui-font='…'] and html[data-editor-font='…'] selectors
src/store/uiStore.ts         # uiFontId, editorFontId state + setters (localStorage: ui-font-id, editor-font-id)
src/App.tsx                  # Subscribes to uiFontId/editorFontId and calls applyUIFont/applyEditorFont
```

**Application flow.** `App.tsx` subscribes to `uiStore.uiFontId` and `uiStore.editorFontId` and calls `applyUIFont()` / `applyEditorFont()` on every change. These functions set `document.documentElement.dataset.uiFont` and `dataset.editorFont`, which activate the matching CSS rules in `src/index.css`.

**CSS variable mapping.** Each font ID defines a `--font-<id>` variable with the full font-family stack. The `data-ui-font` selector sets `--font-ui`; the `data-editor-font` selector sets `--font-editor`. Components reference these variables:

- `--font-ui` is applied to the root `body` element (all UI chrome).
- `--font-editor` is applied to `.tiptap`, `.entry-view-title`, and `.entry-view-body`.

This means the editor font controls the TipTap editor body, entry titles in all detail views (journal, wiki, operations, sigil, altar), and the read-mode body text. There is no separate heading font — headings inherit the editor body font.

**Defaults.** UI font defaults to **Inter**; editor body font defaults to **Lora**. Invalid or missing stored values fall back to these defaults via `normalizeUIFontId()` / `normalizeEditorFontId()`.

## IPC Command Surface

All Rust commands are registered in `src-tauri/src/lib.rs` and invoked from TypeScript with `invoke()`.

| Command | Purpose |
|---|---|
| `save_image(data_url, vault_id)` | Decode base64 data-URL, write `{sha256}.{ext}` into the vault's `images/`, skip if it exists. Returns the **filename**. |
| `copy_image_file(source, vault_id)` | Read a file from an arbitrary path, write it into the vault's `images/` under its SHA-256 name. Accepts png/jpg/jpeg/gif/webp/svg only. Rejects symlinks, canonicalizes the source, and verifies it falls within the allowed storage roots. Returns the filename. |
| `read_image_as_base64(filename, vault_id)` | Read a stored image and return a data-URL. Only for the two callers that cannot use the `emerald-img` scheme: the PDF export renders in a `file://` webview, and the backup writer embeds bytes in JSON. |
| `adopt_legacy_images(vault_id, filenames)` | Copy images out of the pre-per-vault shared pool into a vault's own folder. Migration v35 only. |
| `list_image_files(vault_id)` / `delete_image_files(vault_id, filenames)` | Back the *Unused images* cleanup. Confined to the vault's own folder; both reject any name that is not 64 hex digits plus a known extension. |
| `register_vaults(vaults)` | Mirror `vaults.json` into the `id → path` registry every storage command resolves against. |
| `create_vault_dirs(vault_id)` / `ensure_vault_dirs(vault_id)` | Build a new vault's tree / verify an existing one before its database is opened. `ensure_vault_dirs` does not create the vault directory — see [Vault Layout](#vault-layout). |
| `default_vault_dir(vault_id)` / `probe_vault_dir(path)` | The location a vault gets when the user picks none / what a folder chosen in the dialog already contains. |
| `new_vault_base_dir()` | The folder new vaults are offered in: `{documentDir}/Emerald`, falling back to `{appDataDir}/vaults` where the platform exposes no documents folder. |
| `legacy_default_db_exists()` | Whether an `emerald.db` from before `vaults.json` existed is sitting in `app_config_dir`, `app_data_dir`, or the migration target — the difference between a genuine first start and an installation whose journal is already on disk. |
| `migrate_vault_layout(vault_id, legacy_db_name)` | Move a pre-per-vault flat database into its own directory. Returns that directory. |
| `delete_vault_files(vault_id)` | Validates before deleting anything: walks the folder and `images/` for a name it doesn't own and aborts with `VAULT_DIR_NOT_EMPTY` before touching a file. Only then removes the database, its journal, the recognised images, and the two now-empty directories; the final `remove_dir` calls stay in only as a guard against a race, not as the check itself. |
| `export_image(path, data_url)` | Decode a base64 data-URL and write the binary image bytes to a user-chosen path. Permitted extensions: `.png`, `.jpg`, `.jpeg`, `.webp`. Same symlink rejection, allowed-roots confinement, and `canonicalize`-before-write checks as `write_file`. |
| `write_file(path, content)` | Write UTF-8 text to a user-selected path. Permitted extensions: `.md`, `.emerald`, `.emeralddb`, `.json`, `.txt`. Path must resolve within allowed storage roots. |
| `read_file(path)` | Read a file and return its UTF-8 content. Same extension allowlist and root confinement as `write_file`. |
| `ensure_app_storage_dirs()` | Create app data and app config directories if they don't exist. Called before frontend writes vault metadata or opens SQLite. |
| `export_pdf(html, path, page_size?)` | Render the supplied HTML to a PDF at `path` by driving the app's own webview. The frontend first prompts the user for a save location via the `dialog` plugin and passes the chosen path here. `page_size`, an optional `(width_in, height_in)` tuple in inches, overrides the default Letter/Portrait page with a custom size — used only by the Altar PDF export (see below); Journal/Wiki/Operations export calls it without `page_size` and gets the old default behavior. Per-platform implementations live in `src-tauri/src/pdf_export/{windows,macos,linux}.rs`, all behind the same `pub async fn export_pdf` signature; `mod.rs` does the `#[cfg(target_os = "…")]` re-export so `lib.rs` calls `pdf_export::export_pdf` without knowing which platform it's on. |
| `update_menu_labels(...)` | Update native menu item labels for i18n (edit, view, export, import submenus and their items, including the View menu's two `CheckMenuItem`s, which need their own `MenuItemKind::Check` arm). macOS only in effect — see [Window Chrome](#window-chrome). |
| `set_view_menu_checked(left_list, right_sidebar)` | Mirror the frontend's sidebar visibility onto the View menu's two check items. Called on every change, since the rail's own toggles can flip the same state without the menu being opened. macOS only in effect. |
| `set_export_menu_enabled(entry, pdf, emerald)` | Enable/disable the native "Export as …" items for the current view. Driven by `computeMenuEnabledState`; macOS only in effect. |
| `set_altar_export_menu_enabled(enabled)` | Enable/disable the native "Export as Image" submenu. macOS only in effect. |

Tauri menu events (not `invoke`) are emitted by the native menu and received in `AppShell` via `listen()`. On Windows and Linux there is no native menu (see [Window Chrome](#window-chrome) below) — the HTML menu bar calls the same actions directly through `src/lib/menuActions.ts`, so both platforms run one implementation:

| Event ID | Trigger |
|---|---|
| `export-pdf` | Export > Export as PDF… |
| `export-markdown` | Export > Export as Markdown… |
| `export-emerald` | Export > Export as Emerald… |
| `import-markdown` | Import > From Markdown… |
| `import-emerald` | Import > From Emerald… |
| `export-altar-jpeg` / `-png` / `-webp` | Export > Export as Image > JPEG… / PNG… / WebP… |
| `toggle-left-list` | View > Entry List |
| `toggle-right-sidebar` | View > Properties |
| `reset-sidebar-widths` | View > Reset View |
| `navigate-back` | Mouse back button (macOS NSEvent monitor) |
| `navigate-forward` | Mouse forward button (macOS NSEvent monitor) |

Only `reset-sidebar-widths` is still emitted from the frontend as well — the HTML menu bar re-emits it so `AppShell`'s existing listener handles it identically on both platforms. The other ten are called directly through `runMenuAction`. The two sidebar toggles are handled at the very top of `runMenuAction`, above its no-active-vault guard: they touch no database, and muda (Tauri's menu crate) flips a native check item's tick *itself* before emitting the event. Returning early would leave macOS showing a tick with no state behind it, which the `[leftListOpen, rightSidebarOpen]`-keyed sync effect would then never correct.

## Window Chrome

The window's title bar is drawn by the app, not the OS — a slim 40px bar holding the Emerald logo, the application menu, back/forward navigation, a search field, and the window buttons (`src/components/layout/titlebar/`). It sits above the three-column shell in `AppShell`. The logo is a plain `<img>`, not a control: it used to be the only route to the dashboard, which now has its own rail button. It carries `data-tauri-drag-region` so the corner drags the window again, plus `draggable={false}` — an `<img>` is a drag source by default, and Tauri's `drag.js` skips `preventDefault()` on the second press of a macOS double-click.

**Layout is flex, not a centred grid.** The left group (logo, menu bar, navigation) and the right group (window controls) are `flex-shrink-0`; the search field's wrapper is the one flexible column (`flex-1 min-w-0`) and is the only thing that gives as the window narrows — it fills whatever space the two fixed groups leave over rather than staying centred on the window. Below `SEARCH_MIN_PX` (192px) of room left for the field, `TitleBar` collapses `TitleBarMenuBar`'s four menus (Edit/View/Export/Import) into a single button holding them as submenus, via a `compact` prop; `menuActions.ts` still backs both forms. The threshold is evaluated against the menu bar's actual rendered width through a `ResizeObserver` on the header, not a fixed window-width breakpoint — the bar is measurably wider in German than in English, so a constant would fold one language too early and the other never. The expanded width is cached in a ref and reread while collapsed, where it can't be measured directly; that cache is what stops the two states oscillating at the boundary. A language change invalidates it and re-expands the bar so the next render measures the new labels. In the Altar's distraction-free full-window mode (`isAltarFullscreen`) the bar never collapses, since there is no search field there to protect.

**The split is per platform, and deliberately not uniform.** `src/lib/platform.ts` decides at module-eval time (a synchronous user-agent check, so the first paint is already correct) and `main.tsx` mirrors the result onto `html[data-platform]` for CSS. `usesCustomWindowControls` additionally requires `isTauri` (`'__TAURI_INTERNALS__' in window`): opened as a plain page in a browser the window APIs do not exist, and `getCurrentWindow()` would throw during render rather than fail softly like the rest of the desktop-only calls:

| | Windows / Linux | macOS |
|---|---|---|
| Window config | `decorations: false` | `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle` |
| Min / max / close | `WindowControls` (46x40, Fluent geometry) | Native traffic lights, positioned by `trafficLightPosition` |
| Application menu | `TitleBarMenuBar` (HTML) | Native, in the system menu bar |
| Title bar left inset | none | 5rem, reserved for the traffic lights |

Per-platform window settings live in `src-tauri/tauri.{windows,linux,macos}.conf.json`, which Tauri merges over `tauri.conf.json`. The merge is RFC 7396, which **replaces arrays wholesale**, so each file repeats the complete window object rather than only its deltas. `tauri.dev.conf.json` merges last (it is passed via `--config`) and must never gain an `app.windows` key, or it would wipe the platform settings. `minWidth` is 720px across all four files (`minHeight` stays 600) — lowered from 900px now that the title bar collapses its menu instead of clipping; at 720px the collapsed bar plus rail plus both sidebars' minimums still leave room for content.

In the Altar's distraction-free full-window mode the title bar stays, minus the navigation and the search — on Windows and Linux it holds the only way to close or move the window, *and* the only route to the altar's image export, which is usually why that mode was entered. The predicate for that mode is `isAltarFullscreen` in `uiStore`, shared by `AppShell` (which hides the sidebars and tab bar) and `TitleBar`, so the two cannot drift apart.

Dragging the window uses `data-tauri-drag-region`. Tauri reads the attribute off the element directly under the cursor and does **not** walk up the tree, so every non-interactive wrapper in `TitleBar` carries it and no interactive control does. Double-clicking a drag region maximises; Tauri handles that natively via `internal-toggle-maximize`.

Beyond `core:default`, the window controls need four permissions in `src-tauri/capabilities/default.json`: `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close`. `allow-is-maximized` and `allow-internal-toggle-maximize` are already in the default set.

### Why the native menu is macOS-only

`install_native_menu` in `src-tauri/src/lib.rs` is gated to macOS. On Windows and Linux, `set_menu` attaches an in-window menu bar (an HMENU / a GTK menubar) regardless of `decorations`, which would sit alongside the app's own menu bar. The three menu commands (`update_menu_labels`, `set_export_menu_enabled`, `set_altar_export_menu_enabled`) all bail out when `app.menu()` returns `None`, so they become no-ops on those platforms without any frontend branching.

Both menus resolve to the same code. `src/lib/menuActions.ts` owns the action implementations (`runMenuAction`) and the rules for which export items are available (`computeMenuEnabledState`); the native macOS menu reaches them by emitting the event ids listed above, which `AppShell` forwards, while the HTML menu bar calls them directly. `View > Reset View` is the one exception: it manipulates `AppShell`'s local sidebar widths, so the HTML menu re-emits `reset-sidebar-widths` rather than calling a function, and `AppShell`'s existing listener answers it on both platforms.

### Known limitations

- **Windows 11 Snap Layouts.** With `decorations: false` the hover flyout on the maximise button is gone; restoring it needs `WM_NCHITTEST` returning `HTMAXBUTTON` from Rust. `Win+Arrow` and drag-to-edge snapping still work.
- **Paste in the HTML Edit menu** goes through `navigator.clipboard.read()` replayed as a synthetic `ClipboardEvent` (`editCommands.ts`), because `document.execCommand('paste')` is blocked in WebView2 and WKWebView. Going through a real event rather than `insertText` lets ProseMirror apply its own paste handling and keep `text/html` formatting; images are carried as `File` entries on the `DataTransfer` so `RichEditor`'s `handlePaste` still finds them via `getAsFile()`. `Ctrl+V` always works natively regardless.

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
- **Linux (`src-tauri/src/pdf_export/linux.rs`)** — implemented and verified on real hardware (spot-checked on a fresh Ubuntu 26.04 install; the supported/build distro matrix is unchanged — Ubuntu 22.04 LTS and 24.04 LTS — the CI workflows still build on `ubuntu-22.04`). Same overall shape as Windows/macOS, but with two Linux-specific wrinkles:
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
- **Frontend (`src/components/layout/AppShell.tsx`)** — a single `useEffect` keyed on `activeView.type`, `activeView.id`, and `activeView.mode` calls `invoke('set_export_menu_enabled', { entryEnabled, pdfEnabled, emeraldEnabled })` with `entryEnabled = (activeView.type ∈ {journal, wiki}) && !!activeView.id`, and both `pdfEnabled` and `emeraldEnabled` set to `entryEnabled || (activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit')`. The same effect also calls `set_altar_export_menu_enabled` (see below), since all three depend on the same view-state inputs. The `export-pdf` listener itself re-reads `useUIStore.getState().activeView` at click time: if it resolves to an Altar reading view, it calls `saveAltarPDF()` (`src/lib/altarExport.ts`) instead of the usual `exportAsPDF(data)` path.

  **Sigil-category Operations are temporarily excluded from `entryEnabled`.** `isEntryView` computes `isSigilOperation` (an open Operations entry whose `category_id === 'sigils'`) and requires `activeView.type === 'operations' && !isSigilOperation`, so all three "Export as …" items are disabled specifically while a Sigil is open — Sigils have their own dedicated view (`OperationSigilView`) and export isn't wired up for that category yet. Non-Sigil Operations (e.g. Servitors, custom categories) are unaffected and export normally. This is a stopgap, not a permanent restriction: remove the `!isSigilOperation` condition once Sigil export is implemented and verified. Journal, Wiki, non-Sigil Operations, and the Altar reading-view export path are all unaffected.

There is still only one `export-emerald` menu item — it is not duplicated per content type; `exportAsEmerald()` in `src/lib/emeraldFormat.ts` branches internally on `activeView.type` to export either the open entry or the open altar. The same one-menu-item-branches-internally pattern now also applies to `export-pdf`.

**Altar "Export as Image" submenu.** A nested `Submenu` (id `export-altar-image`, containing `MenuItem`s `export-altar-jpeg` / `export-altar-png` / `export-altar-webp`) sits inside `export-submenu`, separated from the entry-export items by a `PredefinedMenuItem::separator`. It follows the same two-place gating pattern, but with a different condition — it is only meaningful while an Altar is open in **reading view** (not edit mode):

- **Rust** — `set_altar_export_menu_enabled(app, enabled)` walks `export-submenu` to find the `export-altar-image` submenu, toggles the submenu itself (`enabled: false` at construction) plus its three child `MenuItem`s in one call.
- **Frontend** — a separate `useEffect` keyed on `activeView.type`, `activeView.id`, and `activeView.mode` calls `invoke('set_altar_export_menu_enabled', { enabled })` with `enabled = activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit'`.
- Clicking a leaf item emits `export-altar-jpeg` / `export-altar-png` / `export-altar-webp`, which `AppShell.tsx` listens for and forwards to `saveAltarImage(format)` (`src/lib/altarExport.ts`) — the same `exportCurrentAltarImage()` capture path formerly wired to the in-sidebar "Save Image" button.
- `update_menu_labels` was extended with `export_altar_image` / `export_altar_jpeg` / `export_altar_png` / `export_altar_webp` params and traverses into the nested submenu to relabel it and its children on language change.

### Bridging imperative menu-event code to a React modal

`import-markdown` is a Tauri menu event, so its handler (`importFromMarkdown()` in `src/lib/emeraldFormat.ts`) runs as plain imperative code with no component tree to render a confirmation dialog into. When the parsed file's frontmatter has no usable `type`, the import needs the user to pick a destination before it can continue — `src/store/importStore.ts` bridges this gap with a promise-based Zustand store: `askDestination(title)` sets `pending = { title, resolve }` and returns a `Promise<ImportDestinationType | null>` that does not resolve until the store's `choose(type)` or `cancel()` action is called. `ImportDestinationModal` (mounted globally in `AppShell`, alongside `UndoToast`) subscribes to `pending` and renders only when it's non-null; clicking an option calls `choose`, clicking outside/Escape/Cancel calls `cancel` (resolves `null`). `importFromMarkdown()` awaits the promise and treats `null` as a full import abort (`return` before any DB write). This pattern — an imperative caller `await`s a store method, a mounted-once modal component resolves it — is the template for any future case where non-component code needs a blocking user decision.
