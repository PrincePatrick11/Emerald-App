# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

### Changed
- `write_file` and `read_file` now enforce root-directory confinement (home, documents, downloads, desktop, app data, app config) in addition to the extension allowlist
- `write_file` rejects symlink targets and verifies canonical paths against allowed roots
- `.emeralddb` added to the permitted extension allowlist for `write_file` and `read_file`
- Theme preference stored under `theme-id` (legacy `theme` key is migrated automatically)
- PDF export metadata rendering hardened with stricter HTML escaping and image data-URL validation

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
