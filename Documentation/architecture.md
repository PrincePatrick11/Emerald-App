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
│   ├── layout/       AppShell, LeftSidebar, RightSidebar, MainArea, SettingsModal, TabBar
│   ├── editor/       RichEditor, InternalLinkExtension, EntryCustomProperties,
│   │                 TagInput, ResizableImageExtension, ExternalDropExtension,
│   │                 EditorToolbar, LinkPickerModal, SuggestionList
│   ├── views/        HomeView, JournalView, WikiView, TagsView, AltarView,
│   │                 OperationsView, OperationSigilView, TrashView, TasksView
│   ├── sidebar/      OpPropertiesPanel, RoutinesPanel, WikiPanel, OperationsPanel,
│   │                 BacklinksPanel, AltarSidebarPanel, AltarReadingSummary,
│   │                 CustomPropertiesSection, LinkedOpsInput, LinkedWikiInput,
│   │                 PlacedElementRow
│   ├── wiki/         WikiList (rendering + category emoji helper)
│   └── ui/           ListToolbar, FilterPanel, UndoToast, ContextMenu
├── store/            journalStore, wikiStore, uiStore, tagStore, operationStore, taskStore,
│                     altarStore, routineStore, customPropertyStore, undoStore,
│                     trashStore, vaultStore
├── lib/              db.ts, links.ts, tabs.ts, dragState.ts, altarDragState.ts,
│                     routineDragState.ts, moonPhase.ts, export.ts,
│                     exportData.ts, emeraldFormat.ts, vaultManager.ts, dbBackup.ts,
│                     helpers.ts (incl. isImageIcon, safeParseArray, generateId,
│                                      hexToRgb, isValidHexColor, readFileAsDataUrl,
│                                      ACCEPTED_IMAGE_MIME, isAcceptedImageFile),
│                     altarConstants.ts, styleClasses.ts
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
        └── linux.rs         WebKitGTK WebKitPrintOperation (PrintOperationAction::Export)
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
- **Cleanup**: `AppShell` calls `cleanup_unused_images` after all stores load. It collects every `src="..."` path from all content fields — including altar `background_image_data` paths — and passes that set to Rust, which deletes any files in the images directory that are not in the set and are older than 5 minutes. The age guard prevents deleting files belonging to unsaved new entries.

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

