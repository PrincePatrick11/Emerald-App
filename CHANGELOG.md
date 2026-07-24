# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 0.1.3.5

### Added
- Settings → Backup: a new **Tasks** checkbox (enabled by default) controls whether the Tasks module is included in `.emeralddb` exports and imports. The import preview now also shows the number of tasks in the backup file. Labels for the new checkbox are localised in EN / DE / ES / FR (`settings.includeTasks`).
- Altars can now be exported to and imported from the `.emerald` format. There is no separate altar-only menu entry — the existing **Export → Export as Emerald…** item is reused, enabled whenever a Journal/Wiki/Operations entry is open or an Altar is open in reading view, and exports whichever is currently active. The file carries the altar's background, overlay, grid/snap settings, resolution, item categories, and every placed item; on import, missing categories are created first, and library items are matched against the existing library by name + category + image content so re-importing the same file, or importing into a vault that already has matching items, does not create duplicate library entries. If the import fails partway through, the new altar and any newly created (not reused) library items are rolled back rather than left as orphaned debris. (`src/lib/emeraldFormat.ts`)

### Changed
- Altar reading view: the **Save Image** export (JPEG / PNG / WebP) moved from a button in the right sidebar into the native application menu, under **Export → Export as Image**. The submenu is enabled only while an Altar is open in reading view — it stays disabled while editing an altar or when no altar is open, matching how the other Export menu items are gated.
- PDF export now uses the app's own webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). The export flow matches the Markdown and Emerald exports: a native save dialog asks for the destination and the PDF is written straight to disk — no preview window, no system print dialog, no printer selection step. Emoji render natively in the PDF (Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji), so emoji inside entries and chips display as proper colored glyphs. Windows is implemented and tested end-to-end; the macOS and Linux implementations are in place but not yet verified on real hardware. See [Architecture → PDF Export](Documentation/architecture.md#pdf-export) for the per-platform implementation notes.
- **Export → Export as PDF…** is now also enabled while an Altar is open in reading view (not while editing it). For an open altar, the same menu item exports the rendered altar image as a single-page PDF instead of entry text content; the page size is derived from the altar's own aspect ratio (e.g. a 9:16 altar produces a portrait page, a 16:9 altar a landscape page) rather than always using a portrait Letter page. On Windows this is applied natively via a custom page size in the print pipeline; on macOS and Linux the export still succeeds but currently falls back to the default page size. Journal/Wiki/Operations PDF export is unaffected.

### Fixed
- `.emeralddb` backup export did not include Tasks at all — the backup pipeline had fallen out of sync after the Tasks module was added, so `tasks`, `task_categories`, and `task_links` were silently dropped from the export. All three tables are now exported, with `task_links` scoped to the exported task IDs and soft-deleted rows filtered out. On import, `useTaskStore` is reloaded so the imported tasks are visible in the UI immediately. (`src/lib/dbBackup.ts`)
- Altar backup coverage was also out of sync: the `altar_categories` table was missing from the export, and the path-remap for altar image columns was incomplete (only `background_image_data` was being remapped). The new `thumbnail_data` and `icon_data` columns are now part of the altar image-field set, and `altar_categories` is exported, filtered, deleted, and re-inserted alongside the rest of the altar tables. (`src/lib/dbBackup.ts`)

## [0.1.3] - 2026-06-15

### Security
- PDF export: HTML content is now sanitised with DOMPurify before being written into the export template. TipTap internal-link attributes (`data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`, `data-entry-number`, `data-href`) are explicitly allowlisted so link chips survive the sanitisation pass intact (`src/lib/export.ts`).
- Altar favicon and icon uploads: SVG files are rejected at the upload step (`file.type === 'image/svg+xml'` returns early). SVG data-URLs are also filtered out from the rendered `<img>` element in the reading-summary panel, preventing SVG-based injection via the icon field (`AltarSidebarPanel.tsx`).
- Rust `write_file` and `export_image`: removed redundant pre-`canonicalize` parent-directory checks that ran before `create_dir_all`; the post-`canonicalize` confinement check that runs after directory creation is sufficient and avoids TOCTOU issues (`src-tauri/src/lib.rs`).

