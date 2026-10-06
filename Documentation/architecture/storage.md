# Images, Vaults and Settings

## Image Storage System

Images are content-addressed, stored outside SQLite, and belong to one vault.

- **Location**: `{vaultDir}/images/{hash}.{ext}` — see [Vault Layout](#vault-layout). The hash is a keyed hash of the image bytes, and the file is sealed ([`encryption.md`](encryption.md#sealed-files)); the name is 64 hex digits either way.
- **What the database stores**: the bare filename, no directory or drive letter. That is what makes a vault folder copyable to another machine.
- **Insert path**: `save_image` (data-URL) and `copy_image_file` (a file on disk) decode, hash, seal, write into the active vault's folder if absent, and return the filename. Both are reached through `src/lib/images.ts`, never invoked directly.
- **Display path**: the `emerald-img` URI scheme. `imageSrc(filename)` builds `emerald-img://localhost/{vaultId}/{filename}` — on Windows `http://emerald-img.localhost/{vaultId}/{filename}`, since WebView2 serves custom schemes over `http` — and the webview fetches the bytes itself: no IPC round trip, no base64, no in-memory cache. The handler opens the sealed file before answering. See [`security.md`](../security.md#the-emerald-img-uri-scheme).
- **Caching**: the handler answers with `Cache-Control: no-store`, so decrypted images do not land in the WebView's disk cache, in the clear and outside the vault. The filename is the content's keyed hash, so a name never returns anything else — the cache would be safe, but not private.
- **Canvas access**: the altar export and thumbnail read a canvas back with `toBlob()`, which fails once anything foreign is drawn on it — and custom-scheme images are foreign. That path uses `canvasImageSrc()`, which fetches the bytes as a data-URL (one IPC round trip per image, on export and capture only). The handler's `Access-Control-Allow-Origin: *` is not relied on: wry registers the scheme as secure but not CORS-enabled, whether WebKitGTK and WKWebView honour the header for it is unverified, and a failure would be a silently empty export.
- **Deduplication**: per vault. The same image in two vaults is two files — isolation is worth more than the bytes.
- **Cleanup**: Settings → Storage → *Unused images*, on demand. `findUnusedImages()` diffs `list_image_files` (the vault's own folder) against `collectUsedImageFilenames(db)`. Deliberately not automatic: an image that so far exists only in an unsaved editor buffer would count as unused. The check is safe because folder and used-set come from the same vault.
- **Legacy pool**: `{appDataDir}/images/` holds images written before the per-vault layout. Migration v35 copies each referenced file into its vault — sealed, under the old SHA-256 name, since the content refers to that name — and the protocol handler falls back to the pool for anything it missed. Nothing writes there, and the cleanup never proposes deleting from it — vaults not opened since the migration still read from it. Such an image keeps its SHA-256 name until the next password change re-encrypts the vault.

## Vault Layout

A vault is a directory holding:

- `emerald.db` — the SQLCipher database
- `vault.key` — the vault key, wrapped by the password and by the recovery key, see [`encryption.md`](encryption.md#keys)
- `images/` — sealed image files
- `backup/` — where the export dialog opens and where automatic backups go unless another folder was picked
- `settings.json` — the vault's settings, see [Vault Settings](#vault-settings); the only file in the folder that is not encrypted
- `drafts.json` — only while a block or template page holds unsaved edits; sealed
- `emerald.db.pre-vNN.bak` — the full copy a rebuilding migration takes first; `prune_migration_backups` keeps only the newest once the vault has opened
- `emerald.db.import` — transient: a backup import `VACUUM INTO`s a working copy here while it fills and checks it, then removes it whether the import succeeds or fails. A copy left by a crash is cleared before the next import (`discard_import_staging`, see [DB Backup / Restore](../database.md#db-backup--restore-emeralddb)).
- `vault.key.pending`, `emerald.db.reencrypting`, `images.reencrypting/`, `drafts.json.reencrypting`, `vault.reencrypting` — transient: a re-encryption builds its copy here and swaps it in; `vault_key_status` finishes or discards what a crash left, see [Re-encrypting a vault](encryption.md#re-encrypting-a-vault).

The user picks where the vault lives — Documents, a synced folder, another drive.

`{appDataDir}/vaults.json` maps ids to directories:

```json
{
  "version": 2,
  "vaults": [{ "id": "uuid", "name": "My Vault", "path": "…/Documents/Emerald Vaults/My Vault", "createdAt": "…", "icon": "🌿" }],
  "activeVaultId": "uuid"
}
```

Nothing reads `version`, and records travel through `vaultManager.ts` whole (`vaults.push(entry)`, `{ ...v, ...patch }`), so a field a newer build wrote survives an older build round-tripping the file. Bump the version only for a change that needs *handling*, not per added field.

A fresh installation starts with an **empty** vault list. `readVaultsFile()` synthesizes a `default` entry only when `vaults.json` is missing *and* `legacy_default_db_exists` finds a pre-multi-vault database; a list the user emptied stays empty. `getActiveVaultPath()` throws `NO_ACTIVE_VAULT` rather than falling back to `vaults[0]`, which would open a different vault under the wrong id. `AppShell` gates on membership (`hasActiveVault`, not list length — `switchVault` rolls `activeVaultId` back to `''` on a failed open) and until then mounts only the title bar and a non-dismissible `VaultModal`, since anything else would call `getDb()`.

- **`vaultManager.ts`** owns that file and is its only writer. Every write calls `register_vaults`, which mirrors `id → path` into Rust state.
- **Commands take a vault id, never a path.** `vault_dir()` resolves the id against the registry. A path handed in over IPC, or read out of stored content, is not evidence that the user authorised it.
- **`resolve_allowed_roots()`** deliberately leaves the registered directories out — see [`security.md`](../security.md#vault-directories-as-a-trust-boundary). Vault storage resolves by id and never consults those roots, so a vault outside `~` works in full; only writing a *document* into such a folder is out of reach, and since `document_dir()` is itself an allowed root, that only affects a vault placed outside the default location.
- **Creating vs. opening**: `create_vault_dirs` builds the tree, once, from `addVault`. `ensure_vault_dirs`, called on every `getDb()`, deliberately does *not* create — SQLite would happily put a fresh empty database into a recreated folder, so a vault on an unplugged drive would come back empty instead of as an error.
- **Not there vs. not allowed**: `directory_state()` separates the two, because `is_dir()` collapses them. On macOS a folder under `~/Documents`, `~/Desktop` or iCloud is readable only after the user grants access (TCC), and since the app is not sandboxed, picking it in a dialog grants nothing. `probe_vault_dir` reports that as `denied`, and the vault modal says "no access" ("allow it") rather than "not found" ("look elsewhere").
- **The `.db` path**: `getDb()` opens the database by vault id (`Database.load(vaultId)`); Rust resolves `{vaultDir}/emerald.db` through the registry. The webview never names the file. `getActiveDbFile()` exists only for SQL that has to spell a path (`VACUUM INTO`, `ATTACH`).
- **Where a new vault defaults to**: `new_vault_base_dir` returns `{documentDir}/Emerald Vaults` (or `{appDataDir}/vaults` without a documents folder), and the vault modal — like the `add-vault` backup import, via `newVaultTarget`/`probeNewVaultTarget` — joins the vault's name onto it. Deliberately not `default_dir_for`/`default_vault_dir`: that is the migration target and must keep pointing at `{appDataDir}/vaults/{id}`, an id-named folder that can never collide.
- **Folder names**: `vaultFolderName()` strips separators, `..` and the Windows-reserved characters, and suffixes reserved device names. The device check runs on the stem before the first dot (`CON.txt` is caught like `CON`) and includes `CONIN$`/`CONOUT$`. The result is capped at 200 UTF-8 bytes without splitting a character: ext4 and APFS limit a path component in bytes, NTFS in UTF-16 units, and an emoji name crosses the byte limit long before the character limit.
- **Opening and relocating go through the `.db` file, not the folder.** A folder dialog lists no files, so nothing shows whether a folder holds a vault; a dialog filtered to `.db` does. The vault's directory is the file's parent. Choosing a file inside a TCC-protected folder does not grant access to *list* it, so the same `denied` case applies.

### Adopting a previous identifier's data

Tauri derives `app_data_dir()`/`app_config_dir()` from the app's `identifier`, `com.emerald.app`; installations up to v0.1.3.6 used `com.emerald.magical-journal` (see [`build.md`](../build.md#product-name-vs-identifier)), so their data sits in another directory.

`adopt_previous_identifier_dirs` (`src-tauri/src/vault.rs`) copies the old directory's contents across, once, on first start:

- **Copies, never moves.** The previous installation is only read, so it keeps working as a fallback.
- **Only its own artifacts** (`is_own_data`) — `vaults.json`, `images/`, `vaults/`, and anything named `emerald*` (flat legacy `.db` files, their `-journal` sidecars, `.pre-vNN.bak` backups). Never the whole directory: on Linux `app_data_dir` is also the WebView profile (`dirs::data_local_dir()` and `data_dir()` are the same there), holding that install's cookies and `localStorage`.
- **All-or-nothing per run.** Each entry is written next to its final name and made visible by a same-directory `rename`. If any entry fails, everything this run placed is rolled back and the next start tries again.
- **Gated on "does the target already hold anything of ours"** (`holds_no_data_yet`), not on emptiness — on Linux the WebView profile is already there, and `desktop.ini`/`.DS_Store` can appear on Windows and macOS.
- **Rewrites the copied `vaults.json`'s absolute paths** from the old root to the new one, for vaults that live under `{appDataDir}/vaults/{id}` (see [Migrating an older installation](#migrating-an-older-installation)), following the path-safety rule in [`security.md`](../security.md#vault-directories-as-a-trust-boundary).
- **A dev build** (`.dev` identifier suffix) adopts from the previous dev directory, never from production.
- **Never aborts startup.** A failed adoption is logged; the data is untouched and can be fixed by hand.

**It runs before there is a window, as a Tauri plugin's own `setup`** (`tauri::plugin::Builder::new("emerald-adopt")` in `lib.rs`), not in the app's `setup` block (see [Loading Screen and Boot Order](shell.md#loading-screen-and-boot-order)). Tauri builds the configured windows *before* the app's `setup` hook, and the first window creates the WebView profile under `LocalData/{identifier}` on Windows and Linux. A plugin `setup` runs inside `Builder::build()`, ahead of every window, so the adoption sees its target before the WebView occupies it, and the copy blocks no window thread. It covers both `app_data_dir` and `app_config_dir`, which differ on Linux.

### Migrating an older installation

Before per-vault directories, vaults were flat files — `emerald.db` and `emerald-{uuid}.db` side by side in the app directory, sharing one `images/` folder. Two steps convert them:

1. **`migrate_vault_layout`**, triggered from `loadVaultsFile()` for a record that carries `dbName` instead of `path`. It moves the database into `{appDataDir}/vaults/{id}/` and returns the directory. Not a SQL migration — the file moves before anything opens it. Idempotent; `vaults.json` is rewritten only once the move succeeded. The two legacy locations differ by platform: `tauri-plugin-sql` joined onto **`app_config_dir`**, the image pool onto **`app_data_dir`**. Windows and macOS resolve both to one directory; on Linux they are `~/.config/…` and `~/.local/share/…`, so both are searched.
2. **Migration v35 `vault_scoped_images`**, once the database is open. It copies the referenced images out of the shared pool (`adopt_legacy_images`) and rewrites every absolute path down to its filename, in the `html` and `plain` columns of `IMAGE_FIELDS_V48`, not the `legacy` ones. If a copy fails the rewrite still happens — the handler's legacy fallback keeps the image visible; the reverse would lose it.

## Vault Settings

Settings are **per vault**, in the vault's `settings.json`; a new vault starts with factory defaults. How settings travel in a backup is in [`database.md` → DB Backup / Restore](../database.md#db-backup--restore-emeralddb); the settings-page building blocks are in [`components.md`](../components.md).

- **`lib/vaultSettings.ts`** defines `VaultSettings` as independent groups (`appearance`, `trash`, `leftList`, `emojis`, `images`, `tags`, `templates`, `editor`, `journal`, `backup`) and `normalizeVaultSettings()`, which turns any JSON (the file, a backup) into a trusted value: unknown keys are kept for newer builds, invalid values fall back to their default.
- **`editor`** is what `RichEditor` formats on its own, read once when an editor is created: `Typography` is left out when off, `enableInputRules`/`enablePasteRules` narrow to what stays on, and `Link` loses `autolink`, `linkOnPaste` and its paste rule. **`journal.moonPhase`** decides whether journal entries show their (computed) moon phase — in the list, exports and link chips.
- **`backup`** is the automatic backup: `auto`, `interval` (`daily`/`weekly`/`monthly`), `weekday` and `keep` (`null` = all). The target folder is deliberately *not* part of it — see [Automatic Backup](#automatic-backup).
- **`store/settingsStore.ts`** holds the open vault's settings and is the only writer of `settings.json`. `loadForVault(vaultId)` runs **before** `getDb()` opens the database, because migration v39 needs the language that `applyAppearance()` writes into the boot mirror. An unreadable file falls back to defaults but with trash retention "never", so a purge nobody chose cannot run. `clear()` resets to defaults whenever no vault is open. Writes are serialized (`lib/serialize.ts`).
- **Rust side**: `read_vault_settings`/`write_vault_settings` in `src-tauri/src/vault.rs` move the file's *text* only; the frontend owns the JSON shape. Atomic write (temp file + rename) and symlink handling: see [`security.md`](../security.md#vault-json-files).
- **The `localStorage` boot mirror** (`APPEARANCE_MIRROR_KEYS` in `vaultSettings.ts`: `app-language`, `theme-id`, `ui-font-id`, `editor-font-id`, `ui-scale`, `editor-font-size`) is what `index.html`'s inline boot script and `main.tsx` read before any vault is open. `applyAppearance()` writes it as a side effect; once a vault has loaded, its settings are the source of truth.
- **Backups carry the settings** in a separate `settings` field of the `.emeralddb` payload, not gated by `BACKUP_VERSION` since it is not a content shape. See [`database.md` → DB Backup / Restore](../database.md#db-backup--restore-emeralddb).

## Automatic Backup

There is no background service: a backup can only run while the app is open and the vault unlocked.

- **`lib/autoBackup.ts`** — `startAutoBackup()` is started once by `AppShell`. It checks a few seconds after a vault's settings load (`settingsStore` is the trigger, so the start itself is not slowed), after every change of the `backup` group, and hourly for sessions that stay open across midnight. `isBackupDue(settings, newest, today)` works on local calendar days: due means no backup exists since the last scheduled day, so a missed one is caught up and a vault without any backup gets one at once.
- **The run** (`runAutoBackup`) skips silently unless the active vault is unlocked, its settings are the loaded ones, no import is running (`editorSavesSuspended`) and no other run is under way. It drains pending writes, builds the full payload with `buildBackup(FULL_BACKUP_OPTIONS)` from `lib/dbBackup.ts` (every module, the Trash, settings — loaded dynamically so `dbBackup` stays out of the main chunk), checks that the vault is still the same, and hands the JSON to `write_auto_backup`.
- **`src-tauri/src/auto_backup.rs`** owns everything about *where*: the target folder (the vault's `backup/`, or the folder picked through its own dialog and kept in `{appDataDir}/auto-backup.json`), the file name `emerald-auto-{vault id prefix}-{YYYY-MM-DD}.emeralddb` — one file per day, a second run replaces it — and pruning down to `keep`. "Last backup" is read from the newest such file in the folder; no timestamp is stored that could disagree with it. The trust reasoning is in [`security.md`](../security.md#automatic-backups).
- **`store/autoBackupStore.ts`** holds the status, whether a run is under way, and the last failure as a code (`dirMissing`, `failed`). The Backup settings page shows it; the settings gear in the rail carries a dot until the failure has been seen.

List view preferences (sort, grouping, collapsed groups) are not settings: they are kept per vault in `localStorage` by `store/vaultPrefs.ts`, so a click on "Sort" is not a file write.
