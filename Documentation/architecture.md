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
│                     helpers.ts, altarConstants.ts, styleClasses.ts
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

### Internal Links

`createInternalLinkExtension(getItems, getIcon, getLabel)` creates a TipTap extension that renders linked entries as inline chips. Callbacks are ref-backed so they always see the current store state. Each chip stores `data-type="internalLink"`, `data-id`, `data-entry-type`, `data-label`, and `data-icon` attributes.

After every save, `syncLinks(sourceId, sourceType, htmlContent)` in `src/lib/links.ts` parses the saved HTML, deletes the old link rows for that source, and inserts fresh rows. This keeps the `links` table accurate without requiring a separate link-tracking mechanism.

Backlinks are fetched on demand by `fetchBacklinks(targetId)`, which joins the `links` table with each content table to return entry titles and types.

### Drag and Drop

Tauri's WKWebView does not pass HTML5 drag events to JavaScript. All drag-and-drop uses Pointer Events:

1. `onPointerDown` on the draggable element calls a setter in a module-level drag state module (e.g. `dragState.ts`, `altarDragState.ts`).
2. The drop target registers `pointermove` and `pointerup` listeners on `document` while a drag is in progress.
3. On `pointerup`, the target reads the drag state and applies the drop.

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

Emerald uses CSS custom properties scoped to `html[data-theme]` for all visual theming. Two named themes ship with the app: **Emerald Noctis** (dark) and **Emerald Parchment** (light).

### Architecture

```
src/themes/
├── emerald-noctis.css      # Dark theme — applied to :root and [data-theme='emerald-noctis']
├── emerald-parchment.css   # Light theme — applied to [data-theme='emerald-parchment']
└── theme.ts                # Theme helpers: DEFAULT_THEME_ID, THEME_OPTIONS, normalizeThemeId, applyTheme
```

Each theme file defines the same set of CSS custom properties (`--bg-app`, `--text-primary`, `--accent`, `--border-soft`, etc.). Components reference these variables rather than hardcoded colours. The Noctis theme is attached to both `:root` and its `data-theme` selector, making it the visual default when no theme attribute is present.

### Theme application

`App.tsx` subscribes to `uiStore.theme` and calls `applyTheme(themeId)` on every change:

```ts
// App.tsx
const theme = useUIStore((s) => s.theme);
useEffect(() => { applyTheme(theme); }, [theme]);
```

`applyTheme` sets `document.documentElement.dataset.theme = themeId`, which activates the matching `html[data-theme='…']` CSS rules.

### Theme selection and persistence

`uiStore` stores the current theme as `ThemeId` (`'emerald-noctis' | 'emerald-parchment'`). On startup, `loadSavedTheme()` reads `localStorage.getItem('theme-id')` and falls back to the legacy `'theme'` key (mapping `'light'` → `'emerald-parchment'`). The Settings modal renders the theme picker from `THEME_OPTIONS` exported by `theme.ts`.

### Tailwind bridge

Because the app uses many Tailwind utility classes with hardcoded stone/jade colours, `src/index.css` contains a large Tailwind bridge section that overrides those classes under `html[data-theme='emerald-parchment']`. This ensures that classes like `.bg-stone-900`, `.text-stone-100`, and `.border-stone-700` map to the correct theme variables in light mode. The Noctis theme does not need a bridge — its `:root` variables already match Tailwind's dark stone palette.

### Adding a new theme

1. Create `src/themes/emerald-<name>.css` with all required custom properties (copy an existing file as a template).
2. Add the theme ID to the `ThemeId` union in `src/store/uiStore.ts`.
3. Register it in `THEME_OPTIONS` and `normalizeThemeId` in `src/themes/theme.ts`.
4. Import the new CSS file from `src/main.tsx` (or add it to `index.html`).
5. Add Tailwind bridge overrides in `src/index.css` under `html[data-theme='emerald-<name>']` for any hardcoded utility classes the theme needs to override.

### Shared style constants

Two modules centralise reusable Tailwind class strings to avoid duplication across components:

- **`src/lib/styleClasses.ts`** — Input and select class strings for custom properties and operation properties (`CUSTOM_PROP_INPUT_CLASSES`, `CUSTOM_PROP_SMALL_INPUT_CLASSES`, `OP_PROP_SELECT_CLASSES`).
- **`src/lib/altarConstants.ts`** — Altar background presets (`ALTAR_BACKGROUND_PRESETS`, `ALTAR_BACKGROUND_STYLES`), category emoji mappings (`ALTAR_CATEGORY_EMOJI`, `CATEGORY_EMOJIS`), and the default background (`DEFAULT_ALTAR_BACKGROUND`).

## IPC Command Surface

All Rust commands are registered in `src-tauri/src/lib.rs` and invoked from TypeScript with `invoke()`.

| Command | Purpose |
|---|---|
| `save_image(data_url)` | Decode base64 data-URL, write `{sha256}.{ext}`, skip if exists. Returns absolute path. |
| `copy_image_file(source)` | Read a file from an arbitrary path, write to images dir with SHA-256 name. Accepts png/jpg/gif/webp/svg only. |
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
