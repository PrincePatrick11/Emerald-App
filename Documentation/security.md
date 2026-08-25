# Security

## Capability Model

Tauri 2 uses a capability file to declare which permissions each window receives. Emerald defines one capability file:

**`src-tauri/capabilities/default.json`** — applied to the `main` window:

```json
{
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "dialog:allow-save",
    "dialog:allow-open",
    "dialog:allow-message",
    "opener:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "sql:allow-close"
  ]
}
```

The four `core:window:allow-*` permissions exist for the custom title bar: on Windows and Linux the window runs undecorated and the HTML window buttons (`WindowControls.tsx`) drive minimize/maximize/close over IPC, and the bar itself starts window dragging. They widen what a compromised frontend could do only marginally (annoyance-level window manipulation, no data access).

SQLite permissions must be declared explicitly. `sql:default` alone grants read-only access; write access requires `sql:allow-execute` in addition to `sql:allow-select`. Omitting any of these permissions causes silent failures at runtime.

`dialog:allow-message` backs the native success/error confirmation popups shown by `@tauri-apps/plugin-dialog`'s `message()` — used throughout export/import (`src/lib/export.ts`, `src/lib/emeraldFormat.ts`, `src/lib/altarExport.ts`) to report a saved file path or a failure.

PDF export runs in a hidden window built and torn down by the per-platform `export_pdf` command, so it operates entirely under the main process's existing capability set — no extra capability entry is required.

## Command Surface

`src-tauri/src/lib.rs` registers **24 commands**. The security-relevant ones are discussed in their own sections below; this inventory exists so a new command cannot hide among undocumented ones.