- **`src/lib/styleClasses.ts`** — Input and select class strings for custom properties and operation properties (`CUSTOM_PROP_INPUT_CLASSES`, `CUSTOM_PROP_SMALL_INPUT_CLASSES`, `OP_PROP_SELECT_CLASSES`).
- **`src/lib/altarConstants.ts`** — Altar background presets (`ALTAR_BACKGROUND_PRESETS`, `ALTAR_BACKGROUND_STYLES`), photographic image presets (`ALTAR_IMAGE_PRESETS` — a readonly tuple of 16 preset names; `AltarImagePresetName` type), the default background (`DEFAULT_ALTAR_BACKGROUND`), canonical grid defaults (`DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`), the background overlay defaults (`DEFAULT_BACKGROUND_OVERLAY` = `0.2`; `DEFAULT_OVERLAY_COLOR` = `'dark'`), and the resolution system: `DEFAULT_ALTAR_RESOLUTION` (`'1920x1080'`), `BASE_RESOLUTION_WIDTH` (1920), `MAX_ALTAR_RESOLUTION_W` (7680), `MAX_ALTAR_RESOLUTION_H` (4320), `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `sizeAndRatioFromResolution`, `parseResolution`, `resolveResolutionPixels`, `isRatioFormat`, and `ratioFromResolution`. `resolveResolutionPixels(res)` is the preferred helper when the input may be either a ratio string or a pixel string: ratio inputs are mapped to their `ALTAR_RESOLUTION_MAP.lg` canonical pixel size first, then passed through `parseResolution`; pixel inputs go straight to `parseResolution`. All dashboard-facing code (`AltarCard`, `AltarCardPreview`, `AltarCanvas` thumbnail renderer) must use `resolveResolutionPixels` rather than calling `parseResolution` directly on `altar.resolution`. Also exports `getAltarBackgroundStyle(altar, imageSrc)` — the **single source of truth** for constructing the altar CSS background object; it accepts the altar record (to read `background_overlay` and `background_overlay_color`) and prepends a `buildOverlayGradient(opacity, color)` layer when the overlay value is greater than 0. The overlay layer is applied to **all** background types: custom images, image presets, gradient-color presets, and legacy colour presets. For custom image-backed backgrounds it enforces a `data:image/` prefix on `backgroundSrc` before interpolating into CSS; for image presets it constructs a `url("/backgrounds/{name}.webp")` CSS background; for gradient presets it prepends the overlay to the `generateGradientStyle(hex)` result; for colour presets it prepends the overlay to the value from `ALTAR_BACKGROUND_STYLES`. Unknown preset values fall back to `DEFAULT_ALTAR_BACKGROUND`. All components that need a background style must call this function rather than constructing the CSS inline. Gradient-colour preset helpers: `GRADIENT_PRESET_COLORS` (readonly tuple of 7 dark hex values used as colour-gradient presets), `LEGACY_GRADIENT_COLORS` (maps each preset name to its base hex value), `isGradientPreset(preset)` (returns true when the preset string matches one of the gradient preset names), `getGradientColor(preset)` (returns the hex string for a gradient preset or `null` for unknown inputs), and `generateGradientStyle(hex)` (builds the radial-gradient CSS string from a hex colour). These are used internally by `getAltarBackgroundStyle` and by `AltarSidebarPanel` to render the gradient swatch buttons. Category emoji helpers: `CATEGORY_EMOJIS` (a `Record<string, string[]>` of emoji suggestions keyed by default category name), `FALLBACK_CATEGORY_EMOJIS` (fallback array used when no entry matches a custom category name), and `ALTAR_CAT_EMOJIS` (flat palette array for the category emoji picker). `ALTAR_CATEGORIES` and `ALTAR_CATEGORY_EMOJI` have been removed — the authoritative category list is now stored in the `altar_categories` database table and loaded via `altarStore.fetchCategories()`. The SQL migration defaults for altar grid, resolution, and overlay columns must stay in sync with the constants in this file. `parseResolution` validates the input string against `/^\d+x\d+$/` and clamps both dimensions before returning `{ w, h }`. `isRatioFormat` tests whether a string is a ratio (e.g. `"16:9"`). `ratioFromResolution` returns the matching `AltarRatio` for either format.

## Altar UI Composition

Altar rendering and editing were split into focused components:

- **`src/components/altar/AltarItemVisual.tsx`** — shared visual renderer for altar items (emoji/image and candle animation treatment).
- **`src/components/altar/AltarCanvas.tsx`** — canvas scene rendering, placement transforms, drag/drop interactions, lock handling, and grid overlay drawing. The internal `_renderAltar(altar, backgroundSrc, placements, nativeW, nativeH, outW)` function owns the off-screen canvas draw pipeline and is shared by two exported helpers: `captureCurrentAltar(): Promise<string | null>` renders at 640 px wide with adaptive JPEG/WebP quality (0.85 → 0.65 → 0.45) capped at 512 KB — used for dashboard thumbnails, safe to call after unmount; `exportCurrentAltarImage(format?: 'jpeg' | 'png' | 'webp'): Promise<string | null>` renders at the full native resolution with no size limit — used by the "Save Image" button in the view-mode sidebar. The `format` parameter (default `'jpeg'`) controls the output encoding: JPEG at quality 0.97, WebP at quality 0.92, PNG lossless. `captureCurrentAltar` reads altar state from `useAltarStore.getState()` synchronously and is safe to call from a `useEffect` cleanup. The `captureRef` prop mechanism that previously threaded a capture callback through the component tree was removed in favour of these module-level exports. `_renderAltar` draws the grid after the overlay pass (step 3) using the same `resolveResolutionPixels` + `grid_size` → `numCols`/`numRows` arithmetic as the live SVG grid, so captured images and thumbnails are pixel-consistent with the on-screen grid.
- **`src/components/altar/AltarLibraryStrip.tsx`** — docked library strip under canvas (edit mode), compact tiles, and modal CRUD for altar items. The add/edit item dialog is implemented as an `ItemModal` sub-component and the add/edit/delete category dialog as a `CategoryModal` sub-component; each manages its own form state independently. `CategoryModal.save()` wraps the store call in try/catch; a `nameError` state displays the rejection message (e.g. "Category already exists") inline under the name input and clears automatically when the user resumes typing. The strip itself holds only strip-level state (selected tab, library height, drag/reorder state, scroll fade state). `LIBRARY_DEFAULT_HEIGHT` and `UNCATEGORIZED_TAB` are module-scope constants. Category tab drag-to-reorder uses Pointer Events (not HTML5 drag API) for Tauri/WKWebView compatibility. The FLIP animation (`applyFlipAndUpdate`) snapshots tab positions before the state update, applies inverse `translateX` transforms after the DOM updates via `flushSync`, then removes them in a `requestAnimationFrame` tick with a `transition: transform 150ms ease` so tabs visually slide to their new positions. `dragCatIdRef`, `tabRefs`, `liveOrderRef`, and `lastHoverIdRef` coordinate drag state without stale closures; the `pointerup` handler reads the final order from `liveOrderRef` and calls `useAltarStore.getState().reorderCategories(finalOrder)`. The category scroll container hides its scrollbar (`scrollbar-none`) and shows left/right gradient fade overlays (`transition-opacity duration-150`) when content overflows in that direction; `checkCatScroll()` is called on `onScroll` and via `useEffect` after `displayCategories` changes. The `+ Category` button is placed outside the scroll container so it remains visible at all scroll positions.
- **`src/components/altar/AltarCard.tsx`** — `AltarCard`, `AltarListRow`, and `buildAltarContextMenuActions` — a plain function (not a component) that returns the action list for the altar dashboard context menu. `AltarCard` and `AltarListRow` render the saved thumbnail (`thumbnail_data`) when it is present and starts with `data:image/`; otherwise they fall back to `AltarCardPreview`. The thumbnail area is capped at `max-h-44` in card view. `resolveResolutionPixels` is used (not `parseResolution`) to derive aspect ratio values from the stored resolution string.
- **`src/components/altar/AltarCardPreview.tsx`** — preview scene used by the dashboard cards and list rows (background + placed items, both compact and full-size variants).
- **`src/components/altar/AltarRenameField.tsx`** — inline rename input used by the dashboard cards and list rows.
- **`src/components/sidebar/PlacedElementRow.tsx`** — `PlacedElementRow` and `PlacedElementInspector` for the sidebar's placed-elements list and its inline inspector. `PlacedElementRow` manages its own right-click context-menu state (position + portal render via `createPortal`). The delete button is in the row (Trash icon, rightmost). `PlacedElementInspector` shows a compact 4-column input grid (X, Y, Rot, Scale) plus a custom jade opacity slider (track/fill/thumb with a transparent range overlay). Inspector fields, labels, and unit symbols (`%`, `°`) use stone colour tokens; jade is used only for the selected row highlight (border and background) and the slider fill/thumb. Z-order buttons are not in the inspector — layer order is set by dragging rows in `AltarSidebarPanel`. A `focusedFieldRef` (`useRef<string | null>`) tracks which input is currently focused; the `useEffect` that syncs placement values from the store into draft state depends on all relevant placement fields (`x`, `y`, `width`, `height`, `rotation`, `opacity`, `id`) and skips updating the focused field so canvas drag-resize does not overwrite mid-edit input.
- **`src/components/sidebar/AltarReadingSummary.tsx`** — read-only sidebar panel shown in altar view mode. Displays a "Enter Fullscreen" button at the top, then a compact summary grid: aspect ratio, background (with swatch preview), overlay (percentage + color), grid (active/inactive + size), and placed element count. Resolves background info (preset name, gradient color, or custom image preview) via `useMemo` and the same constants used by the full editor. Also contains the Save Image block: a save button grouped with a three-button format picker (JPEG / PNG / WebP) in the same card; the selected format is stored in local state (`imageFormat`) and passed to `exportCurrentAltarImage(imageFormat)`; the OS save dialog filter and suggested filename extension are derived from the same value.

Supporting hooks:

- **`src/components/altar/useAltarBackgroundPreview.ts`** — background image preview resolution. Backed by a module-level cache (`cache: Map<path, dataUrl>`, `inFlight: Map<path, Promise>`) so the same path is read from Tauri at most once per session and consumers re-render via `useSyncExternalStore` when a load resolves.

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
- `altarStore` is the source of truth for altar records, items, placements, placement patch clamping, per-altar grid/snap configuration, and the item category list. The store holds a `categories: AltarCategory[]` slice and exposes five category actions: `fetchCategories` (loads all rows from `altar_categories` ordered by `sort_order ASC, created_at ASC, name ASC`), `addCategory` (inserts a new row with `sort_order = MAX(sort_order) + 1` and appends to the slice), `updateCategory` (updates name and emoji in the DB and cascades the name change to all affected `altar_items` and placement records in memory), `deleteCategory` (removes the row from `altar_categories` without touching `altar_items` — items whose `category` string no longer matches any category become visible under the Uncategorized pseudo-tab in the library strip), and `reorderCategories(ids: string[])` (writes a new `sort_order` for each category ID in the provided array and re-sorts the in-memory slice to match). `fetchCategories` is called automatically at the start of `fetchAltars`. The store also exposes `clearActiveAltar`, `bumpAltarUpdatedAt`, `updateAltarGrid`, `updateAltarResolution`, and `duplicatePlacement` actions. `bumpAltarUpdatedAt` updates only the `updated_at` column on placement edits. `updateAltarGrid(id, patch)` is the sole write path for all eight altar settings fields (grid_enabled, grid_size, grid_opacity, grid_color, snap_to_grid, rotation_snap_enabled, rotation_snap_angle, snap_scale_to_grid); it clamps all numeric values, validates the hex color, sets `updated_at`, and sorts the in-memory altar list by `updated_at`. `updateAltarResolution(id, resolution)` accepts either a ratio string (e.g. `"16:9"`) or a pixel string (`"WxH"`): ratio strings that are valid `AltarRatio` values are stored as-is; pixel strings are passed through `parseResolution` for clamping. Changing the resolution also sets `thumbnail_data = NULL` in SQL and clears the field in memory so the dashboard does not display a stale thumbnail at the old aspect ratio. `duplicatePlacement(id)` inserts a new row into `altar_placements` with a fresh UUID, copies width/height/rotation/opacity from the source, positions it +2% in both axes (capped at 100), assigns `z_index = max + 1`, sets locked and hidden to false, and immediately selects the new element. `updateAltar(id, patch)` applies the patch on top of the current live record inside the Zustand `set()` callback — it does not compute the merged object before calling `set()`. This is required because two rapid `updateAltar` calls (e.g. title then thumbnail from `handleDone`) must each see the previous call's result, not a shared pre-computed snapshot.
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
| `save_image(data_url)` | Decode base64 data-URL, write `{sha256}.{ext}`, skip if exists. Returns absolute path. |
| `copy_image_file(source)` | Read a file from an arbitrary path, write to images dir with SHA-256 name. Accepts png/jpg/gif/webp/svg only. Rejects symlinks, canonicalizes the source path, and verifies it falls within allowed storage roots (home, documents, downloads, desktop, app data, app config). |
| `read_image_as_base64(path)` | Read a file from the images dir and return it as a base64 data-URL. Path must be within the images directory (checked via `canonicalize`). |
| `cleanup_unused_images(used_paths, min_age_secs?)` | Delete unreferenced files older than N seconds (default 300). Returns count deleted. |
| `export_image(path, data_url)` | Decode a base64 data-URL and write the binary image bytes to a user-chosen path. Permitted extensions: `.png`, `.jpg`, `.jpeg`, `.webp`. Same symlink rejection, allowed-roots confinement, and `canonicalize`-before-write checks as `write_file`. |
| `write_file(path, content)` | Write UTF-8 text to a user-selected path. Permitted extensions: `.md`, `.emerald`, `.emeralddb`, `.json`, `.txt`. Path must resolve within allowed storage roots. |
| `read_file(path)` | Read a file and return its UTF-8 content. Same extension allowlist and root confinement as `write_file`. |
| `ensure_app_storage_dirs()` | Create app data and app config directories if they don't exist. Called before frontend writes vault metadata or opens SQLite. |
| `export_pdf(html, path)` | Render the supplied HTML to a PDF at `path` by driving the app's own webview. The frontend first prompts the user for a save location via the `dialog` plugin and passes the chosen path here. Per-platform implementations live in `src-tauri/src/pdf_export/{windows,macos,linux}.rs`, all behind the same `pub async fn export_pdf` signature; `mod.rs` does the `#[cfg(target_os = "…")]` re-export so `lib.rs` calls `pdf_export::export_pdf` without knowing which platform it's on. |
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

