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
│   ├── layout/       AppShell, LeftSidebar, RightSidebar, MainArea, SettingsModal
│   ├── editor/       RichEditor, InternalLinkExtension, EntryCustomProperties,
│   │                 TagInput, ResizableImageExtension, ExternalDropExtension
│   ├── views/        HomeView, JournalView, WikiView, TagsView, AltarView,
│   │                 OperationsView, OperationSigilView, TrashView
│   ├── sidebar/      OpPropertiesPanel, RoutinesPanel, WikiPanel, OperationsPanel,
│   │                 BacklinksPanel, AltarSidebarPanel, CustomPropertiesSection,
│   │                 LinkedOpsInput, LinkedWikiInput
│   ├── wiki/         WikiList (rendering + category emoji helper)
│   └── ui/           ListToolbar, FilterPanel, UndoToast, ContextMenu
├── store/            journalStore, wikiStore, uiStore, tagStore, operationStore, taskStore,
│                     altarStore, routineStore, customPropertyStore, undoStore,
│                     trashStore, vaultStore
├── lib/              db.ts, links.ts, dragState.ts, altarDragState.ts,
│                     routineDragState.ts, moonPhase.ts, export.ts,
│                     exportData.ts, emeraldFormat.ts, vaultManager.ts, dbBackup.ts,
│                     helpers.ts (incl. isImageIcon, safeParseArray, generateId),
│                     altarConstants.ts, styleClasses.ts
├── themes/           emerald-noctis.css, emerald-parchment.css, theme.ts
├── i18n/             react-i18next setup + locales/en.json de.json es.json fr.json
└── types/index.ts    Shared TypeScript interfaces

src-tauri/
└── src/lib.rs        All Rust commands and application setup
```

## Key Architectural Patterns

### Known Boundary Caveat

`getCategoryEmoji` currently lives in `src/components/wiki/WikiList.tsx` and is imported by both UI and non-UI modules (for example export helpers). This works, but it is a layering compromise because a pure utility function is sourced from a component file. If category emoji mappings become more complex, move this helper into `src/lib/` (or a shared constants module) to keep library code independent from React component modules.

### Edit Mode Architecture

The main content area renders only the title and body. All metadata — tags, category, custom properties, icon, cover image — is edited exclusively in the right sidebar. The sidebar writes directly to the relevant store; the main area subscribes to the same store fields and updates accordingly. There is no "is editing" guard that blocks sidebar saves.

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

When `setActiveView()` is called while a tab is active, the current tab's view is updated. Opening content in a new tab creates a new tab with its own `ActiveView`. Selecting a tab restores that tab's view into the main area.

Tabs and navigation history are related but separate:

- Tabs represent the user's current workspace.
- Navigation history represents back/forward movement within that workspace.

This means users can keep several entries open while still using back/forward navigation inside the active tab context.

### Navigation History

`uiStore` maintains a `history` array and `historyIndex`. `setActiveView` pushes a new entry only when the type or id changes — switching between read and edit mode for the same entry is not recorded as a new step. Mouse back/forward buttons are handled by a macOS NSEvent local monitor in `lib.rs` that emits `navigate-back` and `navigate-forward` Tauri events; `AppShell` listens for these and calls `uiStore.navigateBack()` / `navigateForward()`.

## Data Flow

```
SQLite (emerald.db)
    ↓  read on startup (getDb + runMigrations)
Zustand stores (in-memory)
    ↓  React subscriptions
Components (render)
    ↓  user edits
Store actions (updateEntry, updateOperation, …)
    ↓  db.execute / db.select
