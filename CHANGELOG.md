# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 0.1.3

### Added
- Altar library: dynamic item categories — create, rename, and delete categories from the library strip; 8 built-in categories (Candle, Crystal, Herb, Deity, Symbol, Tool, Table, Other) are pre-seeded in the database on first run
- Altar library strip: hover a category tab to reveal a pencil edit button; a "+ Category" button appends new categories
- Altar library: the add-item button now shows an "Element" label (previously unlabelled)
- Altar library: when uploading an image for a library item, if the name field is empty the filename (without extension) is pre-filled and selected automatically. (`AltarLibraryStrip.tsx`)
- Altar edit mode: per-altar **snap rotation angle** setting — a toggle plus a 1–180° step input and slider; when active, dragging the rotation handle snaps to the configured angle instead of free rotation (Shift still snaps to 15° when the toggle is off)
- Altar edit mode: per-altar **scale to grid** toggle — resizing a placement snaps its display size to multiples of `gridSize × 2`
- Altar edit mode: **Duplicate** button on each placed-element row — creates a copy with the same size, rotation, and opacity, offset +2% in both axes, placed on top (`z_index = max + 1`), unlocked, visible, and immediately selected
- Altar edit mode: **right-click context menu** on placed-element rows — shows "Duplicate" and "Remove" actions; portal-rendered at fixed position, closes on next click or right-click anywhere
- Altar sidebar: **collapsible sections** — "Background" / "Change Background", "Grid Options", and "Placed Elements" can each be toggled open or closed with a chevron button; all three default to open
- Breadcrumb link back to the list view in OperationsView, WikiView, and JournalView (topbar, left of the entry title area)
- `contextMenu.openInNewTab` translation key added to all four locales (de/en/es/fr); the "Open in New Tab" context menu item is now fully localised
- `isImageIcon` helper extracted to `src/lib/helpers.ts` and shared across OperationsView and WikiView
- Altar inspector `z-index` input and expanded placement controls (`x/y`, scale, rotation, opacity, z-order)
- New Altar item category: `table` with i18n labels in all supported locales
- Altar grid controls (overlay toggle, size, opacity, color, snap-to-grid, rotation snap, scale to grid) stored per altar in the database (grid columns migration v18; rotation/scale columns migration v19)
- Modal-based Altar item add/edit/delete workflow in the docked library strip
- Extracted Altar components and hooks for maintainability: `AltarItemVisual`, `AltarCanvas`, `AltarLibraryStrip`, and background preview hooks
- Altar sidebar: **Canvas Options** collapsible section (edit mode only) — lets you pick a canvas ratio (16:9, 4:3, 3:2, 1:1, 2:3, 9:16); the ratio is saved directly as a string (e.g. `"16:9"`) in the altar's `resolution` column so the canvas fills the available viewport at that proportion; migration v21
- `parseResolution`, `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `sizeAndRatioFromResolution`, `DEFAULT_ALTAR_RESOLUTION`, `BASE_RESOLUTION_WIDTH`, `MAX_ALTAR_RESOLUTION_W`, `MAX_ALTAR_RESOLUTION_H`, `isRatioFormat`, and `ratioFromResolution` exported from `altarConstants.ts`
- `updateAltarResolution` action on `altarStore` — accepts either a ratio string (`"16:9"`) or a `WxH` pixel string; validates and clamps before persisting
- Altar placed-elements list: **drag-to-reorder** Z-order — grip icon on each row; dragging a row repositions it in the list and immediately reassigns Z-index values across all placements (Pointer Events, no HTML5 drag API)

### Fixed
- Custom altar background images were deleted by the image cleanup routine on startup — altar `background_image_data` paths were not included in the used-paths set passed to `cleanup_unused_images`. (`AppShell.tsx`)
- Altar canvas did not display a custom background until an unrelated re-render triggered one; the background view is now reactive via `useSyncExternalStore` in `useBackgroundPreview`. (`AltarView.tsx`)
- Right-clicking a placed-element row in the Altar dashboard caused the app to go black — a React Rules of Hooks violation in `AltarContextMenuActions`, which called `useTranslation()` inside a conditional render path. (`AltarCard.tsx`)
- Category selection in OpPropertiesPanel reset to "Sigils" after 1.5 s whenever any sidebar field was changed on a newly created operation. Root cause: `triggerAutoSave` captured `pendingRef.current` at call time, so the debounced write overwrote the sidebar change. The ref is now read when the timer fires, not when `triggerAutoSave` is called. The same bug was present in WikiView and JournalView and is fixed there too.
- `OperationSigilView` breadcrumb was missing the category emoji and the separator dot between the category name and the date; both are now rendered.
- Built-in operation category names in the OperationsView breadcrumb (e.g. "Sigils", "Servitors") were displayed from the raw database seed value instead of the i18n key; they now go through `t('operations.categories.{id}')`.
- WikiView breadcrumb showed "Updated MMM d, yyyy"; the "Updated " prefix has been removed so it shows the date only.
- InternalLinkExtension rendered `[[Label(id)]]` raw text in edit mode instead of the chip used in view mode; chips are now shown in both modes.
- Altar dashboard was unreachable: opening the app, switching to the altar section, or clicking the back button always landed on a single altar. The dashboard (list of all altars) is now reachable from the back button and the altar entry in the left sidebar.
- Altar full-window mode did not activate when opening an altar directly (i.e. when `activeView.mode` is `undefined` rather than `'view'`); the check is now `mode !== 'edit'` so full-window works in all non-edit contexts.
- Altar canvas appeared vertically centred in the viewport by default; it now starts at the top edge in normal mode and centres only in full-window mode.
- Altar dashboard preview cards used a fixed `h-36` height regardless of the altar's aspect ratio; cards now use CSS `aspect-ratio` derived from the altar's stored resolution, so portrait and square canvases display proportionally.
- `parseResolution` now validates the input with a strict regex (`/^\d+x\d+$/`) and clamps width/height to the allowed maximum (7680×4320), preventing malformed strings or oversized values from reaching the canvas layout.
- Custom background URL was interpolated into CSS without validation; `AltarSidebarPanel` now checks that the value starts with `data:` or `tauri://` before using it in a CSS `backgroundImage` rule.
- German locale used `"Aufloesung"` instead of `"Auflösung"`; French locale used `"Resolution"` instead of `"Résolution"`; Spanish locale used `"Resolucion"` instead of `"Resolución"`.
- Altar resize and rotate control handles were rendered at a fixed pixel size regardless of how much the canvas was scaled by CSS transform, making them appear oversized on small viewports. Handle sizes, icon sizes, offsets, and the rotation tooltip are now derived from `cssScale` so they remain visually consistent at any zoom level.

