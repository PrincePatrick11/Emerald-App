# Security

## Capability Model

Tauri 2 uses a capability file to declare which permissions each window receives. Emerald defines two capability files:

**`src-tauri/capabilities/default.json`** — applied to the `main` window:

```json
{
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-save",
    "dialog:allow-open",
    "opener:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "sql:allow-close"
  ]
}
```

SQLite permissions must be declared explicitly. `sql:default` alone grants read-only access; write access requires `sql:allow-execute` in addition to `sql:allow-select`. Omitting any of these permissions causes silent failures at runtime.

**`src-tauri/capabilities/pdf-export.json`** — applied to the `pdf-export` window:

```json
{
  "windows": ["pdf-export"],
  "permissions": [
    "core:default"
  ]
}
```

The PDF export window receives only `core:default`. It cannot access the filesystem, open dialogs, or query the database. Its sole IPC action is calling `trigger_print()`, which is invoked through `__TAURI_INTERNALS__.invoke` in the hardcoded HTML served to that window. This window is opened programmatically by `open_pdf_export` and its content is HTML generated in the main process — it never loads external URLs.

## Path Confinement

Two Rust commands enforce path restrictions:

**`read_image_as_base64`** resolves the requested path and the images directory to their canonical forms using `std::fs::canonicalize`, then checks that the canonical path starts with the canonical images directory. Any path that escapes the images directory (including symlink traversal) returns an `"access denied: path outside images directory"` error.

**`write_file` and `read_file`** check the file extension before performing any I/O. Only `.md`, `.emerald`, `.json`, and `.txt` are permitted. Any other extension returns an `"unsupported file type"` error. This prevents these commands from being used as a general filesystem read/write primitive.

**`copy_image_file`** similarly checks that the source file has an image extension (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`) before reading it.

## HTML Sanitisation

All HTML that enters the app from outside is sanitised with DOMPurify before being stored or displayed.

**Emerald import (`src/lib/emeraldFormat.ts`).** After image paths are remapped, the content string is passed through `DOMPurify.sanitize`. The sanitisation configuration preserves TipTap-specific attributes (`data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`) and strips everything else that DOMPurify would remove by default (script tags, event handler attributes, etc.).

**Markdown import.** The Markdown body is converted to HTML by `marked`, then the same DOMPurify call applies (via the import path in `emeraldFormat.ts`).

**Routine drops.** Routine content is passed through `marked.parse` before insertion into the editor. `marked` produces sanitised HTML by default, but any content from the editor is further controlled by TipTap's schema, which only allows known node types.

## Content Security Policy

The main window has CSP enabled through Tauri's default configuration. The PDF export window is served over a custom `export-html://` URI scheme with a `text/html` response constructed entirely in Rust — it never fetches external resources.

## File Dialog Safety

File open and save operations use `@tauri-apps/plugin-dialog`, which presents a native OS file picker. The user explicitly selects or names the file; the application never constructs paths from user-provided text without going through this picker.

## No `window.confirm()`

Emerald does not use the browser's `window.confirm()` dialog because WKWebView suppresses it. Destructive actions use inline two-click confirmation state (`confirmingId`) managed with React `useState`. This pattern also gives more control over styling and placement of the confirmation UI.
