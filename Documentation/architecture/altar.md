# Altar

## Altar UI Composition

### Which altar is displayed

`AltarView`, `AltarSidebarPanel` and `AltarReadingSummary` read the active altar through `useDisplayedAltar()` (`src/hooks/useDisplayedAltar.ts`), not through `altarStore.activeAltarId` directly. `setActiveAltar` loads the placements asynchronously, so for one tick after `activeView.id` points at the new altar the store still holds `null` or the previous altar and its `placements`. Reading the store directly would flash the dashboard, or the old altar, when an altar is opened via a link or switched to from another altar.

`useDisplayedAltar` returns the altar only once `activeAltarId` has caught up with `activeView.id`, `null` otherwise. `AltarView` renders an empty frame for that tick when the target altar exists but has not loaded yet (`isAltarLoading`), and falls through to the dashboard when `activeView.id` points at an altar that does not exist.

### Components

- **`src/components/altar/AltarItemVisual.tsx`** — shared visual renderer for an altar item (emoji or image, candle animation). Exported as `memo()`.
- **`src/components/altar/AltarCanvas.tsx`** — the live scene: placement transforms, drag and drop, lock handling, grid overlay. Also the off-screen renderer, see [Image capture and export](#image-capture-and-export).
- **`src/components/altar/AltarLibraryStrip.tsx`** — the library strip docked under the canvas in edit mode: category tabs, compact tiles, and the add/edit dialog (`AltarItemModal`). It holds only strip-level state (selected tab, height, scroll-fade state). Details under [Library strip](#library-strip).
- **`src/components/altar/AltarItemTile.tsx`** — the 70×85px library tile (image or emoji over the name), shared by the strip (`draggable`: sets `altarDragState` on `onPointerDown`, shows an `onEdit` pencil on hover) and `AltarLibrarySection` (`onClick` opens the edit dialog, no drag). Only the clickable variant gets `role="button"`, `tabIndex` and Enter/Space handling; `.altar-item-tile` is in the shared per-theme `:focus-visible` selector group in `index.css`.
- **`src/components/altar/AltarItemModal.tsx`** — the add/edit item dialog, opened from both the strip and the dashboard. Takes the full category list and a `defaultCategory` (the strip passes the selected tab; the dashboard the category whose "+" was clicked, or the fallback category for the header's "add item" button). Its category field is the shared `ui/CategorySelect` (`variant="field"`). Changing category resets the emoji only while it still equals the previous category's default (`changeCategory`), so a user-picked emoji survives. Deleting an item asks nothing and offers Undo (`undo.altarItemDeleted`).
- **`src/components/altar/AltarLibrarySection.tsx`** — the library under the altar list on the dashboard. Details under [Library on the dashboard](#library-on-the-dashboard).
- **`src/components/altar/AltarCard.tsx`** — `AltarCard`, `AltarListRow`, and `buildAltarContextMenuActions` (a plain function returning the context-menu actions). Cards and rows show the saved thumbnail (`thumbnail_data`) when `imageSrc()` resolves it, otherwise `AltarCardPreview`, capped at `PREVIEW_BASE` (176px, 380px in `cards_wide`). With `uiStore.altarShowPreview` off (a `FilterPanel.displayToggles` switch) they show the altar's icon (`FaviconGlyph`) or a `Flame` instead.
- **`src/components/altar/AltarCardPreview.tsx`** — live preview scene (background plus placed items, compact and full-size) for cards, list rows and the `altar` field of a block.
- **`src/components/ui/RenameField.tsx`** — the inline rename input of the dashboard cards and rows, shared with Journal, Wiki and Operations.
- **`src/components/sidebar/fields/PlacedElementRow.tsx`** — `PlacedElementRow` (a row of the placed-elements list, with its own `ContextMenu` and a delete button) and `PlacedElementInspector` (X, Y, Rot, Scale inputs and an opacity slider; jade marks only the selected row and the slider). Under a locked placement the inspector is a disabled `<fieldset>` with a tooltip (`altar.inspectorLocked`). A `focusedFieldRef` keeps the store-to-draft sync from overwriting the field being typed in while the canvas resizes the element.
- **`src/components/sidebar/fields/AltarReadingSummary.tsx`** — the read-mode sidebar, built on the same `SidebarSection`s as an entry's read sidebar: a `PropertiesSection` (format, background with swatch, overlay, grid) and a list of the visible placements, top-most first, whose click selects the element on the canvas. No Linked entries section — the Altar links to nothing — and no export control; image export lives in the Export menu ([Menu enablement gating](shell.md#menu-enablement-gating)). See [`components.md`](../components.md).

### Library strip

`AltarItemModal` is portalled to `document.body`, but React still bubbles its synthetic `mousedown` through the JSX tree into the strip's panel, which reads a `mousedown` near its top edge as a resize start and calls `preventDefault`. `handlePanelMouseDown` therefore bails when `event.currentTarget.contains(event.target)` is false; otherwise a click in the dialog (its name field, for one) could be swallowed as a resize gesture.

The tabs show only categories that hold at least one item (`categoriesUsedBy`), plus "Uncategorized" when an item's category no longer resolves, in the order of the Categories page — categories are created, edited and ordered only there (see [Categories](modules.md#categories)). A tab that disappears falls back to "All". The tab row hides its scrollbar (`scrollbar-none`) and shows left/right fade overlays (`.altar-cat-scroll-fade`) while content overflows in that direction; `checkCatScroll()` runs on scroll and when the categories change. The strip height is kept in `localStorage` (`altar-library-height`, 160–460px, default `LIBRARY_DEFAULT_HEIGHT`).

### Library on the dashboard

`AltarLibrarySection` renders through `Dashboard`'s `contentFooter` slot (see [`components.md`](../components.md)). It is sorted and grouped by `uiStore.altarLibraryPrefs` (`{ sort: AltarLibrarySort, grouping }`), separate from the altar list's `altarPrefs`; both are per-vault preferences (`store/vaultPrefs.ts`). `AltarLibrarySort` is `alpha_asc`/`alpha_desc`/`date_desc` — no `date_asc`, and no "category" sort since grouping covers that. The controls (a `SortSelect` and a grouping `SwitchRow`) are `AltarView`'s `libraryControls`, placed in the dashboard's `filters.panelProps.extraGroups` so they sit in the same header column as the altar list's own controls.

- **Grouped** uses `groupByCategory` and lists only categories that hold an item; **flat** renders every match in one grid.
- Every group — a real category and the "Uncategorized" bucket alike — uses `CollapsibleGroupHeader`; only real categories get its `onAdd` "+", since a trashed category has nothing to create an item in.
- The section's own collapse state is `usePersistedFlag('altar-library-collapsed')`; the category groups inside use `useCollapsedSet('altar-library')`. Both are kept per vault. The heading is `Dashboard`'s `GroupDivider`, the same divider the altar list uses for its "Altars" heading via `contentHeader` (`altar-list-collapsed`).
- `AltarView` passes the dashboard's search string down as a prop and filters item names with it; the search input lives in `Dashboard`'s toolbar.

### Sidebar editor

`AltarSidebarPanel` renders `AltarReadingSummary` in view mode and the edit controls behind `isEditing`.

- **Layer order** is set by dragging rows in the placed-elements list, through `usePointerReorder` (shared with the block manager). `visualItems` is the order during the gesture; on pointer-up, if the order changed, the panel calls `updatePlacement(id, { z_index })` for each moved element. There are no z-order buttons and no dedicated store action.
- **Section state.** The six collapsible sections (background, overlay, grid, favicon, canvas options, placements) are per-vault flags (`usePersistedFlag('altar-edit-…-open')`, default open), the same for every altar. The module removes leftover `altar-sidebar-sections-*` keys from `localStorage` once.
- **Gradient dialog** edits a draft colour (`gradientDraft`) and writes to the altar only on Save.
- **Removing** a custom image or a gradient falls back to the first image preset (`BACKGROUND_AFTER_REMOVE`).
- **Grid controls.** The grid-size slider shows as soon as the grid or a snap option is on; opacity and colour only while the grid is shown.

### Canvas interaction

A press on a placed element selects it. It becomes a drag only after `DRAG_THRESHOLD_PX` (3px) of movement, and the element keeps the spot where it was grabbed (`grabX`/`grabY`, percent relative to its centre) instead of jumping its centre to the pointer. A press without movement writes nothing. The mouse wheel does not scale elements (the corner handle and the inspector do). Snapping works whether or not the grid is shown (`showGrid` only draws it).

**Altar grid rendering.** The grid overlay is one SVG `<path>`, not a tiled CSS background. Line positions are exact fractions — `(i / gridNumCols) * nativeW` and `(i / gridNumRows) * nativeH` — built in a `useMemo`. This avoids the sub-pixel rounding that accumulates in tiled `background-size`, particularly on Retina displays.

The cell count (`gridNumCols`, `gridNumRows`) comes from a **stable reference resolution**, `resolveResolutionPixels(resolution)`, not from the container size. The number of lines therefore does not change when the window is resized; the grid scales with the canvas like the placed items. The same reference values drive snapping:

- **Position snap** steps are `100 / gridNumCols` and `100 / gridNumRows` percent, so snapped positions land exactly on a line.
- **Scale snap** derives N (cells to span) from the item's width in reference pixels (`gridCellW = refW / gridNumCols`), rounds it to the nearest even integer, and applies the same N to height via `gridCellH = refH / gridNumRows`. Items snap as boxes aligned on both axes.

`gridCellW`, `gridCellH` and `gridScaledBase` are computed per render from `refW`/`refH`, not per pointer event.

**Altar canvas scaling model.** The canvas container in `AltarView` is rendered at the altar's native resolution. A `ResizeObserver` on the viewport handles the two formats of the altar's `resolution` setting:

- **Ratio** (e.g. `"16:9"`): `nativeW`/`nativeH` are fitted to the viewport at that proportion; `scale` is `1`.
- **Pixel** (e.g. `"1920x1080"`): `nativeW`/`nativeH` are fixed and a uniform CSS `scale` (`Math.min(vw/nw, vh/nh)`) fits them.

Both center horizontally; vertically only in full-window mode. The result is `canvasTransform` (`{ scale, offsetX, offsetY, nativeW, nativeH }`, defaulting to 1920×1080 at scale 1 to avoid a first-render flash), applied as `translate(offsetX, offsetY) scale(scale)` from `0 0`. `AltarCanvas` derives `canvasScale` as `nativeW / BASE_RESOLUTION_WIDTH` and divides handle sizes by `cssScale` so they keep a constant screen size. Placement `x`/`y` stay in percent (0–100).

### Image capture and export

`_renderAltar(altar, backgroundSrc, placements, nativeW, nativeH, outW)` in `AltarCanvas.tsx` is the off-screen draw pipeline: background, overlay, then the grid, using the same `resolveResolutionPixels` + `grid_size` arithmetic as the live grid so captures match the screen. Two module-level exports use it; both read the altar from `useAltarStore.getState()` and are safe to call after unmount:

- `captureCurrentAltar()` — the dashboard thumbnail: `THUMBNAIL_W` (640px) wide, encoded by `canvasToCappedThumbnail` (`lib/thumbnail.ts`): a WebP quality ladder (0.85 → 0.65 → 0.45) under a 512 KB cap, falling back to JPEG. On macOS WKWebView `toBlob('image/webp')` may silently return PNG; the probe detects that and goes straight to JPEG.
- `exportCurrentAltarImage(format = 'jpeg')` — full native resolution, no size cap; JPEG at 0.97, WebP at 0.92, PNG lossless. Used by `saveAltarImage()` and `saveAltarPDF()` in `src/lib/altarExport.ts`, behind the Export menu.

Both draw the background through `canvasImageSrc()` rather than the `emerald-img` URL, so the canvas stays readable (see [Image Storage System](storage.md#image-storage-system)).

**Altar thumbnail capture.** A thumbnail is taken when an edit is confirmed with Done, and when the view is left mid-edit after something changed (a tab switch). Not on Cancel, which brings the previous thumbnail back with the rest of the snapshot ([The altar's snapshot](editing.md#the-altars-snapshot)), and not when nothing changed, since a new thumbnail would move the altar up in every date-sorted list.

The leave case is the cleanup of a `useEffect` on `isEditing` and `activeView.id` in `AltarView`, which also saves a typed title. It is declared before the effect that calls `clearActiveAltar()`, so `getState()` still holds the right altar and placements. Done and Cancel run inside `endingEdit`, which sets `endingEditRef` so the cleanup leaves the end of the edit to them. Both paths start the capture before any state changes and write title first, thumbnail second, so a full-row title write cannot overwrite a fresh thumbnail.

### Store

`altarStore` is the source of truth for altar records, library items and placements, including placement clamping and the per-altar grid and snap configuration. Categories live in `useCategoryStore` (see [Categories](modules.md#categories)).

- **Soft delete.** The store holds only live altars, live items, and placements of live items. `deleteAltar` keeps placements and incoming links, for the way back; `restoreAltar` reloads that one altar without touching the one being edited; `permanentlyDeleteAltar` removes row, placements and links (Trash, failed-import rollback). Items match: `deleteItem` keeps the placements, `restoreItem` (Undo or Trash, kind `altarItem`) brings the element back on every altar, `permanentlyDeleteItem` removes row and placements. `duplicateAltar` copies every placement, including those of trashed items.
- **Placements.** `removePlacement` returns what it removed (the sidebar's delete asks nothing); `restorePlacement` puts it back from the toast's Undo with `INSERT OR IGNORE` on the old id — a Cancel may already have brought it back — and only if altar and item still exist. `updatePlacement` writes and stamps nothing when the patch changes no field. `duplicatePlacement(id)` inserts a copy with a fresh id, offset +2% on both axes (capped at 100), `z_index = max + 1`, unlocked and visible, and selects it.
- **Settings JSON.** An altar's display settings (background preset, overlay, grid, snap, resolution) are one `settings` JSON column; every write goes through `altarSettingsJson`, and `fromRow.altar` unpacks it via `parseAltarSettings` (`src/lib/altarSettings.ts`), which fills defaults for missing or invalid keys. `AltarRecord` stays flat.
- **`updateAltarGrid(id, patch)`** is the only write path for the eight grid and snap settings; it clamps numbers and validates the hex colour. **`updateAltarResolution(id, resolution)`** keeps a valid `AltarRatio` as is and clamps a `WxH` string through `parseResolution`.
- **Thumbnails.** Changing the resolution keeps the stored thumbnail: Done and leaving recompute it anyway, and an import would otherwise lose the matching one it brought. Changing a library item's emoji or image, deleting or restoring one, drops the thumbnails of the altars that show it (`dropThumbnailsShowing`); the dashboard falls back to the live preview until the next capture.
- **`updateAltar(id, patch)`** merges the patch onto the current record inside the `set()` callback, not onto a snapshot taken before it, so two rapid calls (title, then thumbnail) each see the previous result. Altar writes are serialized per altar (`lib/serialize.ts`).
- **`bumpAltarUpdatedAt`** writes only `updated_at`, after placement edits. Every write re-sorts the in-memory list by `updated_at`.
- **Internals.** `insertAltarRow` owns the `INSERT INTO altars` SQL for `createAltar` and `duplicateAltar` (so a duplicate keeps thumbnail and icon). `mapEachPreview`/`filterEachPreview` are private helpers returning a new `previewPlacements` map.

**Altar drag performance.** `movePlacement` updates only `placements` (read by `AltarCanvas`) on every pointer move. It deliberately leaves `previewPlacements` (read by the cards) alone, because rebuilding that map at 60–120 Hz would re-render `AltarView` at pointer rate. `savePlacementPosition` on mouse-up syncs the final position into `previewPlacements`.

**Altar render memoisation.** `PlacedItem` (inside `AltarCanvas`) is `memo()`ed and receives stable `useCallback` handlers (`onStartDrag`, `onSelect`, `onResize`, `onRotate`) that take the placement `id` as a parameter instead of being recreated per item. During a drag only the dragged element re-renders. `handleMouseMove`, `handleMouseUp` and `coordsToPercent` are `useCallback`s too.

### Altar constants

`src/lib/altarConstants.ts` holds the altar's defaults and geometry:

- **Resolution.** `DEFAULT_ALTAR_RESOLUTION` (`'1920x1080'`), `BASE_RESOLUTION_WIDTH` (1920), the 7680×4320 maximum, `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `parseResolution` (validates `/^\d+x\d+$/` and clamps), `isRatioFormat`, `ratioFromResolution`, `sizeAndRatioFromResolution`. **`resolveResolutionPixels`** accepts either format — a ratio maps to its `ALTAR_RESOLUTION_MAP.lg` size first — and is what any code reading `altar.resolution` must use instead of `parseResolution`.
- **Background.** **`getAltarBackgroundStyle(altar, backgroundSrc)`** is the single source of the CSS background; nothing builds it inline. It prepends an overlay gradient (`background_overlay`, `background_overlay_color`) when the overlay is above 0, for every background type: a custom image (`backgroundSrc`, which must come from `imageSrc()` — that narrows it to a stored image or an inline source), an image preset (`/backgrounds/{name}.webp`, `ALTAR_IMAGE_PRESETS`), a `gradient:#rrggbb` preset (`isGradientPreset`, `getGradientColor`, `generateGradientStyle`), or one of the four named presets in `ALTAR_BACKGROUND_STYLES`. Unknown values fall back to `DEFAULT_ALTAR_BACKGROUND`. `GRADIENT_PRESET_COLORS` are the gradient picker's swatches; `LEGACY_GRADIENT_COLORS` maps the named presets to a colour for that picker.
- **Defaults** for grid (`DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`) and overlay (`DEFAULT_BACKGROUND_OVERLAY` 0.2, `DEFAULT_OVERLAY_COLOR` `'dark'`) — what `parseAltarSettings` fills in.
- **`isCandleEmoji(emoji)`** decides whether a placed item flickers like a candle: by its emoji (`🕯️`, with or without `U+FE0F`), since categories are ordinary, renameable rows.
