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
    "opener:default"
  ]
}
```

- **`allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`** serve the custom title bar: on Windows and Linux the window is undecorated, the HTML window buttons (`WindowControls.tsx`) drive it over IPC, and the bar starts window dragging. They widen what a compromised frontend could do only marginally (annoyance-level window manipulation, no data access).
- **`allow-destroy`, `allow-unminimize`, `allow-set-focus`** serve the question about unsaved edits (see [Leaving an edit](architecture/editing.md#leaving-an-edit)). The last two make sure the question, asked while the window is minimised, is seen. `allow-destroy` is needed because with an `onCloseRequested` handler registered (`AppShell.tsx`), Tauri's JS API closes the window through `destroy()` once the handler returns without preventing it. `destroy` reaches the same windows `close` does and only skips the close-requested event — nothing a frontend that may already `close` could not do.
- **`core:webview:allow-set-webview-zoom`** backs the interface-size setting: `applyUIScale()` in `src/themes/theme.ts` calls `getCurrentWebview().setZoom(scale / 100)`. It only scales rendering — no data access.
- **`dialog:allow-message`** backs the native success/error popups (`message()` from `@tauri-apps/plugin-dialog`) that export/import report through (`src/lib/export.ts`, `src/lib/emeraldFormat.ts`).
- **No SQL permissions.** The database is reached through the app's own commands (`db_*`), which need no capability entry, not through a plugin. What the webview can do with SQL is bounded in Rust instead: by vault id instead of path, and by an authorizer on every connection (see [Vault Encryption](#vault-encryption)).

PDF export renders in a hidden window that the per-platform `export_pdf` command builds and tears down in Rust; no extra capability entry is required.

## Command Surface

`src-tauri/src/lib.rs` registers **88 commands**. The security-relevant ones are discussed in their own sections below; this inventory exists so a new command cannot hide among undocumented ones.

| Command | Defined in | Notes |
|---|---|---|
| `db_load`, `db_close`, `db_execute`, `db_select`, `db_batch` | `db.rs` | SQL by vault id and a fixed `DbFile`, never by path; every connection carries the authorizer — see [Vault Encryption](#vault-encryption) |
| `vault_key_status`, `keychain_available`, `vault_create_key`, `vault_create_plain`, `vault_unlock`, `vault_unlock_remembered`, `vault_set_remembered`, `vault_is_remembered`, `vault_lock` | `keys.rs` | the key lifecycle. Take a vault id and, for unlocking, a password; none returns a key. `vault_create_key` and `vault_create_plain` only work on a vault with no `vault.key` and no database |
| `vault_encrypt`, `vault_change_password`, `vault_recover` | `reencrypt.rs` | put a vault under a new key; each returns the new recovery key. `vault_encrypt` only takes a vault without `vault.key`; the other two need the current password or recovery key — an unlocked session alone is not enough to change the password. No command decrypts a vault |
| `auto_backup_settings`, `set_auto_backup_settings`, `auto_backup_status`, `pick_auto_backup_dir`, `reset_auto_backup_dir`, `back_up_vault_now` | `auto_backup.rs` | take vault ids and never a path; see [Automatic Backups](#automatic-backups) |
| `write_emerald_file`, `read_emerald_file` | `emerald_file.rs` | the only way to write or read a `.emerald` or `.vault.emerald` file; extension check and the same path guards as `write_file`/`read_file` — outside the roots only the file the user chose (see [The File Chosen for the Import](#the-file-chosen-for-the-import)). Writing goes into `{target}.part` beside the target and is renamed into place only once whole; a `vaultKey` export refuses a vault that is locked or not encrypted. Reading is bounded — see [Emerald Import Limits](#emerald-import-limits) |
| `open_raw_backup_db`, `discard_raw_backup_db` | `emerald_file.rs` | a raw backup's database, unpacked by ticket into the active vault's folder under a fixed name (`emerald.db.raw`) and opened under the backup's own key (as plain SQLite for an unencrypted vault's backup) — a pool the webview reads through the same authorizer, never one `db_load` can name. Discarding closes it and removes the file by that name only |
| `store_emerald_files`, `close_emerald_file` | `emerald_file.rs` | take a ticket `read_emerald_file` handed out, never a path: the path and the derived key stay in Rust state (`EmeraldTickets`, at most four, the oldest given up). Storing reopens the file with that key, checks that its kind is still the one read, and writes pictures and icons only through `images::store` |
| `write_file`, `read_file`, `export_image` | `lib.rs` | path-taking; confined by `guarded_write_target` / `guarded_read_path` (see [Path Confinement](#path-confinement)); `read_file` reads a `.md` through `guarded_import_read` (see [The File Chosen for the Import](#the-file-chosen-for-the-import)) |
| `pick_import_file` | `chosen_file.rs` | the import window's open dialog, opened in Rust; takes only the filter's label and remembers the picked file as the user's choice — see [The File Chosen for the Import](#the-file-chosen-for-the-import) |
| `export_pdf` | `lib.rs` → `pdf_export/` | hidden-window PDF render, per-platform |
| `ensure_app_storage_dirs` | `lib.rs` | creates the app's own data and config dirs; takes no path |
| `save_image` | `images.rs` | decodes a data-URL in Rust and writes it into the active vault's `images/` — in an encrypted vault sealed and named by a keyed hash of its bytes, in an unencrypted one as it is under the SHA-256 of its bytes; extension from the MIME type, `png` fallback. No backend size cap — the frontend's upload limits are the only bound |
| `copy_image_file`, `read_image_as_base64`, `read_image_file` | `images.rs` | see [Path Confinement](#path-confinement) |
| `list_image_files` | `images.rs` | enumerates the vault's `images/` |
| `delete_image_files` | `images.rs` | **a delete primitive** — takes filenames, skips any that fail `is_valid_image_name`, resolves them only against the vault's `images/`. Used by Settings → Storage cleanup |
| `save_icon`, `read_icon_as_base64`, `list_icon_files`, `delete_icon_files` | `images.rs` | the same as their image counterparts, confined to the vault's `icons/` (`Store::Icons`); `save_icon` refuses a data URL above 2 MB (`MAX_ICON_DATA_URL`). An icon is sealed under `Context::Icon(name)`, so a file moved between `icons/` and `images/` does not open; the `emerald-img` handler serves `/{vaultId}/icons/{name}` from `icons/` with the same name check |
| `register_vaults`, `ensure_vault_dirs`, `create_vault_dirs`, `ensure_export_dir`, `probe_vault_dir`, `discard_new_vault_dirs`, `delete_vault_files`, `discard_import_staging` | `vault.rs` | see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary) |
| `read_vault_drafts`, `write_vault_drafts` | `vault.rs` | the vault's `drafts.json`, see [Vault JSON files](#vault-json-files) |
| `read_vault_settings`, `write_vault_settings` | `vault.rs` | the vault's `settings.json`, see [Vault JSON files](#vault-json-files) |
| `read_device_settings`, `write_device_settings` | `vault.rs` | `{appDataDir}/device.json` (language, theme, custom themes); a JSON object of at most 256 KB, written atomically like the vault's settings; take no path |
| `default_vault_dir`, `new_vault_base_dir` | `vault.rs` | path oracles for the vault picker and the backup import's add-vault mode; take no path |
| `close_request_seen` | `lib.rs` | no arguments: tells Rust the frontend is handling a close request (see [Closing the window](architecture/shell.md#closing-the-window)). All it can do is *prevent* the fallback that closes an unresponsive window |
| `update_menu_labels`, `set_view_menu_checked` | `lib.rs` | native-menu state sync; no-ops on Windows/Linux, where no native menu is installed |
| `set_dock_icon` | `lib.rs` | a custom theme's Dock icon as a size-limited image the frontend draws; no-op on Windows/Linux |
| `update_settings`, `set_update_settings`, `check_for_update`, `install_update` | `updates.rs` | reach the network for updates — see [In-App Updates](#in-app-updates) |

## The Dev Bridge

`src-tauri/src/devbridge.rs` lets the MCP server in `tools/mcp` drive the app on macOS and Linux, where the webview has no debug port (see [`mcp.md`](mcp.md)). It opens a local port through which a client runs JavaScript in the main window, reads the console, takes screenshots, sends mouse events and answers the app's dialogs — everything the webview can do, the client can do. With the bridge in the build and listening, the app's file dialogs and message boxes are held back and answered by the client instead of being shown, so such an instance is for the MCP and not for working in. It is therefore fenced in five ways:

- **Not in a release build.** The module, its two commands (`devbridge_reply`, `devbridge_event`) and the script it injects exist only with the cargo feature `devbridge`, which is off by default, and `lib.rs` refuses to compile the feature without debug assertions. The command count above is the one of a build without it.
- **Closed unless asked for.** A build that has the feature still listens only when `EMERALD_DEVBRIDGE_PORT` names a port. The MCP launcher sets it; `npm run tauri:dev` does not even enable the feature.
- **Loopback only.** The listener binds `127.0.0.1`.
- **It runs the session's checkout.** The tools that start the app run `npm install` and `tauri dev` from the checkout the session works in, as the server's user and outside any restriction the client puts on the session's own commands. Whoever can edit that checkout and call those tools can run code that way.
- **Invisible only when told.** On macOS the bridge can make the app's windows transparent and keep the app out of the Dock (the activation policy is set once the app is ready, as the windowing layer would overwrite it earlier), so an instance driven by an agent stays out of the way. It does so only while it listens and `EMERALD_DEVBRIDGE_HIDE_WINDOW=1` is set, which the MCP launcher does.
- **No web pages.** A WebSocket handshake that carries an `Origin` header is refused, so a page open in a browser on the same machine cannot connect. Any other local process can, as it can to the WebView2 debug port on Windows.

## External Links

The capability includes `opener:default`. In read mode, clicking an external link in the editor calls `openUrl(href)` (`TextEditor.tsx`) with an `href` from stored content — content that can arrive via an imported backup. The click handler passes only `http://` and `https://` URLs; anything else is ignored. Beyond that, the `opener` plugin's default configuration is the only filter before the URL reaches the system browser.