### Changed
- `AltarItemCategory` type widened from a fixed literal union to `string`; the valid values are now driven by the `altar_categories` table rather than a hardcoded constant
- `ALTAR_CATEGORIES` constant and `ALTAR_CATEGORY_EMOJI` map removed from `altarConstants.ts`; replaced by `CATEGORY_EMOJIS` (emoji suggestions keyed by default category name), `FALLBACK_CATEGORY_EMOJIS` (fallback array for custom categories), and `ALTAR_CAT_EMOJIS` (palette for the category emoji picker); Symbol category emoji corrected from `☽` to `🌙` (migration v23)
- Altar canvas rendering: the canvas now renders at its native resolution (e.g. 1920×1080) and is scaled down to fit the viewport via a single CSS `transform: scale()` on a wrapping div. This replaces the previous percentage-based stretching approach and means placement coordinates, grid snap steps, handle sizes, and font sizes all operate in native pixels — eliminating rounding artefacts at non-standard viewports.
- `AltarCanvas` accepts `nativeW` and `nativeH` props (resolved in `AltarView`) in addition to `resolution` and `cssScale`. `canvasScale` is now computed from the pre-resolved `nativeW`/`nativeH` values rather than calling `parseResolution` inside the canvas, so ratio-format resolutions are handled correctly.
- `AltarView` `ResizeObserver` handles both ratio-format resolutions (e.g. `"16:9"`) and pixel-format resolutions (e.g. `"1920x1080"`): ratio mode derives `nativeW`/`nativeH` dynamically from the viewport size and sets `scale: 1`; pixel mode continues to compute a CSS `scale` factor as before.
- `canvasTransform` in `AltarView` now stores `nativeW` and `nativeH` alongside `scale`, `offsetX`, and `offsetY` and is initialised with `{ scale:1, offsetX:0, offsetY:0, nativeW:1920, nativeH:1080 }`, eliminating a flash on first render.
- `altarWindowFullscreen` is synced into a `useRef` (`altarWindowFullscreenRef`) that is read inside the `ResizeObserver` callback, so toggling full-window mode no longer tears down and recreates the observer.
- `PlacedItemProps` interface for the internal `PlacedItem` component in `AltarCanvas` is now declared as a named interface rather than an inline object type.
- Creating a new altar via the "+" button now opens the altar immediately in edit mode instead of view mode.
- Altar sidebar Canvas Options section simplified: size preset buttons (Small/Medium/Large/Very Large) and the custom W×H inputs are removed; only the six ratio buttons remain (full-width, 3-column grid). Selecting a ratio stores the ratio string directly in the database.
- Placed-element inspector redesigned: compact 4-column grid for X(%), Y(%), Rot(°), Scale(%); jade-colored custom opacity slider with a track and thumb dot; Z-order buttons and the trash icon removed from the inspector (delete remains in the row, Z-order is now handled via drag-to-reorder in the list).
- Inspector field labels no longer include unit annotations in the translation strings (e.g. `"X"` instead of `"X (%)"`, `"Rot"` instead of `"Rot (deg)"`); units are now rendered as absolute positioned spans inside the input fields.
- Placed-element rows: Z-index value display (`"zx"`) removed from the row; Z-order action buttons (toFront/forward/backward/toBack) removed from the row in favour of drag-to-reorder.
- LeftSidebar restructured: Journal, Tasks, Operations, Wiki, and Altar are now in a fixed non-scrollable nav block at the top; the journal entries list scrolls independently below it; Settings, Tags, and Trash are condensed into an icon-only row at the bottom (size 18, no text labels; Trash is right-aligned).
- Draggable tab reordering in the tab bar with animated movement
- Tab bar refined: the active tab now visually flows into the main content panel below (matching color, no separator line) while inactive tabs remain clearly separated by a 1px divider; the `backdrop-filter: blur` and active-tab drop shadow were removed as they contradicted the seamless effect
- Altar "bring forward" / "send backward" layer reordering coalesced into a single atomic database write per click, replacing the previous two-write sequence
- Database schema migrations refactored into a versioned, ordered list tracked via a `schema_version` table; existing vaults upgrade transparently on first open
- Wiki and Operation custom icons now render image icons only from safe local/data/blob sources (`/`, `data:image/...`, `blob:`); remote `http(s)` URLs are treated as non-image icons
- Operations and Home dashboard operation cards/lists now consistently use custom operation icons first, then category emoji fallback
- Altar inspector now renders inline under the selected placed-element row in the sidebar; the delete button for the selected element was moved from the row into the inspector header (top-right corner)
- Altar library moved under the canvas in edit mode and switched to compact tile sizing (70×85)
- Altar placement defaults/limits updated (default size 40; width/height clamped with max 500; numeric patch clamping centralized in store)
- Locked Altar placements are now click-through on canvas (`pointer-events: none`)
- Full-window Altar mode behavior refined: edit mode exits full-window, and edit-only controls (including grid options) remain hidden in view mode
- Altar placed-element rows are now selectable in view mode (not only edit mode); clicking a row in the sidebar highlights the element on the canvas with a jade border; clicking empty canvas or sidebar area deselects
- Clicking an already-selected placed-element row a second time deselects it (inspector closes)
- Placed-element rows in the sidebar use larger touch targets (`px-2 py-2`), a 20 px item visual, and `text-sm` labels; icon buttons are spaced with `gap-1.5`
- Button order in placed-element rows (edit mode) changed to: Duplicate → Lock → Eye
- Altar sidebar "Background" section header shows "Background" in view mode and "Change Background" in edit mode (`altar.background` i18n key added to all four locales)
- Altar grid settings (enabled, size, opacity, color, snap-to-grid) migrated from `uiStore` / localStorage to per-altar database columns so each altar remembers its own grid configuration independently
- `updateAltarGrid(id, patch)` is the sole write path for all altar grid/snap fields (grid options + rotation snap + scale to grid); values are clamped and validated before persistence
- Altar canvas drag performance: `movePlacement` no longer rebuilds the `previewPlacements` map on every pointer move event (60–120 Hz); the preview is synced once on mouse-up via `savePlacementPosition`, eliminating per-frame full-view re-renders during drag
- `AltarItemVisual` wrapped in `React.memo`; `PlacedItem` callbacks refactored to stable `useCallback` references with an `id` parameter so `React.memo` on `PlacedItem` now bails out correctly — only the actively dragged element re-renders during a drag gesture
- Custom background preview map and custom-background chip rendering hardened for consistent persistence previews
- Fixed-scene Altar rendering experiment rolled back; responsive percentage-based scene rendering retained
- Altar delete/edit flows consolidated around modal interactions and in-context confirmations
- Altar UI store consumption refactored toward granular selectors to reduce rerenders
- Altar placed-element rows and inline inspector extracted into `PlacedElementRow` and `PlacedElementInspector` so typing in inspector inputs no longer re-renders unrelated rows
- Altar dashboard cards and list rows extracted into `AltarCard`, `AltarListRow`, and `AltarCardPreview`; altar background previews resolved from a shared module-level cache so they survive view re-mounts and vault switches

