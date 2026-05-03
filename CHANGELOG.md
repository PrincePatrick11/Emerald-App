# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