The read-mode click opens the link directly; the link popup that shows the URL appears only while editing. Look-alike links are therefore not mitigated in read mode.

## In-App Updates

`src-tauri/src/updates.rs` is the only part that talks to the network, and only for updates. The design rests on one split: **the update source is variable, the public key is not.**

The key lives in `plugins.updater.pubkey` in `tauri.conf.json` and is compiled into every build; its private half exists only as a GitHub secret (see [Signing](build.md#signing)). `tauri-plugin-updater` verifies every downloaded bundle against it before touching the installed app. If the key were editable alongside the URL, the variable source would become a way to install arbitrary code — which is why `update.json` has no field for it.

**A signature alone is not enough.** The manifest is not signed, only the artifact it points at. A hijacked manifest could pair a high version number with the URL *and genuine signature* of an older release — every check passes, and the user is downgraded onto a version with publicly known weaknesses. `requireSignedVersion: true` closes that: `@tauri-apps/cli` ≥ 2.11.5 records the app version in the signature's trusted comment, which minisign covers, and the plugin refuses any response whose announced version disagrees. The flag and the CLI floor belong together — the flag against older signatures rejects *every* update. With both in place, the worst a wrong, hijacked or mistyped source can do is deliver nothing, or deliver something that does not verify.

The source is `{appDataDir}/update.json`, next to `vaults.json`, and deliberately **not** in the per-vault settings: which server an installation asks belongs to the installation, not its content. No guarded path-taking command can write the file: `guarded_write_target` allows only `vaults.json` and `vaults/` in that directory. `export_pdf` is not behind that guard yet; it could overwrite the file with a PDF — which resets it to the defaults — but not put a source of its choosing there. Vault settings travel inside backups (`.vault.emerald`, and the raw backup's `settings.json`); an imported backup must not be able to point the updater anywhere.

`set_update_settings` rejects anything that is not a complete **`https`** URL. The signature check would catch a tampered manifest served over `http`, but not an attacker who keeps answering with an old manifest — enough to pin an installation to a known-vulnerable version indefinitely. Refusing at the command, rather than storing, means a bad URL cannot survive a restart and break every later check.

A user-set source precedes the compiled-in ones rather than replacing them: `check_for_update` builds the endpoint list as `[user, ...configured]`, reading the built-in list from `app.config()`. A source that 404s falls through to the next.

Everything runs in Rust, including the download, so the [Content Security Policy](#content-security-policy) stays at `connect-src 'self'` — an updater driven from the frontend would need the update host there, widening what any injected script could reach.

`install_update` installs only what the last `check_for_update` found and showed the user; the result is held in app state (`PendingUpdate`), not re-fetched.

It also refuses on an install method that cannot be replaced, and on Linux that test is deliberately strict. `APPIMAGE` is an ordinary environment variable **inherited by child processes**: a `.deb`-installed Emerald started from a terminal or editor that is itself an AppImage sees that foreign path, and the plugin would take it as the install target — overwriting an unrelated application. `install_supported()` therefore also requires the running executable to sit under `{temp}/.mount_…`, where an AppImage actually runs from (the same probe `tauri-utils` uses, though it only warns). A hand-extracted AppImage counts as "not replaceable", which is correct: there is no single file to swap.

## Vault Encryption

The mechanics are in [`architecture/encryption.md`](architecture/encryption.md); this section is what they are for and where they stop.

**Encryption is a choice.** It is made when a vault is created, and on by default; the dialog says what off means — the data lies readable on the disk. An unencrypted vault protects nothing below: its database is plain SQLite, its images, drafts and automatic backups are readable by anyone who can read the folder, and the export menu does not offer the vault key. It can be encrypted later; an encrypted vault is never decrypted, so the choice only ever tightens. What follows is about encrypted vaults.

**What is protected.** Everything a vault keeps on disk except `settings.json`: the database (SQLCipher, AES-256), images, icons and drafts (XChaCha20-Poly1305), the `.vault.emerald` export (sealed under the vault key by default, see [Encrypted files](architecture/encryption.md#encrypted-files)) and the automatic raw backups, which hold those files as they are. A `.emerald` file of entries is protected only when its export asks for it — an own password or the vault key; the export menu offers the vault key, an own password or none, and a template's **Export as Emerald…** writes it unprotected. A `.vault.emerald` export can be unprotected too, when the user picks none: that choice is never remembered. Every export's save dialog opens in the vault's own `export/` folder, unprotected ones included — a deliberate choice for one place over keeping plain files out of the vault folder. Someone who gets the vault folder — a stolen laptop, a synced cloud folder, a backup drive, a copy shared by mistake — reads nothing of the vault itself without the password or the recovery key, but does read what lies in `export/` as PDF, Markdown, HTML or unprotected `.emerald`. Image names are keyed hashes, so even the presence of a known picture cannot be confirmed.

**Passwords and keys.**

- The password is stretched with Argon2id (64 MiB, three passes), so guessing is slow per attempt. There is no attempt counter or lock-out: an attacker with the folder guesses offline anyway, and a counter would only guard the app's own dialog. There is no minimum length, only an empty password is refused: its strength is the user's own responsibility, and a weak password stays weak.
- The vault key is random, so changing the password replaces the key as well (a full re-encryption) rather than only the wrap. An old copy of `vault.key` plus the old password — from cloud version history, say — then opens nothing written afterwards.
- The recovery key is a second, independent way in and as sensitive as the password. It is shown once, after every operation that creates a key, and the dialog does not close until the user says it is stored. Using it ("forgot password") issues a new one; the old one is spent.
- The key lives only in Rust memory (`Zeroizing`, wiped on drop) while the vault is unlocked, and no command returns it. Leaving a vault locks it, and **Settings → Security → Lock now** locks the open one and asks for the password even when it is remembered.
- **Remember on this device** puts the vault key in the OS keychain: whoever can read that keychain entry — the logged-in user, malware running as them — opens the vault. It is not offered where there is no keychain (a Linux desktop without a Secret Service). The service name carries the app identifier so installations do not touch each other's entries.

**The SQL boundary.** The webview runs arbitrary SQL, so the authorizer on every connection is a security control, not a convenience. It denies the key pragmas, `cipher_*` settings and `sqlcipher_export` — any of which could re-key the vault behind `vault.key`'s back or write a plaintext copy anywhere — and permits `ATTACH` (and with it `VACUUM INTO`) only for the vault's own import staging copy. Pools are opened by vault id and a fixed file name. A vault without `vault.key` is opened in the clear — that is what an unencrypted vault is — but `db_load` never creates its database: only `vault_create_plain` does, for a vault with neither key nor database, so a deleted `vault.key` does not turn an encrypted vault into a fresh plain one. `VAULT_LOCKED` is returned for an encrypted vault that is not unlocked.

**A vault that lost `vault.key`.** A vault without `vault.key` counts as unencrypted only while its `emerald.db` is plain SQLite (or empty). A SQLCipher database without its key file is refused when opened (`VAULT_KEY_MISSING`, with a message saying to put the file back) and not backed up, so the backups that still hold the key are not pruned away. Someone who can write to the folder can still swap in a key-less plain database of their own: the app then opens that one, unencrypted — it never sees the real vault's content, but what the user writes there afterwards lies in the clear.

**Interrupted re-encryption.** The original stays untouched until a complete copy has passed `integrity_check` and a row-count comparison; a marker file decides, after a crash, whether to throw the copy away or finish the swap. After the swap the old database, the import staging copy, any `emerald.db.pre-vNN.bak` copy and every image the new key does not name are deleted. Encrypting an unencrypted vault is the same run from a plain source.

**Known limitations**, stated plainly:

- **Data is in memory while a vault is unlocked.** The decrypted content sits in the WebView and the stores; a memory dump, a swap file or a hibernation image of a running session can contain it. Encryption protects the vault at rest.
- **Plaintext that left the vault is not recalled.** Backups an unencrypted vault made before it was encrypted — the automatic ones in its own `backups/` folder included, which the Security page points out —, exports (an unprotected `.emerald`, Markdown, PDF), and earlier copies in cloud version history stay as they are. Deleted plain files may be recoverable from an SSD or a snapshot; only full-disk encryption (BitLocker, FileVault, LUKS) closes that gap.
- **No cross-process lock.** Two Emerald processes on one vault — the release build and a dev build, say — are not coordinated; a password change in one while the other has the vault open is unsupported.
- **macOS builds are unsigned.** After an update the keychain may ask whether the app may read its entry again; the choice is the user's. On a build the entry does not yet trust, macOS was measured asking twice for a single read. "Allow" holds for that read only; "Always Allow" in both prompts holds until the binary changes.
- **Windows keychain entries are written with `CRED_PERSIST_ENTERPRISE`**, the `keyring` crate's setting, so on a domain profile with roaming enabled they may roam with the profile.
- **`settings.json` and `device.json` are plain**, deliberately: neither holds entry content. A vault's `settings.json` holds its fonts, sizes, limits and rules, and is read before the database opens; `{appDataDir}/device.json` holds the installation's language, theme and custom themes (their names and colours) and is read before any vault is unlocked. A `settings.json` written before still carries the language and theme it had, unread.

## Vault Directories as a Trust Boundary

A vault is a directory the user picks, and it may sit outside every fixed user root — another drive, an external disk.

**`resolve_allowed_roots` deliberately does not include vault directories.** The registry behind them is filled by `register_vaults`, an ordinary frontend command; a frontend that could add its own roots would hand itself the very boundary that exists to contain it. "The user picked it in a folder dialog" is a guarantee in TypeScript that Rust cannot verify, so it is not treated as one.

**No storage command accepts a path.** They take a vault *id* and resolve it through `vault_dir()` against the registry; an unknown id is an error, and ids must match `[A-Za-z0-9-]{1,64}` before they can become a path segment. `register_vaults` itself accepts only absolute paths. A path arriving over IPC, or read out of stored HTML content, never becomes a destination.

The cost: `write_file` / `read_file` / `write_emerald_file` / `read_emerald_file` / `export_image` / `copy_image_file` stay confined to the fixed roots, so a manually saved backup file or Markdown export cannot be written into a vault folder outside them, nor read out of one other than as the file chosen for the import. Two deliberate exceptions: the automatic backup writes outside them (see [Automatic Backups](#automatic-backups)), and the import reads the one file the user chose for it wherever it lies (see [The File Chosen for the Import](#the-file-chosen-for-the-import)). Opening, using and deleting such a vault works in full.

The fixed roots include `document_dir()` and `app_data_dir()`, so a vault at its default location (`{documentDir}/Emerald Vaults/{name}`, see [Vault Layout](architecture/storage.md#vault-layout)) and its `backups/` and `export/` folders sit *inside* them, as does `{appDataDir}/vaults/{id}`, where a vault created without a chosen location lives. For a vault *outside* the roots — and likewise for one inside the app data directory but outside `vaults/` — `ensure_export_dir` refuses up front — offering a default there would only have `write_file` / `write_emerald_file` / `export_image` refuse the write a moment later — and the export dialog falls back to a plain filename.

### Automatic Backups

The automatic backup is the one place where a backup is written outside the fixed roots, and it does so without any command taking a path (`auto_backup.rs`, `raw_backup.rs`).

- **The target folder is never an IPC argument.** It is either the vault's own `backups/` folder — resolved from the registry like the database next to it, so it also works for a vault outside the roots — or a folder the user picked. `pick_auto_backup_dir` opens the native folder dialog *in Rust* and stores the result itself; the frontend receives the path for display only and has no command to set one. That includes `write_file`: directly below the app data directory `guarded_write_target` lets a path-taking command write only `vaults.json` and into `vaults/` (see [Path Confinement](#path-confinement)), so the stored folder cannot be planted either. (`export_pdf` does not go through that guard; a PDF written over `auto-backup.json` is not valid JSON and merely switches the automatic backup off.) A stored path that is not absolute counts as missing.
- **The setting belongs to the installation.** Which vaults, the interval, the retention and the picked folder are kept in `{appDataDir}/auto-backup.json`, not in any vault's `settings.json`: settings travel in backups, and an imported backup must not be able to bring a write target along. `set_auto_backup_settings` takes vault ids of the registry's shape and a retention from the offered counts only; a hand-edited file is read back the same way (invalid ids dropped, other values to their default).
- **The file name is built in Rust**: `emerald-auto-{first 8 characters of the vault id}-{YYYY-MM-DD}.vault.emerald`, the date from the local clock, written through `{name}.part` and a rename (`place_file`), which replaces a link under the target name instead of following it.
- **What is written is as encrypted as the vault.** An unencrypted vault's raw backup is unencrypted like it — readable by anyone who can read the backup folder, with no key file in it. An encrypted vault's raw backup packs the vault's files as they lie on the disk — the SQLCipher database, `vault.key` (wrapped), sealed pictures and icons, and the plain `settings.json`, which is no more secret there than in the vault folder. No key leaves the process: the database of an unlocked vault is copied with `VACUUM INTO` on a connection of Rust's own under the key it already holds (never through the webview's SQL, whose authorizer refuses an `ATTACH` outside the vault folder), into `emerald.db.snapshot` beside the database, which is removed again. A locked vault is packed without its key, and a change during the copy throws the copy away before it comes into place. The vault's own `backups/` and `export/` folders are never packed.
- **A picked folder is never created.** One that is gone — an unplugged disk — is reported as `AUTO_BACKUP_DIR_MISSING` rather than silently replaced by a new folder on whatever now answers to that path.
- **It is read back only through the import.** A raw backup is opened like any `.emerald` (`read_emerald_file`), from the picked folder only as the file the user chose in the import's dialog or dragged in (see [The File Chosen for the Import](#the-file-chosen-for-the-import)), so the picked folder never becomes a read source of its own; see [Emerald Import Limits](#emerald-import-limits) for what a raw backup may hold.
- **Pruning deletes by exact name only.** Regular files matching this vault's own pattern, oldest first, and never the newest — `keep` must be one of the offered counts (3, 5, 10, 30) or absent, so no single call can wipe the history; a manual `emerald-backup-…` file, another vault's automatic backups and anything else in the folder are not candidates.
- **No overlap with a password change or a deletion.** Both swap or remove database and `vault.key`; a raw backup holds the same lock as they do (`reencrypt::RUNNING`) and does not start while one runs.

**`delete_vault_files`** removes only the vault's own artefacts **by name**, never with `remove_dir_all`: the app puts its database into whatever folder the user chose, so a vault created straight in Documents would otherwise take Documents with it. It refuses unless the folder contains an `emerald.db` (`not a vault directory: no database found`), then deletes:

1. `emerald.db` and its journal,
2. files in `images/` and `icons/` whose names pass `is_valid_image_name`,
3. `settings.json`, `drafts.json`, `vault.key` and their `.tmp` write-companions,
4. what is useless without the key (in an unencrypted vault: plain copies of what the vault holds anyway): the import staging copy, the unpacked database of a raw backup being imported, a raw backup's snapshot, every `emerald.db.pre-vNN.bak` an earlier version's migrations left (by whole name, `migration_backup_version`), and the leftovers of an interrupted re-encryption.

With the files gone, the vault's key is forgotten in memory and in the OS keychain.

The directories go last with plain `remove_dir`, which fails while anything else is inside — and that failure is the *answer*, not an error. A folder that also holds a backup in `backups/`, an export in `export/` or a stray `desktop.ini` stays standing (an *empty* `backups/` or `export/` counts as the vault's own and goes too). It waits for a raw backup of the vault that is running, and the command returns `false` so the UI can say so. A half-deleted vault cannot resurrect as an empty one: the caller drops it from `vaults.json` after every `Ok`, and an `Err` only occurs while the database itself could not be removed.

**`discard_import_staging`** is the narrowest by-name delete, for one fixed target: `emerald.db.import` (plus `-journal`/`-wal`/`-shm`), the working copy a backup import fills and swaps in (see [DB Backup / Restore](database.md#db-backup--restore-vaultemerald)). It can delete nothing else, and a missing file is not an error. It runs before every import, to clear what a crashed one left, and after every import, successful or not.

**`discard_new_vault_dirs`** takes back the empty skeleton of a vault that never got a database (an import into a new vault cancelled at the password). It does nothing when `emerald.db` exists. It deletes only `settings.json` (and its temp file) by name and `images/`, `icons/`, `backups/` with plain `remove_dir`, which refuses anything with content; the vault folder goes only when `remove_root` is set (this attempt created it, see `create_vault_dirs`) and it is empty by then.

**`ensure_vault_dirs` does not create the vault directory.** The rule lives in `images_dir()` and `icons_dir()` (`vault_subdir`), so it holds for every command that touches vault storage: SQLite would put a fresh, empty database into a recreated folder, so a vault on an unplugged drive would silently come back empty. Creating is `create_vault_dirs`, called once when a vault enters the list.

**`probe_vault_dir` is a deliberate exception:** it takes a raw path and is not confined to any root, because it answers "what is in the folder the user just picked?" before that folder is registered. It returns four booleans — exists, access denied, holds a database, is empty — and reads no content: an existence oracle for arbitrary paths and nothing more.

**macOS: picking a file does not grant access to its folder.** "Open vault" and "Locate again" use a file dialog filtered to `.db` (a folder dialog lists no files, so nothing would show whether a folder holds a vault), and the vault directory is the file's parent. Under TCC, choosing a file inside `~/Documents`, `~/Desktop` or an iCloud-synced folder grants access to that file only, not to listing its parent. `probe_vault_dir` then reports `denied`, and the vault picker says "no access to the folder" rather than "no vault here"; `images_dir()` behaves the same afterwards. No Rust-side work gets around it — only the user can grant the permission.

### Vault JSON files

`settings.json` and `drafts.json` are read and written by vault id, through the same registry, never by path; `device.json` by no argument at all, in the app data directory. An unreadable `device.json` (no JSON object, too large, no plain file) is renamed to `device.json.bad`, never removed. `drafts.json` is sealed in an encrypted vault ([Vault Encryption](#vault-encryption)); `settings.json` is plain.

- **Writes** accept only a JSON object, at most 256 KB for settings (`SETTINGS_MAX_BYTES`, far above what the settings page produces — a guard against a runaway write) and 4 MiB for drafts (`DRAFTS_MAX_BYTES`). They write a `.tmp` file, `fsync` it and `rename` it over the real one, so a crash mid-write leaves the previous file (`vault.key` is written the same way). A symlink is never followed under either name: the temp name is cleared and opened with `create_new`, and `rename` replaces a link at the target without following it. An empty drafts object removes `drafts.json` instead.
- **Reads** use `symlink_metadata` (matching `guarded_read_path`) and return a tagged `Missing`/`Found`/`Unreadable` result. Only "the vault directory itself is gone" is an error: a file that exists but isn't a plain, readable, size-capped file must not block opening the vault, so the frontend falls back to defaults and leaves it alone.
- **Drafts are untrusted on the way back in.** Every draft passes the parsers a database row passes (`draftStore.ts`), ids are checked, and a file of another version is ignored. A draft's content renders and saves through the same block path as a stored template's, so it gains nothing a stored one could not do.

### The registry can arrive pre-populated, from a directory this installation does not manage

A path becomes trusted only once it is in the registry, and only `register_vaults` writes into `VaultRegistry` — no exception. But on a first start, the `vaults.json` that `register_vaults`' entries come from can be a copy that `adopt_previous_identifier_dirs` (`vault.rs`, see [Adopting a previous identifier's data](architecture/storage.md#adopting-a-previous-identifiers-data)) placed from the previous identifier's directory — one this installation does not control.

That does not widen what a vault path can be: `vaults.json` always holds arbitrary absolute paths. What adoption adds is `retarget_registry`, a rewrite of a file this code did not produce: it moves stored paths from the old `appDataDir` root onto the new one, for vaults in the `{appDataDir}/vaults/{id}` layout. `strip_prefix`/`join` are purely lexical, so a `..` in a stored path could walk the result back out of the new data directory.

`retarget_registry` therefore rewrites an entry only when everything past the stripped prefix is an ordinary path component (no `..`, no root/prefix component); anything else stays exactly as it was. Such a vault keeps pointing at the previous installation's directory, which still exists because adoption copies rather than moves — it opens from there, while the adopted copy beside it grows stale. It becomes "Folder not found" only once the old directory is deleted. Not retargeting a path is recoverable; retargeting it somewhere unintended is not.

## The `emerald-img` URI Scheme

Images are served to the webview over a custom scheme instead of through IPC. The request path is `/{vaultId}/{filename}` for a picture and `/{vaultId}/icons/{filename}` for an icon, and both segments are attacker-reachable in principle: the filename comes from stored HTML content, which may have arrived in an imported backup.

- **The handler decrypts**, in Rust, with the key of the vault named in the URL; a locked vault, a wrong key or a damaged file is a 404. The response carries `Cache-Control: no-store` so the WebView does not keep decrypted images on disk.
- **The filename is validated before any path is built** (`is_valid_image_name`): exactly 64 lowercase hex digits, a dot, and one of `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg`. Rejecting everything outside that alphabet means percent-encoded traversal never has to be decoded — it simply fails the check.
- **The vault id is resolved through the registry**, so the directory is one the user authorised; an unknown id yields 404. The file is looked up in that vault's `images/` (or `icons/` for the `icons/` path) and nowhere else.
- **Reads happen off the main thread** (`register_asynchronous_uri_scheme_protocol`), so a large file cannot stall the UI.
- **`Access-Control-Allow-Origin: *`** is belt and braces, not load-bearing: the canvas blocks load their images as data-URLs when they render a picture (`canvasImageSrc()`), so they do not depend on the scheme being CORS-enabled (wry does not register it as such on every platform). The header stays because the images come from the app's own storage, so allowing the read grants the page nothing it could not already request.

## Path Confinement

**`read_image_as_base64`** takes a vault id and a filename, not a path. The filename passes the same check as the URI scheme, and the file is looked up in that vault's `images/`. There is no way to name a file outside that directory.

**One guard per direction.** `guarded_write_target()` and `guarded_read_path()` in `lib.rs` hold the path rules; `write_file`, `export_image`, `read_file` and `copy_image_file`/`read_image_file` call them instead of repeating the sequence (`read_emerald_file` and a `.md` through `read_file` via `guarded_import_read`, which falls back to `guarded_read_path`), so the two halves of the boundary cannot drift apart.

Both guards check against the fixed roots from `resolve_allowed_roots`: home, documents, downloads, desktop, app data and app config — deliberately *not* the registered vault directories (see [Vault Directories as a Trust Boundary](#vault-directories-as-a-trust-boundary)). Violations return `"access denied: path outside allowed directories"` or `"access denied: symlink targets are not allowed"`.

**`guarded_write_target`**:

1. Canonicalizes the deepest already-existing ancestor of the target and checks it against the roots **before** creating anything, so a denied write leaves no directories behind outside the boundary.
2. Creates the parent directories, canonicalizes the parent and checks it again.
3. Calls `symlink_metadata` on the target unconditionally and refuses any symlink — resolvable or dangling. (`target.exists()` would follow the link and report `false` for a broken one, letting `fs::write` create the file at the link's target outside the roots.) An existing target is also canonicalized and checked.
4. Refuses a target in the app data directory unless it is `vaults.json` itself or lies below `vaults/` (`access denied: reserved for the app`) — checked on the resolved path before any folder is created, and again on the final target. Everything else there is the state of a Rust module (`auto-backup.json`, `update.json`) and is written by that module alone. It is an allow-list because a case-folding or Unicode-normalising file system knows more spellings of a reserved name than a comparison could; a spelling of an allowed name is merely refused.

**`guarded_read_path`** refuses a symlink (`symlink_metadata`), canonicalizes the path and checks it against the roots.

### The File Chosen for the Import

A backup on another drive or a USB stick is imported where it lies, without being copied into the user's folders first. The import's two readers — `read_emerald_file`, and `read_file` for a `.md` — go through `guarded_import_read` (`chosen_file.rs`): a path inside the roots is checked by `guarded_read_path` as before; outside them it is read only when it is exactly the file the user chose last.

- **The choice is made where the page cannot fake it.** `pick_import_file` opens the import window's open dialog in Rust, filtered to `.emerald` and `.md`, and remembers what was picked; the page gets the path back for display and to name it to the readers, and has no command to set it. A file dragged in is the operating system's drop event, which `on_window_event` hands to `note_drop` before the page hears of it; of a drop, the first file with an import ending is remembered — the one the import window opens (`ImportModal`) — and a drop without one (pictures for "Images") leaves the choice alone.
- **One file, the latest.** Each choice replaces the previous one; a cancelled dialog leaves it alone. It is remembered canonicalized and only if it is an absolute path to a plain file — no link, no folder — with an import ending; anything else clears the choice, so reading it fails with `guarded_read_path`'s error as before. The comparison is against the canonicalized path asked for, so neither a `..` nor another spelling reaches a different file.
- **Read only, for the import only.** The choice widens nothing that writes, and no other reader: `.json`/`.txt` through `read_file`, the image commands and every export stay on the fixed roots. A dropped picture is still read only inside them.
- **What it does not protect against.** A file the user drops by mistake counts as chosen too; the import then only reads it, under the [Emerald Import Limits](#emerald-import-limits), and imports nothing until the user confirms.
- **A drop during an opening wins.** A dropped import file becomes the choice in Rust at once, so the import window gives up a file still opening and opens the dropped one (see [The import window](architecture/shell.md#the-import-window)).

On top of the guards, each command allowlists extensions and returns `"unsupported file type"` for anything else:

| Command | Extensions | Notes |
|---|---|---|
| `write_file`, `read_file` | `.md`, `.json`, `.txt`; `write_file` also `.html` (the HTML export) | keeps them from being a general filesystem read/write primitive. `.emerald` is not on the list: a `.emerald` file is written only through `write_emerald_file`, sealed as its export asks, or by the automatic backup, so no backup can be written in the clear by accident |
| `write_emerald_file`, `read_emerald_file` | `.emerald` (which `.vault.emerald` ends in) | the same path guards |
| `export_image` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` | the base64 payload is decoded in Rust before writing, so no text encoding or newline handling can alter the bytes |
| `copy_image_file`, `read_image_file` | `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg` | shared helper `checked_image_source` |

**`read_image_file`** never writes into a vault: it reads a validated external file and returns it as a base64 data-URL, for the frontend to scale and check against the vault's image limits (Settings → Entries, `src/lib/imageLimits.ts`), and to store a photo PNG as JPEG while "Optimise photos" is on, *before* handing it to `save_image`. A dropped file goes this way whenever one of these could change it (`needsPreparing`); otherwise `copy_image_file` copies it as it is. It adds a hard **64 MB cap** (`MAX_EXTERNAL_IMAGE_BYTES`) checked via `fs::metadata` before reading — the bytes cross IPC as base64 and are decoded onto a canvas, so an arbitrarily large file would stall the webview before any vault limit could reject it. The vault's own maximum (if smaller) is enforced afterwards in TypeScript, which is why the 64 MB number lives only in Rust.

For `copy_image_file` the *destination* is not a path at all — it is the vault's `images/` folder, resolved from the vault id.

## Frontend Input Validation

Validation rules against malformed, oversized, or untrusted data, much of it in the canvas blocks:

- **Image sources.** Stored image references are turned into a `src` only through `imageSrc()` (`src/lib/images.ts`): a valid stored filename becomes an `emerald-img` URL for the active vault, `data:`, `blob:` and `http…` values pass through, and anything else yields an empty string, so the `<img>` is skipped and the emoji or live preview is shown instead. Pictures on a canvas, the tiles of "Images" and image fields all go through it. Remote `http(s)` images are blocked by the CSP's `img-src` (see [Content Security Policy](#content-security-policy)).
- **Background CSS interpolation.** All canvas background CSS is built by the canvas editor's `backgroundCss`, with the picture's URL from `altarBackgroundUrl` (`src/lib/altarBackground.ts`, used through `BLOCK_BACKGROUND_IMAGES` in `components/blocks/toolkit.ts`: canvas, altar and the sigil's drawing): one of the app's own `/backgrounds/{name}.webp` or whatever `imageSrc()` allows — so only those shapes reach the CSS `url(…)`, with any quote escaped.
- **No SVG icons.** Every icon upload (entry, template, block, language) goes through `readIconFile` (`src/lib/imageLimits.ts`), which refuses `image/svg+xml` on top of the general MIME allowlist (`isAcceptedImageFile`); `save_icon` refuses an SVG data URL as well, and `store_emerald_files` skips an SVG member of `icons/`, so a backup or an `.emerald` file cannot bring one into `icons/` either (the row falls back to its default icon). Other upload paths accept SVG.
## Backup Import Column Validation

A `.vault.emerald` is untrusted input — it can be hand-edited, written unprotected or come from another machine. `insertRows()` in `src/lib/dbBackup.ts` (used by every import mode) builds each `INSERT`'s column list by intersecting the row's keys with `PRAGMA table_info(<table>)` of the real, hardcoded target table. A crafted backup can at worst contribute an extra key that is silently dropped (or, if no valid column remains, cause the row to be skipped) — it can never inject SQL through the column list. Row *values* go through parameterised placeholders (`$1, $2, …`).

The block rows of a backup (`data.blocks`) do not go through `insertRows`: `fileBlockRow` keeps only the known fields with the expected types, the blocks are written only for owners the import itself inserted, through the fixed column list of `copyBlockStatements` with bound values, and the positions are kept only if every one of an owner's blocks has a valid, unique key — otherwise all of them get fresh ones in the file's order. Such a row's `html` is not split from a block stack, so it can hold what `neutralizeSectionTags` would otherwise neutralise; read back, that can only give the same owner extra blocks, which a crafted `content` of a `.emerald` file could carry anyway, and they pass the same parser and renderers. Picture names are renamed in one pass (`renameAll`), so no key can make a text grow with every key; the keys are the archive's member names, which Rust accepts only in the shape of a stored name.

An imported row's *id* is a value too, and stays untrusted after the import — it can resurface in an unrelated later export. `collectVaultContent()` (behind `exportDatabase()` and the import of a raw backup) scopes related tables with `IN (...)` clauses (e.g. `task_links` to the exported tasks). sqlx splits a statement on `;` and executes each part, so an id like `'; DROP TABLE …; --` concatenated into the SQL would run as a second statement during a harmless-looking export. `selectWhereIn()` therefore binds every id as a parameter, chunked at 400 per query (`IN_CHUNK`) so the statement stays independent of vault size.

## Emerald Import Limits

A `.emerald` file comes from anywhere. `read_emerald_file` (`src-tauri/src/emerald_file.rs`) therefore bounds what it can make the app do before anything reaches the vault, by the kind its header names (`limits_for`):

| Kind | File | Members | Manifest | One picture | All members |
|---|---|---|---|---|---|
| `items` (`.emerald`) | 2 GB | 5,000 | 32 MB | 64 MB | 2 GB |
| `vault` (`.vault.emerald`) | 64 GB | 500,000 | 512 MB | 1 GB | 64 GB |
| `raw` (`.vault.emerald`, a raw backup) | 64 GB | 500,005 | 1 MB | 1 GB (the database: all members) | 64 GB |

- **Before the archive is parsed.** The header is at most 64 KB; the file size is checked against the kind's limit; the member count is read from the end records — through the ZIP64 record when there is one — before the ZIP reader allocates one record per member. Only the layout the app writes is taken (the end record last, without a comment, its central directory right in front of it), so the ZIP reader, which walks back to an earlier end record when the last one does not add up, can never count by another record than this check.
- **Every member through a cap.** Each is read through `take(limit + 1)`, so a member whose header understates its size or members that overlap unpack no further than a stored member could. Only the manifest may be deflated; any other member that is not stored — a deflated picture, icon or database — refuses the file before anything is unpacked, so no member but the manifest unpacks to more than the file holds. The manifest may also unpack to no more than 100 times its packed size (plus 1 MB), and Rust checks its frame without building a JSON tree of the rest.
- **Member names.** Only `manifest.json` (exactly once), `images/{name}` and `icons/{name}` with a name `is_valid_image_name` accepts are taken; any other member — a directory, `..`, an absolute or backslash path — refuses the whole file. Nothing is written by member name: pictures go through `images::store`, which names them by the keyed hash of their bytes. Icons follow `save_icon`'s rules (no SVG, at most 1.5 MB). A raw backup may also hold the vault's own files by their fixed names — `emerald.db` exactly once, `vault.key` exactly when the header carries a key file (an unencrypted vault's backup has neither), `emerald.db-journal` and `settings.json` at most once — and no other kind may; nothing of those is written by name either: the database is unpacked to the fixed `emerald.db.raw`, the settings read as text of at most 256 KB. A journal that ends in a super-journal record is removed right after unpacking, before the database is opened: on rollback SQLite would delete the file that record names, any path a crafted backup chose, and this app never writes such a journal.
- **Secrets.** A password-protected file's Argon2id parameters are bounded like `vault.key`'s, so a crafted header cannot make the key derivation take minutes or gigabytes; a `vaultKey` file's key file — and a raw backup's, the only kind whose header may carry one, and never sealed again — is parsed like `vault.key`.
- **Before a single picture is stored**, Rust checks the manifest's format, version and kind (header and manifest must agree), and for `items` the item count (at most 1,000), for `vault` that `data` is an object (`check_manifest`). The pictures are stored only by `store_emerald_files`, once the frontend has checked the manifest field by field (`parseManifest`: entry ids must be UUIDs — or such a UUID with the 8-character prefix an older merge import put in front — since re-linking replaces them whole in the content; at most 1,000 block definitions, 50,000 blocks and links, 50,000 picture details — stored names only, names trimmed, tag names at most 100 characters and 100 per picture; at most 1,000 tags the blocks give (`blockTags`: tag IDs, each once, names trimmed and at most 100 characters); `vaultContentOf` for a vault's content), so a refused file leaves the vault as it was. The content of `items` goes through `sanitizeImportedHtml` (see below); a `vault` file's content is written as it is, concealed sigils included.
- **A raw backup's database** is opened only under the key its own `vault.key` yields — one the user unlocked with that vault's password or recovery key —, or, for an unencrypted vault's backup, as plain SQLite; either way through the same authorizer as every pool the webview reaches, so its SQL cannot re-key or export it. Its schema is checked before anything is written (`prepareRawDatabase`), it is read whole like a vault, and its rows go through the same checked import as a vault's content. Its pictures must open under that key; one that does not refuses the import — and a sealed picture in an unencrypted vault's backup does too. Imported into an encrypted vault, an unencrypted vault's backup lies unpacked in the clear (`emerald.db.raw`) in that vault's folder while the import runs; it is removed afterwards, and by any later open after a crash.

**Protection.** A protected `.emerald` (an own password, or the vault key; see [Encrypted files](architecture/encryption.md#encrypted-files)) is sealed in 64 KiB chunks of XChaCha20-Poly1305, each bound to the whole header, its position and whether it is the last, so truncation, reordering and a changed header all fail. The header itself — kind, protection, KDF parameters, salt, nonce prefix, and for `vaultKey` the vault's `vault.key` (which is sealed anyway) — is in the clear. Reading decrypts only the chunk being read and never writes clear text to disk; writing goes into `{target}.part` and is renamed into place, so a failed export leaves no half file under the target name. The protection covers the file in transit only; once imported, its content lives under the vault's own key like everything else. An unprotected file — the export menu's "none", a template's **Export as Emerald…** — is plain.

## HTML Escaping in Exports

User-provided text interpolated into the PDF and HTML export goes through `htmlEscape()` (in `src/lib/export.ts`), which replaces `&`, `<`, `>`, `"` and `'` with HTML entities. It is applied to:

- the entry title (in `<title>` and the `<h1>`),
- the top bar's emoji icon and its label (the category name),
- tag names.

An image icon is passed through `sanitizeDataImageUrl` instead. The content HTML itself (TipTap output) is not re-escaped — it is sanitised (see below). Stored image references are resolved to base64 data-URLs by `embedImages()` before the HTML goes to the export backend.

## HTML Sanitisation

HTML that enters the app through an item or Markdown import is sanitised with DOMPurify before it is stored, and every export sanitises what it writes; a `.vault.emerald` file's content is stored as it is (see above).

**PDF and HTML export (`src/lib/export.ts`, `exportArticle`).** Before the content HTML is handed to `export_pdf` or written into an HTML export, it passes through `DOMPurify.sanitize` (which keeps any `data-*` attribute by default) with an allowlist for the internal-link attributes — `data-type`, `data-id`, `data-target-kind`, `data-label`, `data-icon`, `data-entry-number`, `data-href` — so internal-link chips survive, plus `colwidth` (table column widths) and `data-color` (one of six colour names; the print CSS matches only those). This closes an injection path if an editor extension or import produces unexpected HTML.

**Emerald import (`src/lib/emeraldFormat.ts`).** After picture names and links are remapped, content passes through `sanitizeImportedHtml` — the last step of every item import that writes HTML to the database. It keeps TipTap's own attributes (`data-type`, `data-id`, `data-target-kind`, `data-label`, `data-icon`, `data-entry-number`, `data-align`, `colwidth`, `data-color`) and strips everything DOMPurify removes by default (script tags, event handlers, …). `data-align` is intentionally not in the PDF allowlist: that path never reads it, and alignment survives through the image's inline margins.

**Markdown import.** `marked` converts the body to HTML in `emeraldFormat.ts`, and `sanitizeImportedHtml` runs as the very last step, so nothing added along the way skips the filter.

**Content blocks (`src/lib/blocks/`, `src/components/blocks/`).** Entry content is a stack of `<section data-block>` wrappers, and imported content reaches the block parser before TipTap's schema sees it — so the block layer treats every wrapper as untrusted:

- **Parser.** `parseBlocks` keeps only a section's `data-*` attributes (no `onclick`, `class`, `style`), decodes entities, and `blockSectionHtml` writes every attribute back double-quoted through `escapeHtml`, so a value cannot break out of its quotes. Editor HTML passes through `neutralizeSectionTags` before storing, so a `<section` inside an attribute value (older WebKit leaves `<` unescaped there) cannot split an entry.
- **Blocks the app cannot read.** A block of an unknown type, of a data version above its type's, or with damaged data renders none of its markup: `UnreadableBlock` shows a translated notice as React text, so there is no `dangerouslySetInnerHTML` in the block layer for foreign markup to reach — no fake UI, no forms, no links out of it, and nothing its type would conceal (a loaded sigil's parts) shows in the clear. The search does not read it and the export writes the same notice; it is saved byte for byte. See [Readable or not](architecture/blocks.md#readable-or-not).
- **Fields block.** Values render as React text; the readable fallback is written through `escapeHtml`. Element ids come from content: they must match `[A-Za-z0-9_-]{1,64}` and must not name an `Object.prototype` property, and the value/slot records have no prototype — so a crafted `constructor`/`__proto__` id cannot read a built-in as slot HTML. Image slots resolve through `imageSrc`, which confines stored names to the vault's image folder.
- **User-built blocks.** `block_definitions` rows arrive from `.vault.emerald` backups and, for the copies they bring, from `.emerald` files of entries — both through `insertBlockDefinitions` (normalised to the full column set, ids checked by `isDefinitionId`, `INSERT OR IGNORE` through the column-whitelisting `insertRows`). Their `elements`/`display` JSON is read through `parseDefinitionElements`/`parseDefinitionDisplay` — the same element validation as a copy in content (safe ids, known kinds, duplicates dropped) — and name and emoji render as React text. An import never overwrites an existing definition and never rewrites entries: copies render from their own content.
- **Failure isolation.** Every block renders inside `BlockErrorBoundary`: a block that throws shows the notice of a block that cannot be read (`UnreadableBlock`) instead of blanking the app (which, with the open tab restored at startup, would repeat on every launch).

**Templates.** A template's blocks are rows of `blocks` like an entry's, loaded as the same block stack, so inserting one (`instantiateTemplateBlocks`) is a block-tree operation that goes through the block-layer defenses above, not a fresh HTML parse.

## Search Text Extraction

The title bar's global search needs plain text from stored entry HTML — content that can arrive through an import. `plainTextFor()` (`src/lib/searchText.ts`) takes each block's search text (`blockSearchText`), which `htmlPlainText` reads from the markup without a DOM: nothing is parsed into a document, so an `<img onerror>` payload in stored content never executes. The content of `script`, `style` and `noscript` elements is dropped — TipTap never emits them, but imported content can.

**Block rows.** Content that arrives through an import is also split into [block rows](database.md#blocks) without a DOM. `htmlTags` (`src/lib/htmlTags.ts`) scans the markup linearly instead of with a backtracking regular expression, so crafted markup (thousands of `<a` without a `>`) cannot stall the open or an import. `htmlPlainText` (behind `blockSearchText`) strips tags the same way and never executes anything. The link chips (`extractInternalLinks` and its siblings in `internalLinkHtml.ts`, which `blockRefs` runs on every saved, imported and backed-up block) find their `<span>` tags through the same scan, and so does `isBlankContent` on an `.emerald` import.

## Content Security Policy

The main window has an **explicit, hand-written CSP** in `tauri.conf.json` (`app.security.csp`), not Tauri's default. It allows **no remote origin at all**:

- `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `font-src 'self' data:`.
- `img-src 'self' data: blob: emerald-img: http://emerald-img.localhost` — the image scheme in both forms the platforms serve it as (WebView2 maps custom schemes onto `http`, the other engines do not).
- `connect-src 'self'` plus the Tauri IPC origins. It has no `data:`, so a data URL cannot be read with `fetch()`; the photo worker decodes it itself.
- No `worker-src`: workers fall back to `script-src 'self'`. The one worker (`src/lib/photoWorker.ts`) is a file Vite emits next to the bundle, never a `blob:` or `data:` URL, and only decodes and encodes images.
- `object-src 'none'`, `frame-src 'none'`, and `form-action 'none'`. The app has no HTML form that posts anywhere, and `default-src` does not cover form targets — without it, a form that slipped into rendered content could send what the user types to a remote server.

The eight typefaces ship with the app (`@fontsource` woff2 files bundled by Vite, `src/fonts.css`), so nothing is fetched for typography and the app looks the same offline. The only network code is in Rust, which the page's CSP does not govern: the updater (see [In-App Updates](#in-app-updates)).

**Inline scripts.** `script-src 'self'` does not block *every* inline script: Tauri hashes each inline `<script>` in the built HTML at compile time and appends its sha256 to `script-src` (`tauri-codegen`'s `inject_script_hashes`, consumed by `set_csp`). So a specific, unmodified inline script — like the boot script in `index.html`'s `<head>` that sets the theme and arms the loading screen's fallback timer, see [Loading Screen and Boot Order](architecture/shell.md#loading-screen-and-boot-order) — runs; any other or modified inline script is blocked.

**Inline styles.** Tauri gives each `<style>` element a nonce, and a nonce in `style-src` makes CSP3 ignore `'unsafe-inline'` — which would silently block every `style={{…}}` attribute in the app (the sidebar widths in `AppShell`, among others) in a packaged build. That is why the loading screen's CSS lives in `public/splash.css`, loaded via `<link>`, rather than a `<style>` block in `index.html`.

**PDF export.** The export HTML is written to a unique file in the OS temp directory and loaded by a hidden webview over a `file://` URL. That document carries **no CSP at all** — a `file://` document has nothing to inherit it from. What controls that path is `htmlEscape` and `DOMPurify.sanitize` in `src/lib/export.ts` (see [HTML Escaping in Exports](#html-escaping-in-exports) and [HTML Sanitisation](#html-sanitisation)), and the export file — the entry in plain text, outside the vault — is removed as soon as the export ends, however it ends (a drop guard), is created readable by its user only on Unix, is never logged by path, and any that a crash left behind are swept at startup once they are an hour old. The internal-link chip transformation (`transformInternalLinks`) is pre-rendered in TypeScript as a convenience, not a CSP necessity.

**HTML export.** The `.html` file (`src/lib/htmlExport.ts`) is opened by the reader's browser, not by the app, so the app's CSP does not apply to it and it carries its own in a `<meta>` tag: `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'` — nothing is loaded from the network and no form posts anywhere. Its one inline script is a constant of the app (navigation, search, outline, theme, sorting, covering and uncovering); it reads everything from the DOM, and no entry data is ever interpolated into script source; the cover's switch is a plain `<button>` in the content whose labels it takes from `data-*` attributes and writes as text. A charged sigil's concealed calculator and drawing are in the file, covered: readable in its source, by the user's decision — concealing a sigil is the user's own discipline, not a protection (PDF and Markdown leave them out). Entry content goes through the same `htmlEscape` and `DOMPurify.sanitize` as the PDF, so an entry cannot add a script of its own; besides `#entry-…` anchors into the same file it keeps the links DOMPurify allows by default (http(s), `mailto:`, `tel:` and the like, never `javascript:` or `data:`); the script opens the http(s) ones in a new tab with `noopener`. An embedded app font is the app's own `woff2` file, read from the app's stylesheet and inlined as a data URL.

## File Dialog Safety

File open and save operations use `@tauri-apps/plugin-dialog`, which presents a native OS file picker. The user explicitly selects or names the file; the application never constructs paths from user-provided text without going through this picker.

The import window's own open dialog is opened in Rust (`pick_import_file`), so that the file picked there may be read outside the user's folders; see [The File Chosen for the Import](#the-file-chosen-for-the-import). The one other source of paths is a file dragged in from the disk (Tauri's drag-drop event, `useFileDrop`): the user chose it just as in the picker. Such a path is treated exactly like a picked one — for the import, Rust remembers it from the operating system's event, not from the page. The import window (`ImportModal`, `useImportDrop`) takes only the endings its open dialog offers (`isImportPath`: `.emerald`, which `.vault.emerald` ends in, and `.md`) and hands the path to the same `read_emerald_file` / `read_file` as the dialog, with their path guards, extension lists and limits; a picture drop goes through `acceptedImagePaths` and the image commands. A file of another kind dropped on the open import window is refused with a notice, never read.

## No `window.confirm()`

Emerald does not use the browser's `window.confirm()` because WKWebView suppresses it. Destructive actions use an inline two-click confirmation (`InlineConfirm`, typically driven by a `confirmingId` state), which also gives control over styling and placement.
