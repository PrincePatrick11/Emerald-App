# Images, Vaults and Settings

## Image Storage System

Images are content-addressed, stored outside SQLite, and belong to one vault.

- **Location**: `{vaultDir}/images/{hash}.{ext}` — see [Vault Layout](#vault-layout). The hash is a keyed hash of the image bytes, and the file is sealed ([`encryption.md`](encryption.md#sealed-files)); the name is 64 hex digits either way.
- **What the database stores**: the bare filename, no directory or drive letter. That is what makes a vault folder copyable to another machine.
- **Insert path**: `save_image` (data-URL) and `copy_image_file` (a file on disk) decode, hash, seal, write into the active vault's folder if absent, and return the filename. Both are reached through `src/lib/images.ts`, never invoked directly.
- **Display path**: the `emerald-img` URI scheme. `imageSrc(filename)` builds `emerald-img://localhost/{vaultId}/{filename}` — on Windows `http://emerald-img.localhost/{vaultId}/{filename}`, since WebView2 serves custom schemes over `http` — and the webview fetches the bytes itself: no IPC round trip, no base64, no in-memory cache. The handler opens the sealed file before answering. See [`security.md`](../security.md#the-emerald-img-uri-scheme).
- **Caching**: the handler answers with `Cache-Control: no-store`, so decrypted images do not land in the WebView's disk cache, in the clear and outside the vault. The filename is the content's keyed hash, so a name never returns anything else — the cache would be safe, but not private.
- **Canvas access**: the Canvas, Altar and sigil drawing blocks render their picture on a canvas and read it back, which fails once anything foreign is drawn on it — and custom-scheme images are foreign. That path uses `canvasImageSrc()`, which fetches the bytes as a data-URL (one IPC round trip per image, only when a picture is rendered). The handler's `Access-Control-Allow-Origin: *` is not relied on: wry registers the scheme as secure but not CORS-enabled, whether WebKitGTK and WKWebView honour the header for it is unverified, and a failure would be a silently empty export.
- **Deduplication**: per vault. The same image in two vaults is two files — isolation is worth more than the bytes.
- **Cleanup**: Settings → Storage → *Unused images*, on demand. `findUnusedImages()` diffs `list_image_files` (the vault's own folder) against `collectUsedImageFilenames(db)`, and `findUnusedIcons()` (`lib/icons.ts`) `list_icon_files` against `collectUsedIconFilenames(db)`; a file an open template or block draft names stays (`fileNamesHeldByDrafts` in `draftStore.ts`). Deliberately not automatic: an image that so far exists only in an unsaved editor buffer would count as unused. The check is safe because folder and used-set come from the same vault.
## Vault Layout

A vault is a directory holding:

- `emerald.db` — the SQLCipher database
- `vault.key` — the vault key, wrapped by the password and by the recovery key, see [`encryption.md`](encryption.md#keys)
- `images/` — sealed image files
- `icons/` — sealed uploaded icons, 128px, named and sealed like the images but never listed in "Images" ([Icons](../database.md#icons))
- `backups/` — where the export dialog opens and where automatic backups go unless another folder was picked. Nothing that deletes, replaces or backs up the vault touches it: deleting a vault's files leaves it (and the folder with it, if it holds anything), an import's Replace swaps rows only, and a raw backup packs named files, never this folder
- `settings.json` — the vault's settings, see [Vault Settings](#vault-settings); the only file in the folder that is not encrypted
- `drafts.json` — only while a block or template page holds unsaved edits; sealed
- `emerald.db.import` — transient: a backup import `VACUUM INTO`s a working copy here while it fills and checks it, then removes it whether the import succeeds or fails. A copy left by a crash is cleared before the next import (`discard_import_staging`, see [DB Backup / Restore](../database.md#db-backup--restore-vaultemerald)).
- `emerald.db.raw` — transient: the database of a raw backup being imported, unpacked and read under the backup's own key, removed as soon as its content is read (`discard_raw_backup_db`).
- `emerald.db.snapshot` — transient: the consistent copy of the open database a raw backup packs, removed once it is in the file.
- `vault.key.pending`, `emerald.db.reencrypting`, `images.reencrypting/`, `icons.reencrypting/`, `drafts.json.reencrypting`, `vault.reencrypting` — transient: a re-encryption builds its copy here and swaps it in; `vault_key_status` finishes or discards what a crash left, see [Re-encrypting a vault](encryption.md#re-encrypting-a-vault).

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

A fresh installation starts with an **empty** vault list: no `vaults.json` means a first start, and a list the user emptied stays empty. `readVaultsFile()` keeps only records with a `path`; one that still names a flat database file (`dbName`, from before per-vault directories) is left out and its file is not touched. `getActiveVaultPath()` throws `NO_ACTIVE_VAULT` rather than falling back to `vaults[0]`, which would open a different vault under the wrong id. `AppShell` gates on membership (`hasActiveVault`, not list length — `switchVault` rolls `activeVaultId` back to `''` on a failed open) and until then mounts only the title bar and the vault picker (the start page), since anything else would call `getDb()`.

- **`vaultManager.ts`** owns that file and is its only writer. Every write calls `register_vaults`, which mirrors `id → path` into Rust state.
- **Commands take a vault id, never a path.** `vault_dir()` resolves the id against the registry. A path handed in over IPC, or read out of stored content, is not evidence that the user authorised it.
- **`resolve_allowed_roots()`** deliberately leaves the registered directories out — see [`security.md`](../security.md#vault-directories-as-a-trust-boundary). Vault storage resolves by id and never consults those roots, so a vault outside `~` works in full; only writing a *document* into such a folder is out of reach, and since `document_dir()` is itself an allowed root, that only affects a vault placed outside the default location.
- **Creating vs. opening**: `create_vault_dirs` builds the tree, once, from `addVault`. `ensure_vault_dirs`, called before a vault's database is loaded (`openVaultDb`), deliberately does *not* create — SQLite would happily put a fresh empty database into a recreated folder, so a vault on an unplugged drive would come back empty instead of as an error.
- **Not there vs. not allowed**: `directory_state()` separates the two, because `is_dir()` collapses them. On macOS a folder under `~/Documents`, `~/Desktop` or iCloud is readable only after the user grants access (TCC), and since the app is not sandboxed, picking it in a dialog grants nothing. `probe_vault_dir` reports that as `denied`, and the vault picker says "no access" ("allow it") rather than "not found" ("look elsewhere").
- **The `.db` path**: `openVaultDb()` opens the database by vault id (`Database.load(vaultId)`); Rust resolves `{vaultDir}/emerald.db` through the registry. The webview never names the file. `getActiveDbFile()` exists only for SQL that has to spell a path (`VACUUM INTO`, `ATTACH`).
- **Where a new vault defaults to**: `new_vault_base_dir` returns `{documentDir}/Emerald Vaults` (or `{appDataDir}/vaults` without a documents folder), and the vault picker — like the `add-vault` backup import, via `newVaultTarget`/`probeNewVaultTarget` — joins the vault's name onto it. Deliberately not `default_dir_for`/`default_vault_dir`: that is the location for a vault created without a choice and must keep pointing at `{appDataDir}/vaults/{id}`, an id-named folder that can never collide.
- **Folder names**: `vaultFolderName()` strips separators, `..` and the Windows-reserved characters, and suffixes reserved device names. The device check runs on the stem before the first dot (`CON.txt` is caught like `CON`) and includes `CONIN$`/`CONOUT$`. The result is capped at 200 UTF-8 bytes without splitting a character: ext4 and APFS limit a path component in bytes, NTFS in UTF-16 units, and an emoji name crosses the byte limit long before the character limit.
- **Opening and relocating go through the `.db` file, not the folder.** A folder dialog lists no files, so nothing shows whether a folder holds a vault; a dialog filtered to `.db` does. The vault's directory is the file's parent. Choosing a file inside a TCC-protected folder does not grant access to *list* it, so the same `denied` case applies.

### Adopting a previous identifier's data

Tauri derives `app_data_dir()`/`app_config_dir()` from the app's `identifier`, `com.emerald.app`; installations up to v0.1.3.6 used `com.emerald.magical-journal` (see [`build.md`](../build.md#product-name-vs-identifier)), so their data sits in another directory.

`adopt_previous_identifier_dirs` (`src-tauri/src/vault.rs`) copies the old directory's contents across, once, on first start:

- **Copies, never moves.** The previous installation is only read, so it keeps working as a fallback.
- **Only its own artifacts** (`is_own_data`) — `vaults.json`, `images/`, `vaults/`, and anything named `emerald*` (flat legacy `.db` files, their `-journal` sidecars, `.pre-vNN.bak` backups). Never the whole directory: on Linux `app_data_dir` is also the WebView profile (`dirs::data_local_dir()` and `data_dir()` are the same there), holding that install's cookies and `localStorage`.
- **All-or-nothing per run.** Each entry is written next to its final name and made visible by a same-directory `rename`. If any entry fails, everything this run placed is rolled back and the next start tries again.
- **Gated on "does the target already hold anything of ours"** (`holds_no_data_yet`), not on emptiness — on Linux the WebView profile is already there, and `desktop.ini`/`.DS_Store` can appear on Windows and macOS.
- **Rewrites the copied `vaults.json`'s absolute paths** from the old root to the new one, for vaults that live under `{appDataDir}/vaults/{id}`, following the path-safety rule in [`security.md`](../security.md#vault-directories-as-a-trust-boundary).
- **A dev build** (`.dev` identifier suffix) adopts from the previous dev directory, never from production.
- **Never aborts startup.** A failed adoption is logged; the data is untouched and can be fixed by hand.

**It runs before there is a window, as a Tauri plugin's own `setup`** (`tauri::plugin::Builder::new("emerald-adopt")` in `lib.rs`), not in the app's `setup` block (see [Loading Screen and Boot Order](shell.md#loading-screen-and-boot-order)). Tauri builds the configured windows *before* the app's `setup` hook, and the first window creates the WebView profile under `LocalData/{identifier}` on Windows and Linux. A plugin `setup` runs inside `Builder::build()`, ahead of every window, so the adoption sees its target before the WebView occupies it, and the copy blocks no window thread. It covers both `app_data_dir` and `app_config_dir`, which differ on Linux.

## Vault Settings

Settings are **per vault**, in the vault's `settings.json`; a new vault starts with factory defaults. How settings travel in a backup is in [`database.md` → DB Backup / Restore](../database.md#db-backup--restore-vaultemerald); the settings-page building blocks are in [`components.md`](../components.md).

- **`lib/vaultSettings.ts`** defines `VaultSettings` as independent groups (`appearance`, `trash`, `leftList`, `emojis`, `images`, `tags`, `templates`, `editor`, `journal`) and `normalizeVaultSettings()`, which turns any JSON (the file, a backup) into a trusted value: unknown keys are kept for newer builds, invalid values fall back to their default.
- **`editor`** is what `TextEditor` formats on its own, read once when an editor is created: `Typography` is left out when off, `enableInputRules`/`enablePasteRules` narrow to what stays on, and `Link` loses `autolink`, `linkOnPaste` and its paste rule. **`journal.moonPhase`** decides whether journal entries show their (computed) moon phase — in the list, exports and link chips.
- **`images`** is how inserted images are stored, all in `prepareImageDataUrl` (`lib/imageLimits.ts`), the one step every image passes before `save_image`: the editor (paste, image button, `/` menu, file drops), image fields, covers, the canvas blocks and `.emerald` imports. Icons do not: an uploaded icon is brought down to 128px and stored in `icons/` by `save_icon` (`saveIcon` in `lib/icons.ts`), whatever the limits. Backups and sigil drawings do not pass it. `optimizePhotos` (on by default) stores a PNG of 512 KB or more as a JPEG at quality 0.92 and full size when it is a photo: no transparent pixel anywhere (checked at full resolution, so narrow rounded corners count), and fewer than half of neighbouring pixels exactly alike (`lib/photoCheck.ts`; an app screenshot measured 0.92, a phone photo 0.22). Photos copied to the clipboard arrive as PNG; a 12-megapixel one went from 11.1 MB to 2.4 MB. A misjudged photo with a plain background stays PNG, the safe side. `maxEdge` scales down and `maxSizeMb` rejects what is still too large; scaling and the change of format happen in one pass. The photo step runs in a worker (`lib/photoWorker.ts`, `OffscreenCanvas`), the data URL decoded there too, since decoding and encoding a phone photo hold up the page's thread in WebKit. Where the worker cannot do the work (no worker, no `OffscreenCanvas` with a 2D context), the same runs on the page; where the image itself fails, it is kept as it is rather than tried again on the page. A file dropped from the explorer is copied as it is only when nothing could change it (`needsPreparing`), or when it is too large to read in and the vault sets no limits.
- **`store/settingsStore.ts`** holds the open vault's settings and is the only writer of `settings.json`. `loadForVault(vaultId)` runs after the unlock gate has checked the database (`openVaultDb`) and **before** the first `getDb()`, whose purge of the trash needs the vault's retention period. An unreadable file falls back to defaults but with trash retention "never", so a purge nobody chose cannot run. `clear()` resets to defaults whenever no vault is open. Writes are serialized (`lib/serialize.ts`).
- **Rust side**: `read_vault_settings`/`write_vault_settings` in `src-tauri/src/vault.rs` move the file's *text* only; the frontend owns the JSON shape. Atomic write (temp file + rename) and symlink handling: see [`security.md`](../security.md#vault-json-files).
- **The `localStorage` boot mirror** (`APPEARANCE_MIRROR_KEYS` in `vaultSettings.ts`: `ui-font-id`, `editor-font-id`, `ui-scale`, `editor-font-size`) is what `main.tsx` reads before any vault is open. `applyAppearance()` writes it as a side effect; once a vault has loaded, its settings are the source of truth.
- **Language and theme are not vault settings** (see [Device Settings](#device-settings)). A `settings.json` written before still holds `appearance.language`, `appearance.theme` and `appearance.customThemes`; `normalizeVaultSettings` keeps them as unknown keys, and nothing reads them.
- **Backups carry the settings** in the `settings` field of the vault content a `.vault.emerald` carries, beside `data`; a raw backup carries the vault's `settings.json` as a file of its own, since they are independent of every content filter. See [`database.md` → DB Backup / Restore](../database.md#db-backup--restore-vaultemerald).

## Device Settings

What belongs to the installation rather than to a vault — the language, the theme and the custom themes — is `{appDataDir}/device.json`, beside `vaults.json` and `update.json`. It is there before any vault is unlocked, so the start page and the loading screen already show it, and no vault or backup brings it along.

- **`lib/deviceSettings.ts`** defines `DeviceSettings` and `normalizeDeviceSettings()`; **`store/deviceStore.ts`** applies them the moment they change and writes the file (serialized), through `read_device_settings`/`write_device_settings` in `src-tauri/src/vault.rs`, which move the text only, like the vault's settings.
- **The boot mirror** (`DEVICE_MIRROR_KEYS`: `app-language`, `theme-id`, `custom-themes`) is what `index.html`'s inline script and `main.tsx` read for the first frame; the store keeps it in step.
- **The first start with `device.json`** takes the values from that mirror, which holds what the last open vault applied. With no mirror at all, the first vault opened lends the language and theme its `settings.json` still holds (`adoptFromVault`). The vault's file keeps them; they are only no longer read.
- **A backup's custom themes** (from before they moved here) join the installation's list on import, up to the cap; its language and theme selection do not apply.

## Automatic Backup

The automatic backup belongs to the installation and is set on the start page (`StartAutoBackup`): which vaults, one interval (with its weekday), one retention and one folder for all of them. As long as the app runs it backs up every chosen vault on schedule — whichever vault is open, also a locked one, also while only the start page is shown. There is no background service: with the app closed nothing runs, and a day missed meanwhile is made up at the next start.

- **`src-tauri/src/auto_backup.rs`** holds the setting in `{appDataDir}/auto-backup.json` (`vaults`, `interval`, `weekday`, `keep`, `dir`) and runs the schedule: a task started with the app (`auto_backup::start`) looks 20 seconds after the start — the frontend registers the vaults first —, then every hour, and a few seconds after every change of the setting. Due means no backup of the vault exists since the last scheduled local day, so a vault without any backup gets one at once. A vault that changed while it was copied, or meets a password change, is tried again a minute later; one whose password change was cut short (`reencrypt::interrupted`) is not backed up at all until it has been opened once and the change finished — its row says so. **Back up now** (`back_up_vault_now`) is the same run forced, waiting up to half a minute for one that is under way.
- **Where to**: the folder picked through the module's own dialog, or else each vault's own `backups/` folder (created on demand, never the vault folder above it). The file name is `emerald-auto-{vault id prefix}-{YYYY-MM-DD}.vault.emerald` — one file per day, a second run replaces it — and pruning down to `keep` deletes only such names of that vault. "Last backup" is read from the newest such file; no timestamp is stored that could disagree with it. Removing a vault takes it out of the setting (`vaultStore.removeVault`). The trust reasoning is in [`security.md`](../security.md#automatic-backups).
- **What is written** is a raw backup (`raw_backup.rs`, the format in [`encryption.md`](encryption.md#raw-backups)): the vault's files as they lie on the disk. An unlocked vault's database is copied with `VACUUM INTO` on a connection of its own — one consistent state while the app goes on writing (a write waits for that read lock, up to the pools' 60 s busy timeout); a locked one is packed as it lies and checked afterwards for a change. A raw backup and a password change or the deletion of a vault's files never overlap (`reencrypt::RUNNING`).
- **`lib/autoBackup.ts`** reads and writes the setting and follows the status: `startAutoBackup()`, started once by `AppShell`, refreshes it on the event `auto-backup-changed` that Rust sends whenever a run starts or ends, and whenever the list of vaults changes. **`store/autoBackupStore.ts`** holds setting, per-vault status (folder, newest, running, last failure as `dirMissing`, `vaultMissing`, `interrupted` or `failed`) and whether the failure was seen: the start page button in the rail carries a dot until then, and opens the page at the backup section.

List view preferences (sort, grouping, collapsed groups) are not settings: they are kept per vault in `localStorage` by `store/vaultPrefs.ts`, so a click on "Sort" is not a file write.