### Added
- Altar: **per-altar favicon** — each altar can have a custom favicon: either one of 30 curated spiritual emojis (selectable from an inline grid) or an uploaded image stored directly as base64. The favicon appears in the tab bar in place of the generic flame icon and as the first row in the view-mode summary panel. Set, change, or remove it via the collapsible "Favicon" section at the top of the sidebar in edit mode. Stored in `altars.icon_data` (migration v29).
- Altar library: **drag-to-reorder category tabs** — drag any category tab left or right to change its position; tabs animate smoothly into their new slots with a FLIP transition (150 ms ease); the new order is persisted immediately to the database and survives app restarts
- Altar view mode sidebar: **Save Image button** — a "Bild speichern…" / "Save Image…" button in the reading summary sidebar renders the active altar at its full native resolution and saves it to a user-chosen path via the native OS save dialog; three format buttons (JPEG / PNG / WebP) directly below the save button let you pick the output format; the active format is highlighted with a jade ring; the default filename and save dialog filter adapt to the selected format (e.g. `AltarTitle_YYYY-MM-DD.png`); the button shows in-progress, success, and error feedback states; i18n in de/en/fr/es
- Image upload: **format validation** — all six file inputs in the app now accept only `image/png`, `image/jpeg`, `image/gif`, `image/webp`, and `image/svg+xml` (instead of the permissive `image/*`); files with unsupported MIME types are rejected before any backend call with an inline error message; `ACCEPTED_IMAGE_MIME` (string for the `accept` attribute) and `isAcceptedImageFile(file)` (MIME validator) are exported from `src/lib/helpers.ts` and shared by all six upload sites: altar background, altar icon, library item image, operation/wiki icon, operation/wiki cover image, and editor image insert; paste events in the rich editor also run the same check; dragging an unsupported file from Finder into the rich editor shows a modal popup (backdrop-blur, alert icon, list of allowed formats, OK button) instead of silently ignoring the drop
- Altar reading view sidebar: **summary panel** (`AltarReadingSummary`) — when viewing an altar outside edit mode, the right sidebar now shows a compact read-only summary instead of the full editor: the current aspect ratio, a background swatch with label, overlay percentage and color, grid status (active/inactive with size), and the number of placed elements. A "Enter Fullscreen" button at the top mirrors the existing full-window focus toggle.
- Altar dashboard: **thumbnail preview** on each altar card and list row — a native Canvas 2D renderer captures the altar's background, overlay, and all visible placements into a JPEG data-URL that is stored per altar in `altars.thumbnail_data`; the thumbnail is generated non-blocking after each save and patched into the database asynchronously so navigation is not delayed; altars without a saved thumbnail continue to show the live `AltarCardPreview` fallback
- Altar sidebar: **Background Overlay** collapsible section (edit mode only) — a jade-styled slider (0–100%) lets you control the darkness of a gradient overlay on top of the altar background image; the value is persisted per altar in the database (0.0–1.0, default 0.2); the section is now titled "Overlay Options" and is grouped in a bordered box containing both the opacity slider and the dark/light color toggle
- Altar backgrounds: **16 photographic image presets** (forest, mountains, caves, magic portals, temples, and halls) selectable from a 4-column thumbnail grid below the colour presets in the sidebar; each preset has a localised name in all four languages (EN/DE/ES/FR)
- Altar library: **Escape** key exits full-window mode — pressing Escape while an altar is in full-window view returns to normal view mode without requiring mouse interaction
- Altar library: **Uncategorized** pseudo-tab — when one or more library items have a category string that no longer matches any existing category (e.g. after that category was deleted), an "Uncategorized" filter tab appears automatically in the library strip; it disappears again once all affected items are reassigned or removed
- Altar library: dynamic item categories — create, rename, and delete categories from the library strip; 8 built-in categories (Candle, Crystal, Herb, Deity, Symbol, Tool, Table, Other) are pre-seeded in the database on first run
- Altar library: the add-item button now shows an "Element" label (previously unlabelled)
- Altar library: when uploading an image for a library item, if the name field is empty the filename (without extension) is pre-filled and selected automatically. (`AltarLibraryStrip.tsx`)
- Altar edit mode: per-altar **snap rotation angle** setting — a toggle plus a 1–180° step input and slider; when active, dragging the rotation handle snaps to the configured angle instead of free rotation (Shift still snaps to 15° when the toggle is off)
- Altar edit mode: per-altar **scale to grid** toggle — resizing a placement snaps its display size to multiples of `gridSize × 2`
- Altar edit mode: **Duplicate** button on each placed-element row — creates a copy with the same size, rotation, and opacity, offset +2% in both axes, placed on top (`z_index = max + 1`), unlocked, visible, and immediately selected
- Altar edit mode: **right-click context menu** on placed-element rows — shows "Duplicate" and "Remove" actions; portal-rendered at fixed position, closes on next click or right-click anywhere
- Altar sidebar: **collapsible sections** — "Background" / "Change Background", "Grid Options", and "Placed Elements" can each be toggled open or closed with a chevron button; all three default to open
- Altar sidebar: **section states persisted per altar** — the open/closed state of all six collapsible sidebar sections (Background, Overlay, Grid, Favicon, Canvas Options, Placements) is now stored in `localStorage` under the key `altar-sidebar-sections-<altarId>` and restored when switching between altars. Sections default to open when no stored state exists for an altar.
- Breadcrumb link back to the list view in OperationsView, WikiView, and JournalView (topbar, left of the entry title area)
- Altar inspector `z-index` input and expanded placement controls (`x/y`, scale, rotation, opacity, z-order)
- New Altar item category: `table` with i18n labels in all supported locales
- Modal-based Altar item add/edit/delete workflow in the docked library strip
- Altar sidebar: **Canvas Options** collapsible section (edit mode only) — lets you pick a canvas ratio (16:9, 4:3, 3:2, 1:1, 2:3, 9:16); the ratio is saved directly as a string (e.g. `"16:9"`) in the altar's `resolution` column so the canvas fills the available viewport at that proportion; migration v21
- Altar placed-elements list: **drag-to-reorder** Z-order — grip icon on each row; dragging a row repositions it in the list and immediately reassigns Z-index values across all placements (Pointer Events, no HTML5 drag API)

