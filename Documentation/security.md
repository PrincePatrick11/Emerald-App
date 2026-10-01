# Security

## Capability Model

Tauri 2 uses capability files to declare which permissions each window receives. Emerald has one, **`src-tauri/capabilities/default.json`**, applied to the `main` window:

```json
{
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-unminimize",
    "core:window:allow-set-focus",
    "core:webview:allow-set-webview-zoom",
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

- **`allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`** serve the custom title bar: on Windows and Linux the window is undecorated, the HTML window buttons (`WindowControls.tsx`) drive it over IPC, and the bar starts window dragging. They widen what a compromised frontend could do only marginally (annoyance-level window manipulation, no data access).
- **`allow-destroy`, `allow-unminimize`, `allow-set-focus`** serve the question about unsaved edits (see [Leaving an edit](architecture/editing.md#leaving-an-edit)). The last two make sure the question, asked while the window is minimised, is seen. `allow-destroy` is needed because with an `onCloseRequested` handler registered (`AppShell.tsx`), Tauri's JS API closes the window through `destroy()` once the handler returns without preventing it. `destroy` reaches the same windows `close` does and only skips the close-requested event — nothing a frontend that may already `close` could not do.
- **`core:webview:allow-set-webview-zoom`** backs the interface-size setting: `applyUIScale()` in `src/themes/theme.ts` calls `getCurrentWebview().setZoom(scale / 100)`. It only scales rendering — no data access.
- **`dialog:allow-message`** backs the native success/error popups (`message()` from `@tauri-apps/plugin-dialog`) that export/import report through (`src/lib/export.ts`, `src/lib/emeraldFormat.ts`, `src/lib/altarExport.ts`).
- **SQLite permissions must be declared explicitly.** `sql:default` alone grants read-only access; writing needs `sql:allow-execute` in addition to `sql:allow-select`. A missing permission fails silently at runtime.

PDF export renders in a hidden window that the per-platform `export_pdf` command builds and tears down in Rust; no extra capability entry is required.

## Command Surface

`src-tauri/src/lib.rs` registers **37 commands**. The security-relevant ones are discussed in their own sections below; this inventory exists so a new command cannot hide among undocumented ones.

| Command | Defined in | Notes |
|---|---|---|
| `write_file`, `read_file`, `export_image` | `lib.rs` | path-taking; confined by `guarded_write_target` / `guarded_read_path` (see [Path Confinement](#path-confinement)) |
| `export_pdf` | `lib.rs` → `pdf_export/` | hidden-window PDF render, per-platform |
| `ensure_app_storage_dirs` | `lib.rs` | creates the app's own data and config dirs; takes no path |
| `save_image` | `images.rs` | decodes a data-URL in Rust and writes it into the active vault's `images/`, named by the SHA-256 of its bytes; extension from the MIME type, `png` fallback. No backend size cap — the frontend's upload limits are the only bound |
| `copy_image_file`, `read_image_as_base64`, `read_image_file` | `images.rs` | see [Path Confinement](#path-confinement) |
| `list_image_files`, `adopt_legacy_images` | `images.rs` | enumerate the vault's `images/` / copy from the pre-per-vault shared pool into it |
| `delete_image_files` | `images.rs` | **a delete primitive** — takes filenames, skips any that fail `is_valid_image_name`, resolves them only against the vault's `images/`. Used by Settings → Storage cleanup |
| `register_vaults`, `ensure_vault_dirs`, `create_vault_dirs`, `ensure_backup_dir`, `probe_vault_dir`, `delete_vault_files`, `discard_import_staging`, `prune_migration_backups` | `vault.rs` | see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary) |
| `read_vault_drafts`, `write_vault_drafts` | `vault.rs` | the vault's `drafts.json`, see [Vault JSON files](#vault-json-files) |
| `read_vault_settings`, `write_vault_settings` | `vault.rs` | the vault's `settings.json`, see [Vault JSON files](#vault-json-files) |
| `default_vault_dir`, `new_vault_base_dir`, `legacy_default_db_exists` | `vault.rs` | path/existence oracles for the vault modal and the backup import's add-vault mode; take no path |
| `migrate_vault_layout` | `vault.rs` | moves a pre-0.2.1 flat `.db` into its own vault directory; the legacy name is validated with `is_valid_legacy_db_name` |
| `close_request_seen` | `lib.rs` | no arguments: tells Rust the frontend is handling a close request (see [Closing the window](architecture/shell.md#closing-the-window)). All it can do is *prevent* the fallback that closes an unresponsive window |
| `update_menu_labels`, `set_export_menu_enabled`, `set_altar_export_menu_enabled`, `set_view_menu_checked` | `lib.rs` | native-menu state sync; no-ops on Windows/Linux, where no native menu is installed |
| `update_settings`, `set_update_settings`, `check_for_update`, `install_update` | `updates.rs` | the only commands that reach the network — see [In-App Updates](#in-app-updates) |

## External Links

The capability includes `opener:default`. In read mode, clicking an external link in the editor calls `openUrl(href)` (`RichEditor.tsx`) with an `href` from stored content — content that can arrive via an imported backup. The click handler passes only `http://` and `https://` URLs; anything else is ignored. Beyond that, the `opener` plugin's default configuration is the only filter before the URL reaches the system browser.

