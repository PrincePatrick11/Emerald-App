# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 0.1.3

### Added
- Altar inspector `z-index` input and expanded placement controls (`x/y`, scale, rotation, opacity, z-order)
- New Altar item category: `table` with i18n labels in all supported locales
- Altar grid controls (overlay toggle, size, opacity, color, snap-to-grid) stored per altar in the database (migration v18)
- Modal-based Altar item add/edit/delete workflow in the docked library strip
- Extracted Altar components and hooks for maintainability: `AltarItemVisual`, `AltarCanvas`, `AltarLibraryStrip`, and background preview hooks

### Changed
- Draggable tab reordering in the tab bar with animated movement
- Tab bar refined: the active tab now visually flows into the main content panel below (matching color, no separator line) while inactive tabs remain clearly separated by a 1px divider; the `backdrop-filter: blur` and active-tab drop shadow were removed as they contradicted the seamless effect
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
- Altar grid settings (enabled, size, opacity, color, snap-to-grid) migrated from `uiStore` / localStorage to per-altar database columns so each altar remembers its own grid configuration independently
- `updateAltarGrid(id, patch)` added to `altarStore` as the sole write path for altar grid fields; values are clamped and validated before persistence
- Custom background preview map and custom-background chip rendering hardened for consistent persistence previews
- Fixed-scene Altar rendering experiment rolled back; responsive percentage-based scene rendering retained
- Altar delete/edit flows consolidated around modal interactions and in-context confirmations
- Altar UI store consumption refactored toward granular selectors to reduce rerenders
- Altar placed-element rows and inline inspector extracted into `PlacedElementRow` and `PlacedElementInspector` so typing in inspector inputs no longer re-renders unrelated rows
- Altar dashboard cards and list rows extracted into `AltarCard`, `AltarListRow`, and `AltarCardPreview`; altar background previews resolved from a shared module-level cache so they survive view re-mounts and vault switches

### Fixed
- Altar dashboard was unreachable: opening the app, switching to the altar section, or clicking the back button always landed on a single altar. The dashboard (list of all altars) is now reachable from the back button and the altar entry in the left sidebar.

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