| Command | Defined in | Notes |
|---|---|---|
| `write_file`, `read_file`, `export_image` | `lib.rs` | path-taking; confined by `guarded_write_target` / `guarded_read_path` (see [Path Confinement](#path-confinement)) |
| `export_pdf` | `pdf_export/` | hidden-window PDF render, per-platform |
| `ensure_app_storage_dirs` | `lib.rs` | creates the app's own fixed storage dirs; takes no path |
| `save_image` | `images.rs` | accepts a data-URL, decodes it in Rust, writes into the active vault's `images/` under a generated hex name; extension derived from the MIME type with `png` fallback. No backend size cap — the frontend's upload limits are the only bound |
| `copy_image_file`, `read_image_as_base64` | `images.rs` | see [Path Confinement](#path-confinement) |
| `list_image_files`, `adopt_legacy_images` | `images.rs` | enumerate / migrate files inside the vault's `images/` only |
| `delete_image_files` | `images.rs` | **a delete primitive** — takes a list of filenames, each validated with `is_valid_image_name`, resolved only against the vault's `images/` dir. Used by Settings → Storage cleanup and bounded by that validation |
| `register_vaults`, `ensure_vault_dirs`, `create_vault_dirs`, `probe_vault_dir`, `delete_vault_files` | `vault.rs` | see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary) |
| `default_vault_dir`, `new_vault_base_dir`, `legacy_default_db_exists` | `vault.rs` | pure path/existence oracles for the vault modal; return strings, take no path |
| `migrate_vault_layout` | `vault.rs` | one-time move of a pre-multi-vault `.db` into the vault layout; the legacy name is validated with `is_valid_legacy_db_name` |
| `update_menu_labels`, `set_export_menu_enabled`, `set_altar_export_menu_enabled`, `set_view_menu_checked` | `lib.rs` | native-menu state sync; no-ops on Windows/Linux where no native menu is installed |

## External Links

The capability includes `opener:default`, and the editor opens external links through it: clicking a link in read mode calls `openUrl(href)` (`RichEditor.tsx`) with an `href` taken from stored content — content that can arrive via an imported backup. There is no scheme allowlist at the call site; the `opener` plugin's default configuration is the only filter before the URL reaches the system browser. The link's full URL is shown in the link popup before it can be clicked, which is the practical mitigation for look-alike links.

## Vault Directories as a Trust Boundary

A vault is a directory the user picks, and it may sit outside every fixed user root — another drive, an external disk.

**`resolve_allowed_roots` deliberately does not include those directories.** The registry behind them is filled by `register_vaults`, an ordinary command the frontend calls; a frontend that could add its own roots would be handing itself the very boundary that exists to contain it. The "the user picked it in a folder dialog" guarantee lives in TypeScript and cannot be verified from Rust, so it is not treated as one.

Vault storage does not need those roots. **No storage command accepts a path.** They take a vault *id* and resolve it through `vault_dir()` against the registry; an unknown or malformed id is an error, and ids are validated against `[A-Za-z0-9-]{1,64}` before they can become a path segment. A path arriving over IPC, or read out of stored HTML content, never becomes a destination.

What that costs is one thing: `write_file` / `read_file` / `export_image` / `copy_image_file` stay confined to the fixed user directories, so a backup file or a Markdown export cannot be written into — or read out of — a vault folder that lives outside them. Opening, using and deleting such a vault works in full.

`delete_vault_files` validates before it deletes anything: it walks the folder's top level and `images/` first and aborts with `VAULT_DIR_NOT_EMPTY` the moment it meets a name it doesn't own — anything other than `emerald.db`, its journal, and files in `images/` whose names pass `is_valid_image_name`. Only once the whole tree checks out does it remove the vault's own artefacts **by name**, database first, then the images, then the two now-empty directories with plain `remove_dir`. It is not `remove_dir_all` anywhere in that path. Checking first rather than relying on `remove_dir` failing at the end matters: the database and images are gone by the time a trailing `remove_dir` fails, so a single unrecognised file used to mean losing both before the check ever caught it. The "the folder contains an `emerald.db`" check still runs first (`vault.rs` refuses with `not a vault directory: no database found`), but as a fast pre-check, not as the guard: the app puts that database into whatever folder the user chose, so a vault created straight in Documents would have taken Documents with it if the walk did not also verify every name it is about to delete. The other half of that fix is in the UI, which refuses to create a new vault in a folder that is not empty.

`ensure_vault_dirs` deliberately does **not** create the vault directory — the rule lives in `images_dir()`, so it holds for every command that touches vault storage. SQLite would put a fresh, empty database into a recreated folder, so a vault on an unplugged drive would silently come back as an empty vault. Creating is `create_vault_dirs`, called once when a vault enters the list.

`probe_vault_dir` is a deliberate exception: it takes a raw path and is not confined to any root. It has to be, because it answers "what is in the folder the user just picked?" before that folder is registered anywhere. It returns four booleans — exists, access denied, holds a database, is empty — and reads no content, so it is an existence oracle for arbitrary paths and nothing more.

**macOS: picking a file does not grant access to its folder.** "Open vault" and "Locate again" use a file dialog filtered to `.db`, and the vault's directory is that file's parent — a plain folder dialog lists no files, so nothing would show whether a chosen folder even held a vault before confirming. But under TCC, choosing a file inside `~/Documents`, `~/Desktop`, or an iCloud-synced folder grants the app permission to read that one file, not to list its parent directory. `probe_vault_dir` on the parent then reports `denied`, and the vault modal correctly says "no access to the folder" rather than the misleading "no vault here" — the same distinction applies afterwards to `images_dir()` for that vault. No amount of Rust-side work gets around it: the permission genuinely was not granted, and only the user can grant it.

Note on [Vault Layout → Vault Directories as a Trust Boundary](architecture.md#vault-layout) above: `resolve_allowed_roots` already includes `document_dir()`, so a vault at its default location — `{documentDir}/Emerald/{name}` — sits *inside* the allowed roots, and reading or writing a document into it (a backup file, a Markdown export) works normally. The "out of reach" case is a vault deliberately relocated to a folder the fixed roots don't cover — another drive, a folder outside `~` entirely — not the default location, and not the old `{appDataDir}/vaults/{id}` location either, since `app_data_dir()` is also one of the roots.

## The `emerald-img` URI Scheme

Images are served to the webview over a custom scheme instead of through IPC. The request path is `/{vaultId}/{filename}`, and both segments are attacker-reachable in principle: the filename comes out of stored HTML content, which may have arrived in an imported backup.

- **The filename is validated before any path is built**: exactly 64 lowercase hex digits, a dot, and one of `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg`. Nothing else is even resolved. Rejecting everything outside that alphabet also means percent-encoded traversal never has to be decoded and handled — it simply fails the check.
- **The vault id is resolved through the registry**, so the directory is one the user authorised. An unknown id yields 404.
- **Reads happen off the main thread** (`register_asynchronous_uri_scheme_protocol`), so a large file cannot stall the UI.
- **`Access-Control-Allow-Origin: *`** is belt and braces, not a load-bearing requirement any more. The altar export used to depend on it (canvas `toBlob()` on a tainted canvas silently produces nothing), but it now loads its images as data-URLs precisely so it does not have to rely on a custom scheme being CORS-enabled — wry never registers the scheme as such on every platform. The header stays because the images come from the app's own storage, so allowing the read grants the page nothing it could not already request.

## Path Confinement

**`read_image_as_base64`** takes a vault id and a filename, not a path. The filename passes the same strict check as the URI scheme, and the file is looked up in that vault's `images/` folder, falling back to the pre-per-vault shared pool. There is no way to name a file outside those two directories.

**One guard per direction.** `guarded_write_target()` and `guarded_read_path()` in `lib.rs` hold the path rules; `write_file`, `export_image`, `read_file` and `copy_image_file` call them rather than repeating the sequence. That is not only deduplication — the two halves of this boundary had already drifted, with `read_file` accepting a symlink that the image reader rejected. It no longer does.

Two things the write guard gets right that the four hand-written copies did not:

- **Dangling symlinks.** The old check hung off `target.exists()`, which follows the link and returns `false` for a broken one — so the symlink rejection was skipped entirely and `fs::write` created the file at the link's target, outside the allowed roots. The guard now calls `symlink_metadata` unconditionally and refuses any symlink, resolvable or not.
- **Directories created before the check.** `create_dir_all(parent)` used to run first, so a denied write still left directories behind outside the boundary. The deepest already-existing ancestor is now canonicalized and checked before anything is created.

**`write_file` and `read_file`** enforce two layers of confinement:

1. **Extension allowlist.** Only `.md`, `.emerald`, `.emeralddb`, `.json`, and `.txt` are permitted. Any other extension returns an `"unsupported file type"` error. This prevents these commands from being used as a general filesystem read/write primitive.
2. **Root directory confinement.** The target path's parent (resolved to an absolute, canonical form) must fall within one of the allowed storage roots: home, documents, downloads, desktop, app data, or app config directories. If the resolved path escapes these roots, the command returns `"access denied: path outside allowed directories"`. For existing files, `write_file` additionally rejects symlinks and verifies the canonical target is within allowed roots.

**`export_image`** enforces three layers of validation before writing:

1. **Extension allowlist.** Only `.png`, `.jpg`, `.jpeg`, and `.webp` are permitted. Any other extension returns an `"unsupported file type"` error.
2. **Root directory confinement.** The target path's parent is resolved using `is_within_allowed_roots` before `create_dir_all`, and then re-verified against the canonical path after `create_dir_all`. Only the post-canonicalize check is the authoritative gate; the pre-check guards against obviously-wrong paths being materialized on disk. Symlink targets are rejected. If the resolved path escapes these roots, the command returns `"access denied: path outside allowed directories"`.
3. **Binary write.** The base64 payload is decoded from the data-URL by Rust before writing, so no text encoding or newline injection can alter the file content.

**`copy_image_file`** enforces three layers of validation before reading the source file:

1. **Extension allowlist.** Only `png`, `jpg`, `jpeg`, `gif`, `webp`, and `svg` are permitted. Any other extension returns an `"unsupported file type"` error.
2. **Symlink rejection.** The source path is checked with `symlink_metadata`; if it resolves to a symlink, the command returns `"access denied: symlink targets are not allowed"`.
3. **Root directory confinement.** The source path is canonicalized and verified through the same shared `guarded_read_path` that `read_file` uses — the fixed roots only (home, documents, downloads, desktop, app data, app config), deliberately *not* the registered vault directories, for the same reason `resolve_allowed_roots` leaves them out (see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary) above). If the resolved path escapes these roots, the command returns `"access denied: path outside allowed directories"`.

The *destination* is not a path at all — it is the active vault's `images/` folder, resolved from the vault id.

## Frontend Input Validation

Several validation rules protect against malformed, oversized, or untrusted data in the altar canvas subsystem:

**Resolution strings.** `parseResolution` in `altarConstants.ts` validates the input against `/^\d+x\d+$/` before splitting on `x`. Inputs that contain additional separators (e.g. `1920x10x80`) or non-numeric characters are rejected and fall back to `1920x1080`. Both dimensions are then clamped to the allowed maximum (7680 wide, 4320 tall), preventing extremely large canvas sizes that could cause layout thrashing or DoS-like memory pressure in the ResizeObserver loop.

**Background CSS interpolation.** All background CSS construction goes through `getAltarBackgroundStyle` in `altarConstants.ts`. For image-backed backgrounds, the function enforces that the source value starts with `data:image/` before interpolating it into a CSS `backgroundImage: url(...)` rule. Values that fail this check are treated as "no background" rather than interpolated, preventing unexpected URL scheme injection. This single utility replaces the per-call-site guard that previously existed only in `AltarSidebarPanel`.

**Item image rendering.** `AltarItemVisual` and `AltarLibraryStrip` only render an `<img>` element when `item.image_data` starts with `data:image/`. Any other value (empty string, legacy path, unexpected scheme) is skipped and falls back to the emoji display.

**SVG upload blocking for altar icons.** In `AltarSidebarPanel`, icon uploads check `file.type === 'image/svg+xml'` after the general MIME allowlist check and reject SVG files before reading the data. SVG data-URLs are also skipped when rendering the icon preview `<img>` — the element is shown only when `icon_data` starts with `data:image/` and does not start with `data:image/svg+xml`. This prevents SVG-based script execution via favicon uploads while still allowing SVG through other upload paths that use the shared `isAcceptedImageFile` helper.

**Upload size limits.** File uploads in the altar module are rejected before processing if they exceed the size cap: 2 MB for item images (`AltarLibraryStrip`) and 5 MB for background images (`AltarSidebarPanel`). This prevents large files from being stored as base64 data-URLs in the database.

**`hexToRgb` validation.** `hexToRgb` in `src/lib/helpers.ts` calls `isValidHexColor` before parsing. Strings that are not a valid 6-digit hex colour return `{r:0, g:0, b:0}` rather than producing `NaN` values that could propagate into CSS `rgba(...)` rules.

**Thumbnail `src` binding.** Dashboard altar cards (`AltarCard`, `AltarListRow`) only bind `thumbnail_data` to an `<img src>` attribute when the value starts with `data:image/`. Any other stored value (file path, `tauri://` URI, empty string) skips the `<img>` element entirely and falls back to the live `AltarCardPreview`. This prevents unexpected scheme injection through the `src` attribute.

**`getGradientColor` validation.** `getGradientColor` in `altarConstants.ts` now validates the extracted hex colour against `/^#[0-9a-fA-F]{6}$/` and returns `null` for values that do not match. Call sites (`getAltarBackgroundStyle`, `renderAltarThumbnail`) treat a `null` return as an invalid preset and fall back to the default background. This prevents malformed `gradient:` preset strings from reaching canvas colour parsing or CSS interpolation.

**Thumbnail size cap.** The 512 KB limit (`524288`) is enforced at every capture site in `AltarView` (three of them) and in `AltarCanvas`, where `renderAltarThumbnail` downscales in a loop until the data-URL fits under the cap. Changing the limit means changing it everywhere — it is a repeated literal, not a shared constant. This bounds the size of data stored in `altars.thumbnail_data` and prevents oversized blobs from accumulating in the SQLite file.

## Backup Import Column Validation

`.emeralddb` backup files are untrusted input — they can be hand-edited or come from another machine. `insertRows()` in `src/lib/dbBackup.ts` (used by both `replace` and `merge` import modes) builds each `INSERT` statement's column list by intersecting the keys found on a row with `PRAGMA table_info(<table>)` for the real, hardcoded target table, rather than using the row's JSON keys directly. A crafted backup file can therefore at worst contribute an extra key that gets silently dropped (or, if it strips all valid columns, cause that row to be skipped) — it can never inject arbitrary SQL through the column list. Row *values* still go through parameterised placeholders (`$1, $2, …`), as before.

An imported row's *id* is a value too, and it does not stop being untrusted once the import finishes — it stays in the database and can resurface in an unrelated later export. `exportDatabase()` in `dbBackup.ts` needs `IN (...)` clauses to scope related tables (e.g. `links` to the exported entries, `altar_items` to the placements of the exported altars). These used to be built by concatenating ids directly into the SQL string. Because sqlx splits a statement on `;` and executes each part, an id crafted to contain `'; DROP TABLE …; --` in an imported backup would sit dormant until the next export touched that table, then run as a second statement — an injection triggered by an unrelated, harmless-looking action rather than by the import itself. `selectWhereIn()` now binds every id as a parameter, chunked at 400 per query so the statement stays independent of vault size.

## HTML Escaping in Exports

All user-provided text that is interpolated into the PDF export HTML template is passed through `htmlEscape()`, exported from `src/lib/export.ts` and reused by `src/lib/altarExport.ts` for the altar PDF export's title. This function replaces `&`, `<`, `>`, `"`, and `'` with their corresponding HTML entities. It is applied to:

- Entry titles (in the `<title>` element, toolbar display, and `<h1>` heading)
- Chip labels (paradigma, bannung, meditation, linked ops/wiki, category names)
- Tag names
- Version strings
- Icon emoji characters (when not a data-URL image)

The content HTML itself (the TipTap editor output) is not re-escaped — it is trusted HTML already produced by the editor and sanitised on import. Image `src` attributes that are file paths are resolved to base64 data-URLs via `embedImages()` before the HTML is handed to the export backend.

## HTML Sanitisation

All HTML that enters the app from outside is sanitised with DOMPurify before being stored or displayed.

**PDF export (`src/lib/export.ts`).** Before the entry content HTML is handed to the `export_pdf` IPC command, it is passed through `DOMPurify.sanitize`. The configuration allowlists TipTap internal-link attributes — `data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`, `data-entry-number`, and `data-href` — so internal-link chips survive sanitisation intact. This closes a potential injection path if an editor extension or import produces unexpected HTML before it reaches the export backend.

**Emerald import (`src/lib/emeraldFormat.ts`).** After image paths are remapped, the content string is passed through `DOMPurify.sanitize`. The sanitisation configuration preserves TipTap-specific attributes (`data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`) and strips everything else that DOMPurify would remove by default (script tags, event handler attributes, etc.).

**Markdown import.** The Markdown body is converted to HTML by `marked` in `emeraldFormat.ts`. Unlike Emerald JSON import, this path does not currently run a dedicated DOMPurify pass in the same function; PDF export therefore applies strict HTML escaping for metadata fields, and imported content should be treated as untrusted until full parity sanitisation is in place.

**Routine drops.** Routine content is passed through `marked.parse` before insertion into the editor. `marked` produces sanitised HTML by default, but any content from the editor is further controlled by TipTap's schema, which only allows known node types.

## Search Text Extraction

The title bar's global search needs plain text to match against, not the HTML stored for Journal, Wiki, and Operations content — content that can arrive through an import. `htmlToText()` (`src/lib/searchText.ts`) parses it with `DOMParser` rather than assigning it to `innerHTML` on a detached `<div>`: the document `DOMParser` produces is inert, so an `<img onerror>` or similar payload that made it into stored content through an import never executes when the search re-parses it. `script`, `style`, and `noscript` elements are stripped before `textContent` is read — TipTap itself never emits them, but imported content can carry both.

## Content Security Policy

The main window has an **explicit, hand-written CSP** in `tauri.conf.json` (`app.security.csp`), not Tauri's default. `script-src` is `'self'`. `img-src` additionally allows `emerald-img:` and `http://emerald-img.localhost` — the same scheme in the two forms the platforms serve it as (WebView2 maps custom schemes onto `http`, the other engines do not). Three remote origins are allowed for typography: `style-src`/`connect-src` include `https://fonts.googleapis.com` and `connect-src`/`font-src` include `https://fonts.gstatic.com`. That is the app's one network dependency: `src/main.tsx` injects the Google Fonts stylesheet link at runtime (with `preconnect` hints in `index.html`), and the app falls back to system font stacks when offline — nothing else may leave the machine. The export HTML for PDF export is written to a unique file in the OS temp directory and loaded by a hidden webview over a `file://` URL — it never fetches external resources and is removed from disk as soon as the export finishes. Because the hidden webview inherits the same CSP as the main window (`script-src 'self'` — see `tauri.conf.json`), inline scripts in the export HTML are blocked; the frontend therefore pre-renders the internal-link chip transformation in TypeScript (`transformInternalLinks` in `src/lib/export.ts`) before handing the HTML to the backend.

## File Dialog Safety

File open and save operations use `@tauri-apps/plugin-dialog`, which presents a native OS file picker. The user explicitly selects or names the file; the application never constructs paths from user-provided text without going through this picker.

## No `window.confirm()`

Emerald does not use the browser's `window.confirm()` dialog because WKWebView suppresses it. Destructive actions use inline two-click confirmation state (`confirmingId`) managed with React `useState`. This pattern also gives more control over styling and placement of the confirmation UI.