## PDF Export

Emerald renders PDFs by driving the app's own embedded webview rather than bundling a separate HTML-to-PDF engine. The implementation is split across one module file per platform, dispatched at compile time by `#[cfg(target_os = "…")]` in `src-tauri/src/pdf_export/mod.rs`, so `lib.rs` only has to call `pdf_export::export_pdf(&app, html, path).await` regardless of the host OS.

### Flow (all platforms)

```
frontend export.ts:exportAsPDF
    ↓  build full HTML (DOMPurify, transformInternalLinks, embedImages)
frontend save() dialog → user picks destination path
    ↓  invoke('export_pdf', { html, path })
src-tauri/src/lib.rs:export_pdf
    ↓  pdf_export::export_pdf(&app, html, path).await
src-tauri/src/pdf_export/{windows,macos,linux}.rs
    ↓  write HTML to a unique temp file (file:// URL)
    ↓  build a hidden WebviewWindow pointing at that file
    ↓  wait for PageLoadEvent::Finished via tokio::sync::oneshot
    ↓  with_webview(...) → call platform's native PDF API
    ↓  close the hidden window + remove the temp file
    ↓  return Result<(), String> → frontend toasts success/failure
```

All three platforms share the same shape — hidden webview, oneshot-coordinated page-load wait, `with_webview` to reach the platform webview, native PDF API call, hidden window + temp file cleanup in a `Drop`-style guard. The differences are entirely in step 4 (the platform webview API).

