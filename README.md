# Emerald

A local-first desktop app for documenting magical practice — journal, wiki, operations, sigils, and altar tools, all in one place.

Built with Tauri 2 + React 19. Your data stays on your machine in a local SQLite database.

---

## Features

**Journal**
Rich-text entries with moon phase tracking, paradigm/banishment/meditation classification, linked operations and wiki articles, tags, and custom properties. Full backlink graph across all content types.

**Wiki**
Personal knowledge base with 12 built-in category types (elements, herbs, deities, symbols, …) plus custom categories. Icons, cover images, and internal links from anywhere in the app.

**Operations**
Track rituals, workings, and practices with active/inactive status, end dates, versioning, and linked content. Sigils get a specialized editor inside Operations.

**Sigil Workflow**
Dedicated sigil creation flow inside Operations: intention text → letter reduction → canvas drawing → visibility and charging state management. Sigils are stored as operations with `category_id = 'sigils'`.

**Altar**
Multi-altar dashboard with a drag-and-drop item placement system. Background presets (midnight, ember, forest, moon) or custom images.

**Routines**
Reusable templates draggable directly into journal entries. Merges tags, linked operations, and linked wiki articles automatically on drop.

**Trash & Undo**
All deletions are soft-deletes with a 5-second undo toast. Trash view with restore or permanent delete. 30-day auto-purge.

**Export / Import**
- **PDF** — print-ready layout with metadata, chips, and internal link rendering
- **Markdown** — frontmatter with all properties, `[[wiki-link]]` style internal references
- **Emerald format** — `.emerald` JSON with embedded images, full round-trip fidelity

**Localisation**
UI available in English, German, Spanish, and French (`en`, `de`, `es`, `fr`).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x |
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind CSS 3 |
| Editor | TipTap v2 (ProseMirror) |
| State | Zustand |
| Database | SQLite via `tauri-plugin-sql` |
| i18n | react-i18next |
| Backend | Rust (`src-tauri/`) |

---

## Getting Started

**Prerequisites:** Node.js, Rust toolchain, Tauri prerequisites for your OS ([tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/))

```bash
# Install dependencies
npm install --cache /tmp/npm-emerald-cache

# Run in development (separate dev DB, title "Emerald Dev")
npm run tauri:dev

# Production build
npm run tauri build
```

The dev configuration lives in `src-tauri/tauri.dev.conf.json` and keeps the dev app identity and database completely separate from any installed production build.

---

## Project Structure

```
src/
├── components/
│   ├── layout/       AppShell, sidebars, main area, settings
│   ├── editor/       TipTap extensions (internal links, images, drop)
│   ├── views/        Journal, Wiki, Operations, Altar, Sigil, Trash, Home
│   ├── sidebar/      Properties panels, backlinks, routines, wiki/ops panels
│   ├── wiki/         WikiList
│   └── ui/           ListToolbar, FilterPanel, ContextMenu, UndoToast
├── store/            Zustand stores (one per domain)
├── lib/              db.ts, links.ts, export.ts, emeraldFormat.ts, moonPhase.ts
├── i18n/             Locale files (en, de, es, fr)
└── types/            Shared TypeScript types

src-tauri/
├── src/lib.rs        Rust commands (image I/O, PDF export, mouse nav)
└── capabilities/     Tauri IPC permission sets
```

---

## Documentation

| Document | Description |
|---|---|
| [Documentation/architecture.md](Documentation/architecture.md) | Architecture, key patterns, data flow, IPC surface |
| [Documentation/database.md](Documentation/database.md) | Schema, migration model, conventions, sigil fields |
| [Documentation/features.md](Documentation/features.md) | Feature guide (user-facing) |
| [Documentation/internationalization.md](Documentation/internationalization.md) | Adding and managing i18n keys |
| [Documentation/security.md](Documentation/security.md) | Security model, capability permissions, sanitization |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Full SQLite schema reference |

---

## Key Conventions (for contributors)

- **Tags** are stored as names (strings), not IDs — `entry.tags = ["Moon", "Ritual"]`
- **Zustand selectors** — always `useStore((s) => s.field)`, never bare `useStore()`
- **Hooks before early returns** — all `useState`/`useEffect`/`useRef`/`useMemo` calls must come before any conditional `return`
- **Drag & drop** — Pointer Events only (HTML5 DnD is incompatible with Tauri/WKWebView)
- **SQLite booleans** — stored as `INTEGER 0/1`; cast with `!!value` after store reads
- **New i18n keys** — must be added to all four locale files simultaneously

---

## License

Copyright (C) 2024–2026 Lukas Reuter

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](LICENSE) for the full license text.