### Known Issues
- Remaining Altar edge case: element drift can still occur during some resize transitions
- Non-fatal build warning remains after Altar refactor (details currently unknown)

## [0.1.2] - 2026-05-20

### Added
- Tasks module with categories, priorities (Low/Medium/High), hierarchical subtasks, and cross-references to Journal, Wiki, and Operations
- Category management: create, rename, delete with 2-click confirmation, uncategorized fallback
- Task filtering by category (multi-select) and priority (multi-select)
- Category-grouped list view with collapsible sections
- Inline task title editing (double-click)
- Task context menu (mark complete, add subtask, link entry, delete)
- Link modal to connect tasks with Journal entries, Wiki articles, and Operations
- Trash integration for tasks and task categories (soft-delete, restore, permanent delete)
- `safeParseArray` helper extracted to `src/lib/helpers.ts`
- `CategoryBase` interface in types, shared by OperationCategory, WikiCategoryDef, and TaskCategory
- Named themes: **Emerald Noctis** (dark, default) and **Emerald Parchment** (light), replacing the generic dark/light toggle
- Split theme CSS files under `src/themes/` with shared CSS custom property architecture
- Tailwind colour-class bridge for light mode in `src/index.css`
- Shared style constants: `altarConstants.ts` (altar backgrounds, category emojis) and `styleClasses.ts` (input/select class strings)
- `htmlEscape()` helper in `export.ts` — all user text in PDF export HTML is now entity-escaped
- Theme documentation refresh in `Documentation/architecture.md` and `Documentation/features.md` covering token strategy, theme normalization flow, and Tailwind bridge behavior for both Emerald themes
- Typography settings: independent UI font and editor body font dropdowns in Settings > Appearance with 8 typefaces (Inter, Source Sans 3, Nunito, IBM Plex Sans, Alegreya, Cormorant Garamond, Lora, Merriweather); stored as `ui-font-id` and `editor-font-id` in localStorage