### Per-platform implementations

- **Windows (`src-tauri/src/pdf_export/windows.rs`)** — builds a hidden `WebviewWindow` with `WebviewWindowBuilder`, waits for `PageLoadEvent::Finished` via a `oneshot` signalled from `on_page_load`, then calls `with_webview` to reach the WebView2 controller. Casts the core to `ICoreWebView2_7` and invokes `PrintToPdf(PCWSTR, settings, ICoreWebView2PrintToPdfCompletedHandler)`. The COM completion handler runs on a worker thread; the Rust side bridges it back to async with a second `oneshot` wrapped in `Arc<Mutex<Option<_>>>` so the handler can move it out. Two timeouts cap the operation: 30 s for the page-load wait and 120 s for `PrintToPdf` itself.
- **macOS (`src-tauri/src/pdf_export/macos.rs`)** — same shape. Reaches the `WKWebView` pointer via `with_webview` and calls `createPDFWithConfiguration:completionHandler:`. The completion handler runs on a background queue and is bridged back to async with a `block2::ConcreteBlock` + `oneshot`. The hidden `WKWebView` is written to disk via `NSData.writeToFile:atomically:` inside the completion handler. `MainThreadMarker` is acquired inside the `with_webview` closure because that closure dispatches us to the AppKit main thread.
- **Linux (`src-tauri/src/pdf_export/linux.rs`)** — same shape. Uses `WebKitPrintOperation` configured with `PrintOperationOutputFormat::Pdf` and `output_uri = "file://<path>"`, then calls `print(PrintOperationAction::Export)`. The synchronous Rust binding blocks inside `with_webview` until the operation finishes writing the PDF; a post-check `stat`s the output file and returns an error if it landed as a zero-byte PDF (the WebKit print API can succeed while producing an empty file). Supported distro matrix: Ubuntu 22.04 LTS and 24.04 LTS.