The read-mode click opens the link directly; the link popup that shows the URL appears only while editing. Look-alike links are therefore not mitigated in read mode.

## In-App Updates

`src-tauri/src/updates.rs` is the only part of the app that talks to the network. The design rests on one split: **the update source is variable, the public key is not.**

The key lives in `plugins.updater.pubkey` in `tauri.conf.json` and is compiled into every build; its private half exists only as a GitHub secret (see [Signing](build.md#signing)). `tauri-plugin-updater` verifies every downloaded bundle against it before touching the installed app. If the key were editable alongside the URL, the variable source would become a way to install arbitrary code — which is why `update.json` has no field for it.

**A signature alone is not enough.** The manifest is not signed, only the artifact it points at. A hijacked manifest could pair a high version number with the URL *and genuine signature* of an older release — every check passes, and the user is downgraded onto a version with publicly known weaknesses. `requireSignedVersion: true` closes that: `@tauri-apps/cli` ≥ 2.11.5 records the app version in the signature's trusted comment, which minisign covers, and the plugin refuses any response whose announced version disagrees. The flag and the CLI floor belong together — the flag against older signatures rejects *every* update. With both in place, the worst a wrong, hijacked or mistyped source can do is deliver nothing, or deliver something that does not verify.

The source is `{appDataDir}/update.json`, next to `vaults.json`, and deliberately **not** in the per-vault settings: which server an installation asks belongs to the installation, not its content. Vault settings travel inside `.emeralddb` backups; an imported backup must not be able to point the updater anywhere.

`set_update_settings` rejects anything that is not a complete **`https`** URL. The signature check would catch a tampered manifest served over `http`, but not an attacker who keeps answering with an old manifest — enough to pin an installation to a known-vulnerable version indefinitely. Refusing at the command, rather than storing, means a bad URL cannot survive a restart and break every later check.

A user-set source precedes the compiled-in ones rather than replacing them: `check_for_update` builds the endpoint list as `[user, ...configured]`, reading the built-in list from `app.config()`. A source that 404s falls through to the next.

Everything runs in Rust, including the download, so the [Content Security Policy](#content-security-policy) stays at `connect-src 'self'` — an updater driven from the frontend would need the update host there, widening what any injected script could reach.

`install_update` installs only what the last `check_for_update` found and showed the user; the result is held in app state (`PendingUpdate`), not re-fetched.

It also refuses on an install method that cannot be replaced, and on Linux that test is deliberately strict. `APPIMAGE` is an ordinary environment variable **inherited by child processes**: a `.deb`-installed Emerald started from a terminal or editor that is itself an AppImage sees that foreign path, and the plugin would take it as the install target — overwriting an unrelated application. `install_supported()` therefore also requires the running executable to sit under `{temp}/.mount_…`, where an AppImage actually runs from (the same probe `tauri-utils` uses, though it only warns). A hand-extracted AppImage counts as "not replaceable", which is correct: there is no single file to swap.

## Vault Directories as a Trust Boundary

A vault is a directory the user picks, and it may sit outside every fixed user root — another drive, an external disk.

**`resolve_allowed_roots` deliberately does not include vault directories.** The registry behind them is filled by `register_vaults`, an ordinary frontend command; a frontend that could add its own roots would hand itself the very boundary that exists to contain it. "The user picked it in a folder dialog" is a guarantee in TypeScript that Rust cannot verify, so it is not treated as one.

**No storage command accepts a path.** They take a vault *id* and resolve it through `vault_dir()` against the registry; an unknown id is an error, and ids must match `[A-Za-z0-9-]{1,64}` before they can become a path segment. `register_vaults` itself accepts only absolute paths. A path arriving over IPC, or read out of stored HTML content, never becomes a destination.

The cost: `write_file` / `read_file` / `export_image` / `copy_image_file` stay confined to the fixed roots, so a backup file or Markdown export cannot be written into — or read out of — a vault folder outside them. Opening, using and deleting such a vault works in full.

The fixed roots include `document_dir()` and `app_data_dir()`, so a vault at its default location (`{documentDir}/Emerald Vaults/{name}`, see [Vault Layout](architecture/storage.md#vault-layout)) and its `backup/` folder sit *inside* them, as does the migration target `{appDataDir}/vaults/{id}`. For a vault *outside* the roots, `ensure_backup_dir` refuses up front — offering a default there would only have `write_file` refuse the write a moment later — and the export dialog falls back to a plain filename.

**`delete_vault_files`** removes only the vault's own artefacts **by name**, never with `remove_dir_all`: the app puts its database into whatever folder the user chose, so a vault created straight in Documents would otherwise take Documents with it. It refuses unless the folder contains an `emerald.db` (`not a vault directory: no database found`), then deletes:

1. `emerald.db` and its journal,
2. files in `images/` whose names pass `is_valid_image_name`,
3. `settings.json`, `drafts.json` and their `.tmp` write-companions.

The directories go last with plain `remove_dir`, which fails while anything else is inside — and that failure is the *answer*, not an error. A folder that also holds an exported backup in `backup/` or a stray `desktop.ini` stays standing (an *empty* `backup/` counts as the vault's own and goes too), and the command returns `false` so the UI can say so. A half-deleted vault cannot resurrect as an empty one: the caller drops it from `vaults.json` after every `Ok`, and an `Err` only occurs while the database itself could not be removed.

**`prune_migration_backups`** is the narrowest by-name delete. Every migration that rebuilds tables first writes a full copy of the database (`emerald.db.pre-vNN.bak`); once a vault is open, only the newest is kept. The command looks only into the vault's registered folder, considers only **regular files** whose whole name is `emerald.db.pre-v<number>.bak` — a symlink, a directory, `emerald.db.pre-vx.bak`, `emerald.db.pre-v50.bak.old` or another database's name is left alone — and deletes all but the highest version. A missing folder is not an error; the frontend logs a failure and opens the vault regardless. It runs on every vault open (`getDb()`), a Rust test pins the name pattern, and `scripts/schema-check.mjs` checks that the name `dbRebuild.ts` writes is the one `vault.rs` recognises.

**`discard_import_staging`** follows the same rule for one fixed target: `emerald.db.import` (plus `-journal`/`-wal`/`-shm`), the working copy a backup import fills and swaps in (see [DB Backup / Restore](database.md#db-backup--restore-emeralddb)). It can delete nothing else, and a missing file is not an error. It runs before every import, to clear what a crashed one left, and after every import, successful or not.

**`ensure_vault_dirs` does not create the vault directory.** The rule lives in `images_dir()`, so it holds for every command that touches vault storage: SQLite would put a fresh, empty database into a recreated folder, so a vault on an unplugged drive would silently come back empty. Creating is `create_vault_dirs`, called once when a vault enters the list.

**`probe_vault_dir` is a deliberate exception:** it takes a raw path and is not confined to any root, because it answers "what is in the folder the user just picked?" before that folder is registered. It returns four booleans — exists, access denied, holds a database, is empty — and reads no content: an existence oracle for arbitrary paths and nothing more.

**macOS: picking a file does not grant access to its folder.** "Open vault" and "Locate again" use a file dialog filtered to `.db` (a folder dialog lists no files, so nothing would show whether a folder holds a vault), and the vault directory is the file's parent. Under TCC, choosing a file inside `~/Documents`, `~/Desktop` or an iCloud-synced folder grants access to that file only, not to listing its parent. `probe_vault_dir` then reports `denied`, and the vault modal says "no access to the folder" rather than "no vault here"; `images_dir()` behaves the same afterwards. No Rust-side work gets around it — only the user can grant the permission.

### Vault JSON files

`settings.json` and `drafts.json` are read and written by vault id, through the same registry, never by path.

- **Writes** accept only a JSON object, at most 256 KB for settings (`SETTINGS_MAX_BYTES`, far above what the settings page produces — a guard against a runaway write) and 4 MiB for drafts (`DRAFTS_MAX_BYTES`). They write a `.tmp` file and `rename` it over the real one, so a crash mid-write leaves the previous file. A symlink is never followed under either name: the temp name is cleared and opened with `create_new`, and `rename` replaces a link at the target without following it. An empty drafts object removes `drafts.json` instead.
- **Reads** use `symlink_metadata` (matching `guarded_read_path`) and return a tagged `Missing`/`Found`/`Unreadable` result. Only "the vault directory itself is gone" is an error: a file that exists but isn't a plain, readable, size-capped file must not block opening the vault, so the frontend falls back to defaults and leaves it alone.
- **Drafts are untrusted on the way back in.** Every draft passes the parsers a database row passes (`draftStore.ts`), ids are checked, and a file of another version is ignored. A draft's content renders and saves through the same block path as a stored template's, so it gains nothing a stored one could not do.

### The registry can arrive pre-populated, from a directory this installation does not manage

A path becomes trusted only once it is in the registry, and only `register_vaults` writes into `VaultRegistry` — no exception. But on a first start, the `vaults.json` that `register_vaults`' entries come from can be a copy that `adopt_previous_identifier_dirs` (`vault.rs`, see [Adopting a previous identifier's data](architecture/storage.md#adopting-a-previous-identifiers-data)) placed from the previous identifier's directory — one this installation does not control.

That does not widen what a vault path can be: `vaults.json` always holds arbitrary absolute paths. What adoption adds is `retarget_registry`, a rewrite of a file this code did not produce: it moves stored paths from the old `appDataDir` root onto the new one, for vaults in the `{appDataDir}/vaults/{id}` layout. `strip_prefix`/`join` are purely lexical, so a `..` in a stored path could walk the result back out of the new data directory.

`retarget_registry` therefore rewrites an entry only when everything past the stripped prefix is an ordinary path component (no `..`, no root/prefix component); anything else stays exactly as it was. Such a vault keeps pointing at the previous installation's directory, which still exists because adoption copies rather than moves — it opens from there, while the adopted copy beside it grows stale. It becomes "Folder not found" only once the old directory is deleted. Not retargeting a path is recoverable; retargeting it somewhere unintended is not.

## The `emerald-img` URI Scheme

Images are served to the webview over a custom scheme instead of through IPC. The request path is `/{vaultId}/{filename}`, and both segments are attacker-reachable in principle: the filename comes from stored HTML content, which may have arrived in an imported backup.

- **The filename is validated before any path is built** (`is_valid_image_name`): exactly 64 lowercase hex digits, a dot, and one of `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg`. Rejecting everything outside that alphabet means percent-encoded traversal never has to be decoded — it simply fails the check.
- **The vault id is resolved through the registry**, so the directory is one the user authorised; an unknown id yields 404. The file is looked up in that vault's `images/`, then in the pre-per-vault shared pool.
- **Reads happen off the main thread** (`register_asynchronous_uri_scheme_protocol`), so a large file cannot stall the UI.
- **`Access-Control-Allow-Origin: *`** is belt and braces, not load-bearing: the altar export loads its images as data-URLs so it does not depend on the scheme being CORS-enabled (wry does not register it as such on every platform). The header stays because the images come from the app's own storage, so allowing the read grants the page nothing it could not already request.

## Path Confinement

**`read_image_as_base64`** takes a vault id and a filename, not a path. The filename passes the same check as the URI scheme, and the file is looked up in that vault's `images/`, then the pre-per-vault shared pool. There is no way to name a file outside those two directories.

**One guard per direction.** `guarded_write_target()` and `guarded_read_path()` in `lib.rs` hold the path rules; `write_file`, `export_image`, `read_file` and `copy_image_file`/`read_image_file` call them instead of repeating the sequence, so the two halves of the boundary cannot drift apart.

Both guards check against the fixed roots from `resolve_allowed_roots`: home, documents, downloads, desktop, app data and app config — deliberately *not* the registered vault directories (see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary)). Violations return `"access denied: path outside allowed directories"` or `"access denied: symlink targets are not allowed"`.

**`guarded_write_target`**:

1. Canonicalizes the deepest already-existing ancestor of the target and checks it against the roots **before** creating anything, so a denied write leaves no directories behind outside the boundary.
2. Creates the parent directories, canonicalizes the parent and checks it again.
3. Calls `symlink_metadata` on the target unconditionally and refuses any symlink — resolvable or dangling. (`target.exists()` would follow the link and report `false` for a broken one, letting `fs::write` create the file at the link's target outside the roots.) An existing target is also canonicalized and checked.

**`guarded_read_path`** refuses a symlink (`symlink_metadata`), canonicalizes the path and checks it against the roots.

On top of the guards, each command allowlists extensions and returns `"unsupported file type"` for anything else:

| Command | Extensions | Notes |
|---|---|---|
| `write_file`, `read_file` | `.md`, `.emerald`, `.emeralddb`, `.json`, `.txt` | keeps them from being a general filesystem read/write primitive |
| `export_image` | `.png`, `.jpg`, `.jpeg`, `.webp` | the base64 payload is decoded in Rust before writing, so no text encoding or newline handling can alter the bytes |
| `copy_image_file`, `read_image_file` | `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg` | shared helper `checked_image_source` |

**`read_image_file`** never writes into a vault: it reads a validated external file and returns it as a base64 data-URL, for the frontend to scale and check against the vault's image limits (Settings → Entries, `src/lib/imageLimits.ts`) *before* handing it to `save_image`. It adds a hard **64 MB cap** (`MAX_EXTERNAL_IMAGE_BYTES`) checked via `fs::metadata` before reading — the bytes cross IPC as base64 and are decoded onto a canvas, so an arbitrarily large file would stall the webview before any vault limit could reject it. The vault's own maximum (if smaller) is enforced afterwards in TypeScript, which is why the 64 MB number lives only in Rust.

For `copy_image_file` the *destination* is not a path at all — it is the vault's `images/` folder, resolved from the vault id.

## Frontend Input Validation

Validation rules against malformed, oversized, or untrusted data, mostly in the altar canvas:

- **Image sources.** Stored image references are turned into a `src` only through `imageSrc()` (`src/lib/images.ts`): a valid stored filename becomes an `emerald-img` URL for the active vault, `data:`, `blob:` and `http…` values pass through, and anything else yields an empty string, so the `<img>` is skipped and the emoji or live preview is shown instead. Altar item visuals, library tiles, dashboard thumbnails (`AltarCard`) and the altar field all go through it. Remote `http(s)` images are blocked by the CSP's `img-src` (see [Content Security Policy](#content-security-policy)).
- **Background CSS interpolation.** All altar background CSS is built by `getAltarBackgroundStyle` in `altarConstants.ts`, whose source argument must come from `imageSrc()` — so only those shapes reach the CSS `url(…)`.
- **Gradient presets.** `getGradientColor` (`altarConstants.ts`) validates the extracted colour against `/^#[0-9a-fA-F]{6}$/` and returns `null` otherwise; callers fall back to the default background. Malformed `gradient:` presets never reach canvas colour parsing or CSS.
- **Resolution strings.** `parseResolution` (`altarConstants.ts`) requires `/^\d+x\d+$/` and falls back to `1920x1080`; both dimensions are clamped to 7680 × 4320, preventing canvas sizes that could cause layout thrashing or memory pressure.
- **`hexToRgb`** (`src/lib/helpers.ts`) calls `isValidHexColor` first and returns `{r:0, g:0, b:0}` for invalid input instead of `NaN` values that would propagate into `rgba(...)`.
- **No SVG icons.** Every icon upload (entry, template, block, altar) goes through `readIconFile` (`src/lib/imageLimits.ts`), which refuses `image/svg+xml` on top of the general MIME allowlist (`isAcceptedImageFile`). Other upload paths accept SVG.
- **Upload size caps.** Altar item images are capped at 2 MB (`AltarItemModal`, stored as a data-URL in `altar_items.image_data`), altar backgrounds at 5 MB (`ALTAR_BACKGROUND_MAX_BYTES`, saved to the vault's `images/`). Both are scaled first and checked by `prepareImageDataUrl`.
- **Thumbnail size cap.** `THUMBNAIL_MAX_BYTES` (512 KB, `src/lib/thumbnail.ts`) is enforced inside `canvasToCappedThumbnail`, the WebP/JPEG/PNG quality ladder behind altar thumbnails. It bounds what is stored in `altars.thumbnail_data`.

## Backup Import Column Validation

`.emeralddb` backup files are untrusted input — they can be hand-edited or come from another machine. `insertRows()` in `src/lib/dbBackup.ts` (used by every import mode) builds each `INSERT`'s column list by intersecting the row's keys with `PRAGMA table_info(<table>)` of the real, hardcoded target table. A crafted backup can at worst contribute an extra key that is silently dropped (or, if no valid column remains, cause the row to be skipped) — it can never inject SQL through the column list. Row *values* go through parameterised placeholders (`$1, $2, …`).

An imported row's *id* is a value too, and stays untrusted after the import — it can resurface in an unrelated later export. `exportDatabase()` scopes related tables with `IN (...)` clauses (e.g. `altar_items` to the placements of the exported altars). sqlx splits a statement on `;` and executes each part, so an id like `'; DROP TABLE …; --` concatenated into the SQL would run as a second statement during a harmless-looking export. `selectWhereIn()` therefore binds every id as a parameter, chunked at 400 per query (`IN_CHUNK`) so the statement stays independent of vault size.

## HTML Escaping in Exports

User-provided text interpolated into the PDF export HTML goes through `htmlEscape()` (exported from `src/lib/export.ts`, also used by `src/lib/altarExport.ts` for the altar PDF's title), which replaces `&`, `<`, `>`, `"` and `'` with HTML entities. It is applied to:

- the entry title (in `<title>` and the `<h1>`),
- the top bar's emoji icon and its label (moon phase name or category name),
- tag names.

An image icon is passed through `sanitizeDataImageUrl` instead. The content HTML itself (TipTap output) is not re-escaped — it is sanitised (see below). Stored image references are resolved to base64 data-URLs by `embedImages()` before the HTML goes to the export backend.

## HTML Sanitisation

All HTML that enters the app from outside is sanitised with DOMPurify before being stored or displayed.

**PDF export (`src/lib/export.ts`).** Before the content HTML is handed to `export_pdf`, it passes through `DOMPurify.sanitize` with an allowlist for the internal-link attributes — `data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`, `data-entry-number`, `data-href` — so internal-link chips survive. This closes an injection path if an editor extension or import produces unexpected HTML.

**Emerald import (`src/lib/emeraldFormat.ts`).** After image paths are remapped, content passes through `sanitizeImportedHtml` — the last step of every import that writes HTML to the database. It keeps TipTap's own attributes (`data-type`, `data-id`, `data-entry-type`, `data-label`, `data-icon`, `data-entry-number`, `data-align`) and strips everything DOMPurify removes by default (script tags, event handlers, …). `data-align` is intentionally not in the PDF allowlist: that path never reads it, and alignment survives through the image's inline margins.

**Markdown import.** `marked` converts the body to HTML in `emeraldFormat.ts`, and `sanitizeImportedHtml` runs as the very last step — the legacy link chips of a Journal entry and the status block of an operation are appended before it, so nothing added along the way skips the filter. (In the `.emerald` path, the Journal's legacy links are added in the `beforeSanitize` hook for the same reason.)

**Content blocks (`src/lib/blocks/`, `src/components/blocks/`).** Entry content is a stack of `<section data-block>` wrappers, and imported content reaches the block parser before TipTap's schema sees it — so the block layer treats every wrapper as untrusted:

- **Parser.** `parseBlocks` keeps only a section's `data-*` attributes (no `onclick`, `class`, `style`), decodes entities, and `blockSectionHtml` writes every attribute back double-quoted through `escapeHtml`, so a value cannot break out of its quotes. Editor HTML passes through `neutralizeSectionTags` before storing, so a `<section` inside an attribute value (older WebKit leaves `<` unescaped there) cannot split an entry.
- **Unknown block types.** A block the app cannot render shows its inner HTML via `UnknownBlock`, the one `dangerouslySetInnerHTML` in the block layer. It runs DOMPurify with a **tight allowlist** — text structure only (`p`, headings, lists, `a`, `img`, `dl`, tables …) and only `href`/`src`/`alt`/`title` — because DOMPurify's default profile keeps `style`, `class`, `<style>` and forms: imported content could otherwise cover the window with a fake UI (`position: fixed`, the app's own Tailwind classes) or post a form to a remote server. `.block-unknown` also sets `contain: paint`, and link clicks inside it are intercepted and opened with `openUrl` for http(s) only, never navigating the app window.
- **Fields block.** Values render as React text; the readable fallback is written through `escapeHtml`. Element ids come from content: they must match `[A-Za-z0-9_-]{1,64}` and must not name an `Object.prototype` property, and the value/slot records have no prototype — so a crafted `constructor`/`__proto__` id cannot read a built-in as slot HTML. Image slots resolve through `imageSrc`, which confines stored names to the vault's image folder.
- **User-built blocks.** `block_definitions` rows arrive from `.emeralddb` backups (`INSERT OR IGNORE` through the column-whitelisting `insertRows`) and `.emerald` files (`meta.blockDefinitions`, ids restricted to `[\w-]{1,100}`). Either way their `elements`/`display` JSON is read through `parseDefinitionElements`/`parseDefinitionDisplay` — the same element validation as a copy in content (safe ids, known kinds, duplicates dropped) — and name and emoji render as React text. An import never overwrites an existing definition and never rewrites entries: copies render from their own content.
- **Failure isolation.** Every block renders inside `BlockErrorBoundary`: a block that throws falls back to `UnknownBlock` instead of blanking the app (which, with the open tab restored at startup, would repeat on every launch).

**Templates.** A template's `content` is a block stack in the same format as an entry's, so inserting one (`instantiateTemplateBlocks`) is a block-tree operation that goes through the block-layer defenses above, not a fresh HTML parse. The one place raw text becomes HTML is the routine→template conversion (migration v44 and the `.emeralddb` import path that runs it, `src/lib/migrateRoutinesToTemplates.ts`): a routine's plain-text/Markdown `content` is rendered with a dedicated `Marked` instance whose `html`/`link`/`image` renderers escape raw HTML outright and drop any link/image URL that isn't `http(s):`/`mailto:`, keeping only the visible text.

## Search Text Extraction

The title bar's global search needs plain text from stored entry HTML — content that can arrive through an import. `htmlToText()` (`src/lib/searchText.ts`) parses it with `DOMParser` rather than assigning it to `innerHTML` on a detached `<div>`: a `DOMParser` document is inert, so an `<img onerror>` payload in stored content never executes when search re-parses it. `script`, `style` and `noscript` elements are stripped before `textContent` is read — TipTap never emits them, but imported content can.

## Content Security Policy

The main window has an **explicit, hand-written CSP** in `tauri.conf.json` (`app.security.csp`), not Tauri's default. It allows **no remote origin at all**:

- `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `font-src 'self' data:`.
- `img-src 'self' data: blob: emerald-img: http://emerald-img.localhost` — the image scheme in both forms the platforms serve it as (WebView2 maps custom schemes onto `http`, the other engines do not).
- `connect-src 'self'` plus the Tauri IPC origins.
- `object-src 'none'`, `frame-src 'none'`, and `form-action 'none'`. The app has no HTML form that posts anywhere, and `default-src` does not cover form targets — without it, a form that slipped into rendered content could send what the user types to a remote server.

The eight typefaces ship with the app (`@fontsource` woff2 files bundled by Vite, `src/fonts.css`), so nothing is fetched for typography and the app looks the same offline. The only network code is the updater in Rust (see [In-App Updates](#in-app-updates)), which the page's CSP does not govern.

**Inline scripts.** `script-src 'self'` does not block *every* inline script: Tauri hashes each inline `<script>` in the built HTML at compile time and appends its sha256 to `script-src` (`tauri-codegen`'s `inject_script_hashes`, consumed by `set_csp`). So a specific, unmodified inline script — like the boot script in `index.html`'s `<head>` that sets the theme and arms the loading screen's fallback timer, see [Loading Screen and Boot Order](architecture/shell.md#loading-screen-and-boot-order) — runs; any other or modified inline script is blocked.

**Inline styles.** Tauri gives each `<style>` element a nonce, and a nonce in `style-src` makes CSP3 ignore `'unsafe-inline'` — which would silently block every `style={{…}}` attribute in the app (the sidebar widths in `AppShell`, among others) in a packaged build. That is why the loading screen's CSS lives in `public/splash.css`, loaded via `<link>`, rather than a `<style>` block in `index.html`.

**PDF export.** The export HTML is written to a unique file in the OS temp directory and loaded by a hidden webview over a `file://` URL. That document carries **no CSP at all** — a `file://` document has nothing to inherit it from. What controls that path is `htmlEscape` and `DOMPurify.sanitize` in `src/lib/export.ts` (see [HTML Escaping in Exports](#html-escaping-in-exports) and [HTML Sanitisation](#html-sanitisation)), and the export file is removed as soon as the export finishes. The internal-link chip transformation (`transformInternalLinks`) is pre-rendered in TypeScript as a convenience, not a CSP necessity.

## File Dialog Safety

File open and save operations use `@tauri-apps/plugin-dialog`, which presents a native OS file picker. The user explicitly selects or names the file; the application never constructs paths from user-provided text without going through this picker.

## No `window.confirm()`

Emerald does not use the browser's `window.confirm()` because WKWebView suppresses it. Destructive actions use an inline two-click confirmation (`InlineConfirm`, typically driven by a `confirmingId` state), which also gives control over styling and placement.