SQLite (persisted)
```

Stores are the single source of truth for in-memory state. Components never query SQLite directly. All SQL happens inside store action functions in `src/store/*.ts`.

## Image Storage System

Images are content-addressed and stored outside SQLite:

- **Location**: `{appDataDir}/images/{sha256}.{ext}` — for macOS this is typically `~/Library/Application Support/com.emerald.magical-journal/images/`.
- **Insert path**: when an image is added (toolbar button, paste, Finder drop), the Rust `save_image` command decodes the base64 data-URL, computes SHA-256, and writes the file only if it does not already exist. The absolute file path is stored in the HTML `src` attribute.
- **Display path**: `ResizableImageExtension.tsx` detects that a `src` value is a file path (not `data:` or `http`), calls `read_image_as_base64` via IPC, and caches the returned data-URL in a module-level `Map`.
- **Deduplication**: because the filename is the SHA-256 of the raw bytes, uploading the same image twice produces one file.
- **Cleanup**: `AppShell` calls `cleanup_unused_images` after all stores load. It collects every `src="..."` path from all content fields and passes that set to Rust, which deletes any files in the images directory that are not in the set and are older than 5 minutes. The age guard prevents deleting files belonging to unsaved new entries.

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

### Adding a new theme

1. Create `src/themes/emerald-<name>.css` with all required custom properties (copy an existing file as a template).
2. Add the theme ID to the `ThemeId` union in `src/store/uiStore.ts`.
3. Register it in `THEME_OPTIONS` and add any legacy mapping in `normalizeThemeId` in `src/themes/theme.ts`.
4. Import the new CSS file from `src/main.tsx` (or add it to `index.html`).
5. Add Tailwind bridge overrides in `src/index.css` under `html[data-theme='emerald-<name>']` for any hardcoded utility classes the theme needs to override.

### Shared style constants

Two modules centralise reusable Tailwind class strings to avoid duplication across components:

- **`src/lib/styleClasses.ts`** — Input and select class strings for custom properties and operation properties (`CUSTOM_PROP_INPUT_CLASSES`, `CUSTOM_PROP_SMALL_INPUT_CLASSES`, `OP_PROP_SELECT_CLASSES`).
- **`src/lib/altarConstants.ts`** — Altar background presets (`ALTAR_BACKGROUND_PRESETS`, `ALTAR_BACKGROUND_STYLES`), category emoji mappings (`ALTAR_CATEGORY_EMOJI`, `CATEGORY_EMOJIS`), the default background (`DEFAULT_ALTAR_BACKGROUND`), canonical grid defaults (`DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`), and the resolution system: `DEFAULT_ALTAR_RESOLUTION` (`'1920x1080'`), `BASE_RESOLUTION_WIDTH` (1920), `MAX_ALTAR_RESOLUTION_W` (7680), `MAX_ALTAR_RESOLUTION_H` (4320), `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `sizeAndRatioFromResolution`, `parseResolution`, `isRatioFormat`, and `ratioFromResolution`. The SQL migration defaults for altar grid and resolution columns must stay in sync with these constants. `parseResolution` validates the input string against `/^\d+x\d+$/` and clamps both dimensions before returning `{ w, h }`. `isRatioFormat` tests whether a string is a ratio (e.g. `"16:9"`). `ratioFromResolution` returns the matching `AltarRatio` for either format.

## Altar UI Composition

Altar rendering and editing were split into focused components:

- **`src/components/altar/AltarItemVisual.tsx`** — shared visual renderer for altar items (emoji/image and candle animation treatment).
- **`src/components/altar/AltarCanvas.tsx`** — canvas scene rendering, placement transforms, drag/drop interactions, lock handling, and grid overlay drawing.
- **`src/components/altar/AltarLibraryStrip.tsx`** — docked library strip under canvas (edit mode), compact tiles, and modal CRUD for altar items.
- **`src/components/altar/AltarCard.tsx`** — `AltarCard`, `AltarListRow`, and the shared context-menu action builder for the altar dashboard.
- **`src/components/altar/AltarCardPreview.tsx`** — preview scene used by the dashboard cards and list rows (background + placed items, both compact and full-size variants).
- **`src/components/altar/AltarRenameField.tsx`** — inline rename input used by the dashboard cards and list rows.
- **`src/components/sidebar/PlacedElementRow.tsx`** — `PlacedElementRow` and `PlacedElementInspector` for the sidebar's placed-elements list and its inline inspector. `PlacedElementRow` manages its own right-click context-menu state (position + portal render via `createPortal`). The delete button is in the row (Trash icon, rightmost). `PlacedElementInspector` shows a compact 4-column input grid (X, Y, Rot, Scale) plus a jade opacity slider; Z-order buttons are not in the inspector — layer order is set by dragging rows in `AltarSidebarPanel`.

Supporting hooks:

- **`src/components/altar/useAltarBackgroundPreview.ts`** — background image preview resolution. Backed by a module-level cache (`cache: Map<path, dataUrl>`, `inFlight: Map<path, Promise>`) so the same path is read from Tauri at most once per session and consumers re-render via `useSyncExternalStore` when a load resolves.

**Altar canvas scaling model.** The canvas container in `AltarView` is rendered at the altar's native resolution. A `ResizeObserver` on the viewport div handles two resolution formats stored in `altars.resolution`:

- **Ratio format** (e.g. `"16:9"`): `nativeW` and `nativeH` are computed from the current viewport size so the canvas fills the viewport at the given proportion. `scale` is set to `1`; only `offsetX` and `offsetY` center the canvas.
- **Pixel format** (e.g. `"1920x1080"`): a uniform CSS `scale` factor (`Math.min(vw/nw, vh/nh)`) is computed; `nativeW`/`nativeH` are fixed. `offsetY` is 0 in normal mode and `(vh − nativeH × scale)/2` in full-window mode.

Both formats store the result as `canvasTransform` (`{ scale, offsetX, offsetY, nativeW, nativeH }`) with a default of `{ scale:1, offsetX:0, offsetY:0, nativeW:1920, nativeH:1080 }` to avoid a flash on first render. The canvas container receives `transform: translate(offsetX, offsetY) scale(scale)` with `transform-origin: 0 0`. `AltarCanvas` receives `resolution` (raw string), `nativeW`, `nativeH` (already resolved by the observer), and `cssScale`. `canvasScale` is derived from `nativeW / BASE_RESOLUTION_WIDTH` directly inside `AltarCanvas`, so `parseResolution` is no longer called there. Handle sizes are divided by `cssScale` so they appear at a constant screen-pixel size. Placement coordinates (`x/y`) remain percentage-based (0–100).

Store integration details:

- `uiStore` provides altar scene UI controls (fullscreen toggle). Grid settings were moved out of `uiStore` in 0.1.3 — see below.
- Altar screens consume `uiStore` with granular selectors to reduce unrelated rerenders.
- `altarStore` is the source of truth for altar records, items, placements, placement patch clamping, and per-altar grid/snap configuration. The store exposes `clearActiveAltar`, `bumpAltarUpdatedAt`, `updateAltarGrid`, `updateAltarResolution`, and `duplicatePlacement` actions. `bumpAltarUpdatedAt` updates only the `updated_at` column on placement edits. `updateAltarGrid(id, patch)` is the sole write path for all eight altar settings fields (grid_enabled, grid_size, grid_opacity, grid_color, snap_to_grid, rotation_snap_enabled, rotation_snap_angle, snap_scale_to_grid); it clamps all numeric values, validates the hex color, sets `updated_at`, and sorts the in-memory altar list by `updated_at`. `updateAltarResolution(id, resolution)` accepts either a ratio string (e.g. `"16:9"`) or a pixel string (`"WxH"`): ratio strings that are valid `AltarRatio` values are stored as-is; pixel strings are passed through `parseResolution` for clamping. `duplicatePlacement(id)` inserts a new row into `altar_placements` with a fresh UUID, copies width/height/rotation/opacity from the source, positions it +2% in both axes (capped at 100), assigns `z_index = max + 1`, sets locked and hidden to false, and immediately selects the new element.
- `AltarSidebarPanel` manages drag-to-reorder Z-order via Pointer Events directly (no dedicated store action): on pointer-up it reads the final visual order from `visualPlacementsRef` and calls `updatePlacement(id, { z_index })` for each element whose index changed. A `visualPlacements` `useMemo` computes the reordered list during the drag gesture; `visualPlacementsRef` is kept in sync via `useEffect` to avoid stale closures inside the `pointerup` handler.

**Altar drag performance.** `movePlacement` updates only the `placements` slice (used by `AltarCanvas`) on every pointer-move event. It intentionally does not touch `previewPlacements` (used by `AltarCard` thumbnails), because rebuilding that map at 60–120 Hz causes `AltarView` to re-render at pointer rate. `savePlacementPosition` (called on mouse-up) syncs the final position into `previewPlacements`, which is sufficient for thumbnail accuracy.

**Altar render memoisation.** `AltarItemVisual` is exported as `memo()`. `PlacedItem` (inside `AltarCanvas`) uses stable `useCallback` references for `onStartDrag`, `onSelect`, `onResize`, and `onRotate` — each callback now accepts `id` as a parameter instead of being recreated per-item inside the render loop. This allows `React.memo` on `PlacedItem` to bail out correctly: only the element being dragged re-renders during a drag gesture.

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
| `save_image(data_url)` | Decode base64 data-URL, write `{sha256}.{ext}`, skip if exists. Returns absolute path. |
| `copy_image_file(source)` | Read a file from an arbitrary path, write to images dir with SHA-256 name. Accepts png/jpg/gif/webp/svg only. Rejects symlinks, canonicalizes the source path, and verifies it falls within allowed storage roots (home, documents, downloads, desktop, app data, app config). |
| `read_image_as_base64(path)` | Read a file from the images dir and return it as a base64 data-URL. Path must be within the images directory (checked via `canonicalize`). |
| `cleanup_unused_images(used_paths, min_age_secs?)` | Delete unreferenced files older than N seconds (default 300). Returns count deleted. |
| `write_file(path, content)` | Write UTF-8 text to a user-selected path. Permitted extensions: `.md`, `.emerald`, `.emeralddb`, `.json`, `.txt`. Path must resolve within allowed storage roots. |
| `read_file(path)` | Read a file and return its UTF-8 content. Same extension allowlist and root confinement as `write_file`. |
| `ensure_app_storage_dirs()` | Create app data and app config directories if they don't exist. Called before frontend writes vault metadata or opens SQLite. |
| `open_pdf_export(html)` | Store the HTML in a static `Mutex<String>`, open a new `pdf-export` window that serves it over a custom `export-html://` URI scheme. |
| `trigger_print()` | Call `window.print()` on the `pdf-export` window. Invoked by a button in the print window HTML. |
| `update_menu_labels(...)` | Update native menu item labels for i18n (edit, view, export, import submenus and their items). |

Tauri menu events (not `invoke`) are emitted by the native menu and received in `AppShell` via `listen()`:

| Event ID | Trigger |
|---|---|
| `export-pdf` | Export > Export as PDF… |
| `export-markdown` | Export > Export as Markdown… |
| `export-emerald` | Export > Export as Emerald… |
| `import-markdown` | Import > From Markdown… |
| `import-emerald` | Import > From Emerald… |
| `reset-sidebar-widths` | View > Reset View |
| `navigate-back` | Mouse back button (macOS NSEvent monitor) |
| `navigate-forward` | Mouse forward button (macOS NSEvent monitor) |