### Frontend responsibilities

Because the hidden webview inherits the app CSP (`script-src 'self'`, see `tauri.conf.json`), the frontend does everything that the old print-window approach did with inline JavaScript before it hands the HTML to Rust:

- `transformInternalLinks(html)` in `src/lib/export.ts` walks every `<span data-type="internalLink">` and bakes the chip (icon `<img>`/`<span>` + label `<span>`) into the DOM. This replaces the `TRANSFORM_LINKS_JS` inline `<script>` that the old print window ran, and is required because the new webview's CSP blocks inline scripts.
- `embedImages(html)` resolves every file-backed `src="…"` to a base64 data-URL via the `read_image_as_base64` IPC command before export. The hidden webview runs on a `file://` URL and would otherwise not have access to images stored outside the document directory.
- `resolveInternalLinkIcons(html)` fills in missing `data-icon` attributes from the live store state at export time, so chips saved without an icon still render correctly.
- DOMPurify sanitisation runs in TypeScript before the HTML is passed to the backend, with the TipTap internal-link attributes explicitly allowlisted so chips survive the pass intact.

### Menu enablement gating

The three "Export as …" menu items (`export-pdf`, `export-markdown`, `export-emerald`) are only meaningful when a Journal / Wiki / Operations entry is actually open. The gating is done in two places:

- **Rust (`src-tauri/src/lib.rs`)** — the menu items are constructed with `enabled: false` in the `setup` block, so they start greyed out. The `set_export_menu_enabled(app, enabled)` Tauri command walks the `export-submenu` and toggles each of the three items.
- **Frontend (`src/components/layout/AppShell.tsx`)** — a `useEffect` keyed on `activeView.type` and `activeView.id` calls `invoke('set_export_menu_enabled', { enabled })` with `enabled = (activeView.type ∈ {journal, wiki, operations}) && !!activeView.id`. The effect re-runs on every view change.

This wiring predates the PDF export migration and is unchanged by it; the migration only replaced the *implementation* behind `export-pdf`, not the gate.