### Changed
- Theme preference stored under `theme-id` (legacy `theme` key is migrated automatically)
- PDF export metadata rendering hardened with stricter HTML escaping and image data-URL validation
- Emerald Noctis theme refactored to mirror Emerald Parchment architecture with expanded component-level coverage (shell, sidebars, tabs, panels, settings surfaces, list/filter toolbars, and link modals)
- Noctis visual tuning updated toward a warmer dark counterpart with adjusted global surface balance and tab-to-main alignment
- Shared UI color rules in `src/index.css` migrated from hardcoded values to semantic CSS tokens for list toolbar, filter states, and wiki emoji/search controls
- Theme ID normalization consolidated to a single source in `src/themes/theme.ts` and reused by `src/store/uiStore.ts` for localStorage resolution and legacy fallback mapping
- `dbBackup.ts` date filter (`buildDateFilter`) now uses positional SQL parameters (`$1`, `$2`) instead of string interpolation for `created_at` range queries
- `copy_image_file` Rust command hardened: rejects symlink sources, canonicalizes paths, and verifies confinement within allowed storage roots before reading
- `write_file` and `read_file` now enforce root-directory confinement (home, documents, downloads, desktop, app data, app config) in addition to the extension allowlist
- `write_file` rejects symlink targets and verifies canonical paths against allowed roots
- `.emeralddb` added to the permitted extension allowlist for `write_file` and `read_file`
- Heading font setting removed from Settings; entry titles and editor headings now inherit the editor body font

## [0.1.1] - 2026-05-09

### Added
- Browser-like content tabs for opening multiple entries simultaneously
- Middle-click on any entry opens it in a new tab
- Tab order persisted across app restarts via the existing `open-tabs` localStorage workspace state

### Changed
- Editors render only after loading the matching content, preventing stale-state flicker
- App storage directories are ensured before opening SQLite
- Autosave no longer writes to newly opened entries until they are fully loaded

## [0.1.0] - 2026-05-03

### Added
- Journal with rich-text editor, moon phase tracking, paradigm/banishing/meditation classification
- Wiki with 12 built-in category types and custom categories
- Operations module with active/inactive status, versioning, and linked content
- Sigil workflow: intention text, letter reduction, canvas drawing, charging state
- Altar dashboard with drag-and-drop item placement and background presets
- Routines as reusable templates droppable into journal entries
- Internal links between all content types (`[[` autocomplete + link picker)
- Backlink graph across journal, wiki, and operations
- Tags with color management across all content types
- Custom properties (text, number, date, toggle, checkbox) with optional entry badges
- Export: PDF, Markdown, Emerald format (`.emerald`) with embedded images
- Import: Markdown with frontmatter, Emerald format
- Full database backup/restore (`.emeralddb`) with merge and add-vault modes
- Multi-vault support (separate SQLite databases)
- Trash with soft-delete, 5-second undo toast, and 30-day auto-purge
- Localisation: English, German, Spanish, French
- Dark/light mode toggle