### Fixed
- Altar fullscreen: the Exit Fullscreen button was not visible when the right sidebar was open before entering fullscreen — the header button was gated on `!rightSidebarOpen`, which was `false` during fullscreen. The Minimize2 button now appears unconditionally whenever `altarWindowFullscreen` is true; the Maximize2 button only appears when not in fullscreen and the sidebar is closed.
- Altar sidebar: the "Canvas Options" section header lacked top margin when the "Favicon" section was collapsed, causing it to visually merge with the Favicon toggle. The Canvas Options button now carries `mt-4`, consistent with all other section headers in the sidebar.
- Altar library: selecting a category tab when two categories share the same name caused both tabs to appear active simultaneously. Category tabs now use the category's UUID as the selection key, not the display name.
- Altar grid: half-columns and half-rows appeared at the canvas edges — the previous CSS `background-size` tile approach accumulated sub-pixel rounding errors, especially on Retina displays. The grid is now rendered as a single SVG `<path>` element with lines placed at exact percentage positions, eliminating edge artefacts entirely.
- Altar grid: the visual grid changed shape on window resize because the CSS tile size was computed from the live container dimensions. Grid line count is now derived from a stable reference resolution (`resolveResolutionPixels`) that is independent of container size, so the grid scales with the canvas without changing cell count.
- Altar snap-to-grid (position): item positions snapped to the pixel-size grid rather than the visual grid lines, causing them to land between grid cells at some window sizes. Step sizes are now computed as `100 / gridNumCols` and `100 / gridNumRows` — matching exactly the visual grid line positions.
- Altar snap-to-grid (scale): item resize-snap was computed from `gridSize × 2` display pixels, which diverged from the visual cell width when the canvas was scaled or when using ratio-format resolutions. Scale-snap now counts cell spans (N cells wide and N cells tall) derived from the same reference resolution as the grid, so scaled items align on both axes.
- Altar grid in saved images and thumbnails: the grid was not rendered when capturing the altar via Canvas 2D. `_renderAltar` now draws the grid after the overlay pass, respecting `grid_enabled`, `grid_size`, `grid_color`, and `grid_opacity`.
- Altar inspector (`PlacedElementInspector`): X, Y, Scale, Rotation, and Opacity fields no longer reset to stale canvas values while the user is actively typing — the `useEffect` dependency array was previously `[placement.id]` only, so dragging or resizing an element on the canvas did not sync back to the sidebar fields; extended to all relevant placement properties with a `focusedFieldRef` to protect the currently focused input from being overwritten
- Altar thumbnail was not captured when leaving edit mode via the Cancel button, back-arrow breadcrumb navigation, or tab/module switch — thumbnails are now generated on all edit-mode exits, not only on Done (`AltarView.tsx`)
- Altar thumbnail concurrent-write race condition: calling `updateAltar` for the title and the thumbnail in parallel caused the title write (which snapshots the full row) to overwrite the thumbnail field that was saved a moment earlier; writes are now sequenced — title first, then thumbnail (`AltarView.handleDone`)
- `updateAltar` in `altarStore` applied the patch on top of a pre-computed snapshot rather than the current store state, causing two rapid calls to clobber each other's fields; the store setter now merges the patch into the live record inside the `set()` callback (`altarStore.ts`)
- Altar thumbnail on macOS silently produced lossless PNG instead of WebP when `canvas.toBlob('image/webp')` was requested under WKWebView, making photo backgrounds exceed the 512 KB budget with no quality control; the encoder now probes whether the result is actually WebP and skips directly to JPEG (which has reliable quality control under WKWebView) if not (`AltarCanvas.tsx`)
- Altar overlay gradient had no effect on gradient-color backgrounds and legacy preset backgrounds — `getAltarBackgroundStyle` now prepends the overlay layer for all background types, not only for custom image backgrounds
- Altar dashboard cards and list rows displayed thumbnails with an incorrect aspect ratio for altars whose resolution is stored as a ratio string (e.g. `'4:3'`): `parseResolution` always fell back to 16:9 for ratio-format strings; all call sites now use `resolveResolutionPixels` which maps the ratio to its canonical `lg` pixel size before computing the aspect ratio. Dashboard card thumbnails and the `AltarCardPreview` fallback now respect the actual canvas proportion (`AltarCard.tsx`, `AltarCardPreview.tsx`, `AltarCanvas.tsx`, `altarConstants.ts`)
- Changing an altar's canvas ratio left the previous thumbnail in the database, causing the dashboard card to show a stale preview at the wrong aspect ratio; `updateAltarResolution` in `altarStore.ts` now sets `thumbnail_data = NULL` in SQL and clears it in memory whenever the resolution is changed
- `getGradientColor` returned the raw string after `gradient:` without any format validation, allowing a malformed preset value to propagate into canvas colour parsing; the function now validates the extracted value against `/^#[0-9a-fA-F]{6}$/` and returns `null` for invalid input; call sites fall back to the default background colour
- Thumbnail `img` elements on dashboard cards accepted any non-empty `thumbnail_data` value as the `src`, including non-data-URL strings such as file paths or `tauri://` URIs; the `src` is now only bound when the value starts with `data:image/`
- Altar background CSS rule was constructed without validating the image source; `getAltarBackgroundStyle` in `altarConstants.ts` now enforces a `data:image/` prefix before interpolating into CSS, and all call sites use this single utility. (`altarConstants.ts`, `AltarCardPreview.tsx`, `AltarCanvas.tsx`)
- Altar item images in `AltarItemVisual` and `AltarLibraryStrip` were rendered as `<img>` regardless of the `image_data` value; they now only render when the value starts with `data:image/`.
- No file-size limit was enforced when uploading altar images; item images are now capped at 2 MB and background images at 5 MB before being processed.
- `customBackgroundMap` was seeded from and written back to `localStorage`, creating a dual source of truth with the database; the map is now in-memory only (in-session re-activation still works; the active path remains authoritative in the DB).
- `hexToRgb` in `AltarCanvas` accepted any string without validation and silently produced invalid RGB values; it is now moved to `helpers.ts`, validates with `isValidHexColor` first, and returns `{r:0,g:0,b:0}` for invalid input.
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
- German locale used `"Aufloesung"` instead of `"Auflösung"`; French locale used `"Resolution"` instead of `"Résolution"`; Spanish locale used `"Resolucion"` instead of `"Resolución"`.
- `backgroundOverlay` translation key was missing from `de.json`, `es.json`, and `fr.json`; all three locales now carry the key ("Hintergrund-Overlay" / "Superposición de fondo" / "Superposition de fond").
- `mushroom_forest_ritual` translation key removed from all four locale files; the corresponding preset no longer exists.
- Altar resize and rotate control handles were rendered at a fixed pixel size regardless of how much the canvas was scaled by CSS transform, making them appear oversized on small viewports. Handle sizes, icon sizes, offsets, and the rotation tooltip are now derived from `cssScale` so they remain visually consistent at any zoom level.
- Altar library "Add Category" modal: when `save()` threw on a duplicate category name, the error was swallowed and the modal stayed open silently. The save function is now wrapped in try/catch; a `nameError` state displays the error message inline beneath the input, and typing in the input clears the error immediately (`AltarLibraryStrip.tsx`).
- Duplicating an altar now copies the thumbnail preview and the favicon icon to the new altar — previously both fields were left NULL so the new card showed no preview and no tab icon (`altarStore.ts`, `insertAltarRow`).

