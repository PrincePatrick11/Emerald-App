# Altar

This document covers Altar-specific behavior and implementation details beyond the high-level feature summary.

## Interaction Model

- Edit flow uses modal-based **add / edit / delete** for library items.
- Item delete flow is two-step confirmation inside the modal.
- Inspector is rendered **inline under the selected placed-element row** in the sidebar list.
- Inspector fields: `x`, `y`, `scale`, `rotation`, `opacity`, `z-index`.
- Layer controls: to front, forward, backward, to back.

## Library and Canvas Layout

- Library strip is placed under the canvas in edit mode.
- Library tile spec: **70×85 px**.
- Library strip height is resizable and persisted with `localStorage` key `altar-library-height`.
- In full-window altar mode, the library strip is hidden.

## Placement Defaults and Limits

Placement fields are clamped in `altarStore`:

- `x`, `y`: `0..100`
- `z_index`: integer `>= 0`
- `width`, `height`: `2..500`
- `rotation`: `-360..360`
- `opacity`: `0.05..1`

Default placement size for newly created and duplicated records is `40`.

## Locking Behavior

- Locked items cannot be moved, resized, rotated, or selected for transform actions on canvas.
- Locked items are rendered with `pointer-events: none`, enabling click-through to items behind.

## Grid and Snap Controls

Grid controls are available only in edit mode:

- Grid overlay toggle
- Grid size (`8..128`)
- Grid opacity (`1..25%`, stored as `0.01..0.25`)
- Grid color (hex)
- Snap-to-grid toggle

Persistence keys:

- `altar-grid-size`
- `altar-grid-opacity`
- `altar-grid-color`

## View Mode / Read-Only and Full-Window Behavior

- Grid controls are hidden in view/read-only mode.
- Entering edit mode exits full-window mode automatically.
- Full-window mode is intended for viewing/composition focus and does not show edit-only controls.

## Data and Persistence Notes

- `altars.background_image_data` is a legacy column name that now stores a file path.
- Legacy `data:` background values are migrated to file-backed storage during `fetchAltars()`.
- Background preview loading is isolated in hooks (`useAltarBackgroundPreview`, `useAltarPreviewMap`).
- Custom background preview mapping and custom background chip rendering were hardened for consistency.

## Maintainability Refactors

The Altar UI was split into focused units:

- `AltarItemVisual` extracted for shared item rendering.
- `AltarCanvas` extracted for canvas rendering and drag/resize logic.
- `AltarLibraryStrip` extracted for library strip + modal workflows.
- `uiStore` consumption moved toward granular selectors to reduce unnecessary rerenders.
- Background preview concerns moved into dedicated hooks.

## Experiment Rollback

The fixed-scene rendering experiment was rolled back. Current behavior remains percentage-based responsive placement (`x/y` in percent) with dynamic canvas sizing.

## Internationalization

All altar labels run through `t('altar.*')`. This includes:

- Inspector labels
- Grid controls
- Background labels/chips
- Category labels, including `altar.categories.table`

## Known Issues / Next Work

- **Element drift on resize:** a remaining edge case exists where some placements can visually drift during container resize/responsive transitions. This is known and tracked as next work.
- **Build warning:** there is a known non-fatal build warning related to recent Altar refactoring; details are currently **unknown** in repository documentation.

## Source References

- `src/components/views/AltarView.tsx`
- `src/components/sidebar/AltarSidebarPanel.tsx`
- `src/components/altar/AltarCanvas.tsx`
- `src/components/altar/AltarLibraryStrip.tsx`
- `src/components/altar/AltarItemVisual.tsx`
- `src/components/altar/useAltarBackgroundPreview.ts`
- `src/store/altarStore.ts`
- `src/store/uiStore.ts`
- `src/lib/altarConstants.ts`
- `src/types/index.ts`