### Changed
- **Emerald Parchment theme — Altar module**: all Altar UI elements now follow the Parchment colour palette. Control buttons in the sidebar use warm parchment tones (`#f3e6cf`) with brown border variants instead of dark stone colours. Danger (remove/delete) buttons use the theme's `--danger-*` CSS variables. CTA and fullscreen jade buttons render as solid green (`#159165` / `#0f7a54` on hover) with white text. The slider track colour changes from a dark grey to a warm translucent brown (`rgba(145, 108, 70, 0.20)`). The format-picker (JPEG/PNG/WebP) hover state and item-preview area background (`AltarReadingSummary`) also adapt to the parchment palette. Category-scroll fade overlays change from `from-stone-900` to a warm parchment tone (`#d8c4a0`) and are widened to `3.5rem` via the `.altar-cat-scroll-fade` utility class added to those elements in `AltarLibraryStrip.tsx`.
- Altar library strip category row: the scrollbar is hidden; gradient fade overlays on the left and right edges appear when content is scrollable in that direction, indicating overflow without a visible scrollbar; the `+ Category` button is anchored outside the scroll container so it stays in view regardless of scroll position
- Altar view mode sidebar (`AltarReadingSummary`): visual style aligned with edit mode — `SummaryRow` and `BackgroundRow` now use `rounded-lg`, `bg-stone-900/45`, `border-stone-700/60`, and `text-[11px] text-stone-300 tabular-nums`; `SectionTitle` uses `text-[11px]` without a leading icon; outer container gap increased to `gap-1.5`
- Altar sidebar: in reading view the sidebar no longer renders the full editor UI (background pickers, grids, placed-element list). Instead a compact summary panel (`AltarReadingSummary`) shows key canvas properties read-only. All edit controls now render only when the altar is in edit mode. The fullscreen button in the altar header is hidden when the right sidebar is open to avoid duplication with the sidebar's own fullscreen control.
- Altar sidebar: gradient and custom background rows now align with the preset card grid — both rows use `grid grid-cols-4` so the thumbnail occupies one column (same width as a preset card) and the two action buttons (`Change` / `Remove`) share the remaining three columns; button height reduced from `py-1.5` to `py-1`
- Altar dashboard card thumbnail area is capped at `max-h-44` (176 px): `<img>` thumbnails scale proportionally without cropping (`w-auto max-w-full`); the `AltarCardPreview` fallback is wrapped in a `max-h-44 overflow-hidden` container so portrait and square altars do not push card heights unboundedly
- Altar thumbnail capture width reduced from 1000 px to 640 px; encoding now uses adaptive quality (0.85 → 0.65 → 0.45 JPEG) and falls back to the next quality level only if the result exceeds the 512 KB budget (`AltarCanvas.tsx`)
- Thumbnail blobs are discarded without saving if they exceed 512 KB (524 288 characters), preventing oversized data-URLs from accumulating in the database (`AltarView.handleDone`)
- Altar sidebar sliders (Grid Size, Grid Opacity, Rotation Snap Angle, Background Overlay) now use the same custom track/fill/thumb design as the opacity slider in the placed-elements inspector — a relative container with an absolute track, fill bar, and thumb, and a transparent `<input type="range">` overlaid for interaction
- Altar inspector panel (placed-element fields, labels, unit symbols) now uses stone colour tokens throughout; jade highlight is reserved for the selected row border and background only; opacity slider track uses `stone-800/80` for the empty portion; unit symbols (`%`, `°`) and opacity value use `stone-500`/`stone-300`; inspector label font size increased from `text-[9px]` to `text-[10px]`
- Altar backgrounds: `mushroom_forest_ritual` image preset removed; preset count reduced from 17 to 16
- Altar canvas: empty-canvas "Drag items…" hint text removed; two decorative floor lines removed from the canvas scene
- Altar library: deleting a category no longer reassigns its items — items keep their original `category` string and become visible under the new Uncategorized tab instead of being silently moved to another category
- `AltarItemCategory` type widened from a fixed literal union to `string`; the valid values are now driven by the `altar_categories` table rather than a hardcoded constant
- `ALTAR_CATEGORIES` constant and `ALTAR_CATEGORY_EMOJI` map removed from `altarConstants.ts`; replaced by `CATEGORY_EMOJIS` (emoji suggestions keyed by default category name), `FALLBACK_CATEGORY_EMOJIS` (fallback array for custom categories), and `ALTAR_CAT_EMOJIS` (palette for the category emoji picker); Symbol category emoji corrected from `☽` to `🌙` (migration v23)
- Altar canvas rendering: the canvas now renders at its native resolution (e.g. 1920×1080) and is scaled down to fit the viewport via a single CSS `transform: scale()` on a wrapping div. This replaces the previous percentage-based stretching approach and means placement coordinates, grid snap steps, handle sizes, and font sizes all operate in native pixels — eliminating rounding artefacts at non-standard viewports.
- `AltarCanvas` accepts `nativeW` and `nativeH` props (resolved in `AltarView`) in addition to `resolution` and `cssScale`. `canvasScale` is now computed from the pre-resolved `nativeW`/`nativeH` values rather than calling `parseResolution` inside the canvas, so ratio-format resolutions are handled correctly.
- `AltarView` `ResizeObserver` handles both ratio-format resolutions (e.g. `"16:9"`) and pixel-format resolutions (e.g. `"1920x1080"`): ratio mode derives `nativeW`/`nativeH` dynamically from the viewport size and sets `scale: 1`; pixel mode continues to compute a CSS `scale` factor as before.
- `canvasTransform` in `AltarView` now stores `nativeW` and `nativeH` alongside `scale`, `offsetX`, and `offsetY` and is initialised with `{ scale:1, offsetX:0, offsetY:0, nativeW:1920, nativeH:1080 }`, eliminating a flash on first render.
- `altarWindowFullscreen` is synced into a `useRef` (`altarWindowFullscreenRef`) that is read inside the `ResizeObserver` callback, so toggling full-window mode no longer tears down and recreates the observer.
- `reorderCategories` in `altarStore` now issues a single bulk `UPDATE … CASE` statement for all reordered tabs instead of N individual `UPDATE` calls, reducing database round-trips on every drag-to-reorder action.
- `handleMouseMove` and `handleMouseUp` in `AltarCanvas` are now wrapped in `useCallback`; `coordsToPercent` was added to the dependency array of the sidebar-drag `useEffect` where it was previously missing.
- "Duplicate" and "Remove" labels in placed-element row context menus now use the i18n keys `altar.duplicateElement` / `altar.removeElement` instead of hardcoded English strings (`PlacedElementRow.tsx`).
- `ACCEPTED_IMAGE_MIME_LIST` in `helpers.ts` is declared `as const`; `ACCEPTED_IMAGE_MIME` is derived from it, making the two values a single source of truth.
- `PlacedItemProps` interface for the internal `PlacedItem` component in `AltarCanvas` is now declared as a named interface rather than an inline object type.
- Creating a new altar via the "+" button now opens the altar immediately in edit mode instead of view mode.
- Altar sidebar Canvas Options section simplified: size preset buttons (Small/Medium/Large/Very Large) and the custom W×H inputs are removed; only the six ratio buttons remain (full-width, 3-column grid). Selecting a ratio stores the ratio string directly in the database.
- Placed-element inspector redesigned: compact 4-column grid for X(%), Y(%), Rot(°), Scale(%); jade-colored custom opacity slider with a track and thumb dot; Z-order buttons and the trash icon removed from the inspector (delete remains in the row, Z-order is now handled via drag-to-reorder in the list).
- Inspector field labels no longer include unit annotations in the translation strings (e.g. `"X"` instead of `"X (%)"`, `"Rot"` instead of `"Rot (deg)"`); units are now rendered as absolute positioned spans inside the input fields.
- Placed-element rows: Z-index value display (`"zx"`) removed from the row; Z-order action buttons (toFront/forward/backward/toBack) removed from the row in favour of drag-to-reorder.
- LeftSidebar restructured: Journal, Tasks, Operations, Wiki, and Altar are now in a fixed non-scrollable nav block at the top; the journal entries list scrolls independently below it; Settings, Tags, and Trash are condensed into an icon-only row at the bottom (size 18, no text labels; Trash is right-aligned).
- Draggable tab reordering in the tab bar with animated movement
- Tab bar refined: the active tab now visually flows into the main content panel below (matching color, no separator line) while inactive tabs remain clearly separated by a 1px divider; the `backdrop-filter: blur` and active-tab drop shadow were removed as they contradicted the seamless effect
- `AltarLibraryStrip` modal UI split into dedicated `ItemModal` and `CategoryModal` sub-components; each manages its own form state so the strip no longer holds modal-level state
- `AltarContextMenuActions` renamed to `buildAltarContextMenuActions` to reflect that it is a plain function, not a component
- `insertAltarRow` helper centralises the altar INSERT SQL; `createAltar` and `duplicateAltar` both use it instead of duplicating the statement
- `sendPlacementToBack` now issues a single bulk `UPDATE … CASE` SQL plus one `bumpAltarUpdatedAt` call instead of N+1 individual writes
- `_swapPlacementZIndex` renamed to `swapPlacementZIndex` (private-by-convention underscore removed)
- `readFileAsDataUrl` utility added to `helpers.ts`; replaces the duplicated `FileReader` + Promise pattern previously inlined in `AltarLibraryStrip` and `AltarSidebarPanel`
- `hexToRgb` moved from `AltarCanvas.tsx` to `helpers.ts`; `isValidHexColor` guard added
- `mapEachPreview` and `filterEachPreview` helpers added to `altarStore.ts` to replace eight duplicated `Object.fromEntries(Object.entries(…).map/filter(…))` patterns
- `normalizeAltar` in `altarStore.ts` uses the shared `isRatioFormat()` from `altarConstants.ts` instead of a duplicate inline regex
- `getAltarBackgroundStyle` in `altarConstants.ts` is now the single source of truth for background CSS; local `buildImageStyle` and `resolvePresetStyle` helpers removed from `AltarCardPreview`; `hasImage` guard removed (the utility handles the null/invalid-src case internally)
- Altar "bring forward" / "send backward" layer reordering coalesced into a single atomic database write per click, replacing the previous two-write sequence
- Database schema migrations refactored into a versioned, ordered list tracked via a `schema_version` table; existing vaults upgrade transparently on first open
- Wiki and Operation custom icons now render image icons only from safe local/data/blob sources (`/`, `data:image/...`, `blob:`); remote `http(s)` URLs are treated as non-image icons
- Operations and Home dashboard operation cards/lists now consistently use custom operation icons first, then category emoji fallback
- Altar inspector now renders inline under the selected placed-element row in the sidebar
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
