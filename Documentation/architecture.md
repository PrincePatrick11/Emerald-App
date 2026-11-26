# Architecture

Emerald is a desktop app built on Tauri v2 (Rust backend) and React 19 (TypeScript frontend). The two sides communicate through Tauri's IPC bridge: the frontend calls Rust commands via `invoke()`, and Rust emits events the frontend subscribes to.

This file is the overview: tech stack, module map, data flow and the IPC surface. The patterns behind individual areas each have their own file:

| File | Covers |
|---|---|
| [`architecture/modules.md`](architecture/modules.md) | Module registry, entry store, store selectors, categories, tags, moon phase, lexicon |
| [`architecture/editing.md`](architecture/editing.md) | Edit mode, Cancel, leaving an edit, moving to another module, auto-save, sidebar action bar, internal links |
| [`architecture/blocks.md`](architecture/blocks.md) | Content blocks: stored format, fields, sigils, user-built blocks |
| [`architecture/editors.md`](architecture/editors.md) | Editors shared across modules: the text editor, its host and features; the canvas editor, the Canvas and Altar blocks |
| [`architecture/templates.md`](architecture/templates.md) | Templates: start and default templates, insertion |
| [`architecture/navigation.md`](architecture/navigation.md) | Global search, drag and drop, tabs, navigation history, left sidebar |
| [`architecture/storage.md`](architecture/storage.md) | Image storage, vault layout, vault settings |
| [`architecture/encryption.md`](architecture/encryption.md) | Vault keys, sealed files, the SQL layer, the unlock gate, re-encryption, encrypted backups |
| [`architecture/appearance.md`](architecture/appearance.md) | Theming and fonts |
| [`architecture/shell.md`](architecture/shell.md) | Window chrome, boot order, PDF export |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x |
| UI framework | React 19 + TypeScript |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 3 |
| Rich text editor | TipTap v2 |
| State management | Zustand |
| Database | SQLite encrypted with SQLCipher, through an own SQL layer (`db.rs`, sqlx) |
| Encryption | XChaCha20-Poly1305, Argon2id, OS keychain (`keyring`) |
| Internationalisation | react-i18next |
| Icons | lucide-react |
| UI motion / drag reordering | framer-motion |
| Date formatting | date-fns |
| Markdown parsing | marked |
| Markdown serialisation | turndown |
| HTML sanitisation | DOMPurify |

## Module Map

Where things live. What the shared building blocks do and when to use them is in [`components.md`](components.md); how an area works is in the `architecture/*.md` file named in the table above.

```
src/
├── App.tsx, main.tsx          root; mounts AppShell and EditContextMenu
├── components/
│   ├── layout/
│   │   ├── AppShell, MainArea, TabBar          app frame, view router, tabs
│   │   ├── LeftSidebarRail, LeftSidebarEntryList   rail and entry list
│   │   ├── RightSidebar                        properties panels, edit action bar
│   │   ├── LeaveGuardModal, VaultPicker        leave-an-edit question, vault picker (start view)
│   │   ├── VaultKeyDialog, BackupUnlockDialog, RecoveryKeyBox, vaultKeyParts   password, unlock, recovery key
│   │   ├── moduleViews.ts                      ViewId → lazy view (MainArea only)
│   │   ├── PickerRows, PickerServerPanel, PickerStorePanel  the start page's vault rows and the sync/store placeholders
│   │   ├── export/                             the export menu (ExportMenuModal), its entry checklist and the database options
│   │   ├── import/                             the import window (ImportModal) and its part for a database file (useVaultImport)
│   │   ├── start/                              the start page's brand, language, sections, Appearance, automatic backup, version and updates
│   │   ├── settings/                           SettingsModal, one *Page per tab, sections
│   │   └── titlebar/                           custom title bar, menus, SearchModal
│   ├── editors/
│   │   └── text/     TextEditor, its host (toolbar, link picker, drops), TipTap extensions
│   ├── blocks/       BlockStack, block views, fields, sigil, canvas and painting blocks, block editor
│   ├── images/       picture tile, picker, add and edit dialogs, the strip below a canvas
│   ├── views/        one view per module and aux view (Dashboard … Trash)
│   ├── sidebar/
│   │   ├── panels/   the entry properties panel
│   │   └── fields/   sidebar sections, property rows, tags, links
│   ├── templates/    template page, default template, insertion, pickers
│   ├── lexicon/      LanguagePage, vocabulary/alphabet tables, TranslatePanel
│   └── ui/           shared component layer (see components.md)
├── store/
│   ├── entryStore.ts            all entries, one list
│   ├── taskStore.ts, tagStore.ts, categoryStore.ts
│   ├── dashboardStore.ts, dashboardActions.ts, dashboardSettingsStore.ts, entryViews.ts   dashboards; where an entry opens
│   ├── blockDefinitionStore.ts  user-built blocks
│   ├── blockSessionStore.ts     BlockStack ↔ sidebar block manager bridge
│   ├── templateStore.ts, templateApply.ts   templates; applying one
│   ├── lexiconStore.ts          languages and their words
│   ├── draftStore.ts            unsaved block/template page drafts
│   ├── autoBackupStore.ts       the automatic backup's setting and what it did last, per vault
│   ├── entryEdit.ts             entry baselines for Cancel
│   ├── leaveGuardStore.ts       edit guards, "save / discard / keep editing"
│   ├── uiStore.ts               tabs, active view, panels
│   ├── sessionStore.ts          per-view search/filter state (session only)
│   ├── vaultPrefs.ts            per-vault list and layout preferences
│   ├── settingsStore.ts         the open vault's settings.json
│   ├── vaultStore.ts, trashStore.ts, undoStore.ts, saveNoticeStore.ts
│   ├── vaultKeyStore.ts         the unlock gate (`ensureVaultReady`)
│   ├── backupSecretStore.ts     asks for a `.emerald` file's password, or its vault's password or recovery key
│   ├── importWindowStore.ts     the import window's open state and the paths of a drop
│   ├── exportMenuStore.ts       the export menu's open request, with the entry or template on screen
│   ├── imageStore.ts            "Images": rows, files, places of use; `takeIn`, `discardRenders`
│   ├── imagePickerStore.ts      `pickPictures`, the picture picker's open request
│   ├── imageNoticeStore.ts      "image not inserted" notice
│   └── moduleWiring.ts          per-module reload, trash wiring, startup reload
├── hooks/
│   ├── useEntryEditor.ts        auto-save, Cancel
│   ├── useEditActions.ts        registers Done/Cancel/Delete in the sidebar
│   ├── useDraftPage.ts          draft lifecycle of block/template pages
│   ├── useGlobalSearch.ts, useDeepLink.ts, useLinkItems.ts
│   ├── useNewFormRequest.ts     a collection view opens its own "New" when the rail's plus asks
│   ├── useOutsideClick.ts, useCloseOnKeepEditing.ts, useHorizontalWheel.ts
│   ├── useMouseNavigation.ts    mouse back/forward buttons, browser keys, ⌘[ / ⌘] on macOS
│   ├── useCollapsedSet.ts, usePersistedFlag.ts, usePointerReorder.ts
│   ├── useOpenInNewTabAction.tsx, useSaveAsTemplateAction.tsx
│   ├── useVaultPictures.ts, useFileDrop.ts   the pictures of "Images"; files dropped from the disk
│   ├── useImportDrop.ts         import files dragged into the window open the import window
│   └── useShrunkIcon.ts, useEmojiSearchData.ts
├── lib/
│   ├── sqlite.ts                the SQL interface over the `db_*` commands
│   ├── db.ts                    connection, schema check on open (`openVaultDb`), migration steps above the fresh start
│   ├── vaultKeys.ts             wrappers for the key commands in `keys.rs`
│   ├── schema.ts                live DDL, builtin/starter seed
│   ├── row.ts                   SQLite row ↔ TypeScript type conversion
│   ├── serialize.ts             per-entity write serialization
│   ├── modules.ts               module registry
│   ├── blocks/                  block format, types, fields, sigils, canvas, painting, definitions, templates;
│   │                            a block as a row (`blockRows.ts`), its references (`blockRefs.ts`, asked of each type: the interfaces in `blockType.ts`, the types in `kinds/`, the registry in `blockTypes.ts`, the toolkit in `toolkit.ts`), positions (`position.ts`), an imported block pointed at this vault (`blockRemap.ts`), the values blocks deliver (`blockValue.ts`)
│   ├── blockStore.ts            blocks as rows: loading, writing only what changed, replacing a whole stack
│   ├── entryTitle.ts, dashboards.ts, moonPhase.ts
│   ├── categories.ts
│   ├── tagRefs.ts, templateTags.ts, templateRows.ts, blockDefinitionRows.ts, icons.ts
│   ├── lexicon.ts, lexiconRows.ts
│   ├── links.ts, linkItems.ts, internalLinkHtml.ts
│   ├── tabs.ts                  tab ids, navigation history helpers
│   ├── openEdits.ts             resolve open edits before closing everything
│   ├── editorLock.ts            suspends editor saves during imports
│   ├── globalSearch.ts, searchText.ts
│   ├── dragChannel.ts, dragState.ts, imageDragState.ts
│   ├── images.ts, imageLimits.ts, shrinkImage.ts
│   ├── storeImage.ts            a file from the disk or a Blob into `images/`
│   ├── imageUsage.ts            where each picture is used, and in which role (`block_refs`)
│   ├── pictureExport.ts         a rendered picture saved where the user chooses
│   ├── export.ts, exportData.ts, emeraldFormat.ts   Markdown and PDF export (one entry or several), the article PDF and HTML share; `.emerald` files of entries and templates
│   ├── htmlExport.ts            the interactive HTML export: one self-contained file with its own stylesheet, script and CSP
│   ├── exportFonts.ts           the fonts of PDF and HTML: the app's (embedded from `fonts.css` as data URLs) and common system ones
│   ├── exportMenu.ts            the export menu's rules: remembered choices, Normal's fixed settings, period, collection, order
│   ├── importFile.ts, importPaths.ts   the import window's files: which it takes, opening one to see what it is, what it remembers
│   ├── emerald/                 `manifest.ts` (the manifest, pure), `file.ts` (the `.emerald` commands, asking for a secret)
│   ├── dbBackup.ts, importStaging.ts   a vault's content as `.vault.emerald`: export and restore, a raw backup's content read from its database
│   ├── autoBackup.ts            automatic backup: the start page's setting and status (the schedule is Rust's)
│   ├── vaultManager.ts, vaultSettings.ts
│   ├── altarBackground.ts, altarIcon.ts   the app's own altar backgrounds; the Altar block's icon
│   ├── menuActions.ts, platform.ts, updates.ts, splash.ts
│   ├── formatDate.ts, sortItems.ts, groupBy.ts, viewMode.ts
│   ├── helpers.ts, stamp.ts, reveal.ts, motion.ts, styleClasses.ts
│   └── emojiSearch.ts, emojiSearchData/   emoji picker sets and search data
├── fonts.css           generated @font-face rules (`npm run fonts`)
├── index.css           Tailwind layers and app styles
├── themes/             emerald-noctis.css, emerald-parchment.css, theme.ts
├── i18n/               react-i18next setup + locales/{en,de,es,fr}.json
└── types/index.ts      shared TypeScript interfaces

src-tauri/src/
├── main.rs             entry point, delegates to lib.rs
├── lib.rs              command registration, path guards, native menu
├── db.rs               SQLCipher pools, `db_*` commands, SQL authorizer
├── crypto.rs           sealed-file format, subkeys, keyed hash
├── keys.rs             vault.key, unlocking, OS keychain, `VaultKeys`
├── reencrypt.rs        changing the password, recovery, crash recovery
├── emerald_file.rs     .emerald and .vault.emerald files (content and raw backups): header, archive, limits, their commands
├── emerald_seal.rs     the sealed body of a .emerald file: chunked XChaCha20-Poly1305, streamed
├── raw_backup.rs       raw backups: a vault's files packed as they lie, the open database by VACUUM INTO
├── auto_backup.rs      automatic backup: setting, schedule, target folder, file name, pruning
├── images.rs           image commands + emerald-img scheme
├── vault.rs            vault registry and vault directory commands
├── updates.rs          in-app updater
├── devbridge.rs, devbridge.js   dev only (cargo feature `devbridge`): lets the MCP server drive the app on macOS and Linux
└── pdf_export/         native-webview PDF export
    ├── mod.rs          per-platform re-export
    └── windows.rs, macos.rs, linux.rs

tools/agents/           review agents for a coding assistant, see agents.md
tools/mcp/              MCP server that drives a running instance, see mcp.md
```

Only `en` ships in the start bundle; de/es/fr load on demand through `changeAppLanguage` — always use that instead of `i18n.changeLanguage`.

## Data Flow

```
SQLite (emerald.db)
    ↓  opened after unlocking (openVaultDb → runMigrations), read on startup (getDb)
    ↓  fromRow.* (row.ts)
Zustand stores (in-memory)
    ↓  React subscriptions
Components (render)
    ↓  user edits
Store actions (updateEntry, updateTask, …)
    ↓  toInt (row.ts)
    ↓  db.execute / db.select / db.batch  (src/lib/sqlite.ts → db_* commands in db.rs)
SQLite (persisted)
```

Stores are the single source of truth for in-memory state. Components never query SQLite directly. All SQL happens inside store action functions in `src/store/*.ts`.

`src/lib/row.ts` sits on both edges of that flow and is the only place that translates between SQLite rows and the types in `src/types`. SQLite has neither booleans nor arrays — booleans arrive as `0`/`1`, arrays as JSON text — and converting per store lets the same field hold a number in one code path and a boolean in another.

The schema itself lives in `src/lib/schema.ts`, not in `db.ts`: fresh vaults execute that DDL directly; a vault from before the fresh start of the schema (or from a newer app) is refused unchanged, and later schema changes reach existing vaults through the steps of `MIGRATIONS`. `npm run check:schema` checks the fresh vault, the refusals and each step against a vault of the version before. See [`database.md`](database.md) for the details.

### Startup loading and lazy data

`AppShell` calls `reloadAllStores()` (`src/store/moduleWiring.ts`) on mount and again on every vault switch — see [Module Registry](architecture/modules.md#module-registry) for the sequence. Views do **not** refetch on mount; a view that mounts before the startup fetch resolves renders its empty state until the store fills.

One detail of what the stores load: **sigil drawings are files, not columns.** A drawing's rendered image is a file referenced from the `<img src>` of a paint block or of the sigil's drawing part, next to its vector strokes as block data (see [Editors](architecture/editors.md#canvas-editor)), so the entry rows stay small. `entryBlockSummary(...).effects` gives what the blocks do to the entry (the lock of a loaded sigil); what the info line of lists shows comes from the blocks themselves (`listInfo`, see [Blocks](architecture/blocks.md#registry-and-interfaces)) — for a sigil, its target date.

### Store write serialization

Every content-store update method (`updateEntry`, `updateTask`/`toggleComplete`, `updateTag`, `updateTemplate`, `updateDefinition`, the lexicon's updates) reads a snapshot from the store, merges the patch into it, and writes the row back — the whole row, except that `updateEntry` writes `content` only when the patch carries it (it is by far the largest column). Two overlapping updates to the same entity — an autosave while the sidebar changes a property — would race, and the later one would overwrite the other's fields with a stale snapshot.

`src/lib/serialize.ts` closes that race. `serialized(serialKey(domain, id), task)` chains same-key tasks strictly one after another, so a merge-and-write always runs against the previous one's result. The invariant: **any store method that writes back a whole row from a snapshot must run its write through `serialized()`, keyed per entity id.** `serialKey` types the domains (`entry`/`task`/`tag`/`blockDefinition`/`template`/`language`/`image`); `templateStore` and `lexiconStore` use one store-wide key (`'*'`); creating an entry runs under `ENTRY_NUMBER_KEY` as well, since it hands out a number. `taskStore.toggleComplete` queues each affected descendant under its own `task:<id>` key, so a concurrent `updateTask` on a child can't have its `completed` columns rewound by the parent's cascade (or vice versa).

Deliberately not serialized, with a comment at its definition: `updateCategory` (writes only the columns passed in, no snapshot merge).

A serialized task must never await another task under its own key — it would wait on itself — and the chain carries no timeout, so a task that never settles occupies its key permanently. `drainSerialized()` resolves once every currently-queued chain has settled. `vaultStore.openActiveVault`, `dbBackup.importDatabase` (all modes) and `resolveOpenEdits` (`lib/openEdits.ts`) await it before swapping the database underneath the stores: the editor lock ([`editing.md`](architecture/editing.md#auto-save-the-useentryeditor-hook)) only stops *future* saves, so writes already in flight must finish first. `autoBackup.runAutoBackup` awaits it too, though it only reads: a write still queued would otherwise be missing from the payload.

### Code splitting

`MainArea` loads every view with `React.lazy` via `VIEW_COMPONENTS` in `moduleViews.ts`, so TipTap (the largest chunk) only loads when an editor view first opens. `SettingsModal` is lazy for the same reason (it pulls in `dbBackup`). `menuActions.runMenuAction` imports the import modules (`emeraldFormat.ts` — and with it `marked` —, `export.ts` for its error message) with `await import()` per action, the export menu is lazy (and brings `dbBackup.ts` along); it loads `emeraldFormat.ts` for the linked-entry list or a `.emerald`, and `export.ts`, `htmlExport.ts`, `exportData.ts` (and `turndown`) only when it writes, and `src/i18n/index.ts` ships only `en` eagerly. `vite.config.ts` deliberately has **no catch-all vendor chunk** — a blanket `return "vendor"` would pull the lazy libraries back into the eager bundle.

## IPC Command Surface

All Rust commands are *registered* in `src-tauri/src/lib.rs` and invoked from TypeScript with `invoke()`; most are *defined* in `db.rs`, `keys.rs`, `reencrypt.rs`, `emerald_file.rs`, `auto_backup.rs`, `images.rs`, `vault.rs` and `updates.rs`.

**File commands run off the main thread.** `write_file`, `read_file`, `export_image`, `ensure_app_storage_dirs`, `write_emerald_file`, `read_emerald_file`, `store_emerald_files` and all six commands in `images.rs` are `async` and wrap their `std::fs` work in `tauri::async_runtime::spawn_blocking`, so a large export or import doesn't block the window. `async fn` alone would not do: the blocking call would still run on a runtime worker and could starve the SQL pools, PDF export and IPC replies on a machine with few cores. The `emerald-img` scheme handler uses `spawn_blocking` as well. The four native-menu commands stay synchronous on purpose — they mutate `NSMenu`, which is main-thread-only on macOS.

- A static `IMAGE_WRITE_LOCK` in `images.rs` serializes the image folder's writes and deletes; without it, a storage cleanup could delete a file whose hash a concurrent `save_image` had just judged "already exists".
- `resolve_allowed_roots()` caches its result in a `OnceLock` once every root canonicalizes, and re-resolves on every call while any root fails (a not-yet-existing directory, an unmounted drive), so a transient failure heals on the next call.

| Command | Purpose |
|---|---|
| `db_load(vault_id, file)` / `db_close(db)` | Open / close the pool of one of the vault's databases (`file` is `main` or `importStaging`, never a path). `db_load` returns the handle the other two take and refuses a vault without `vault.key`. See [`architecture/encryption.md`](architecture/encryption.md#the-sql-layer). |
| `db_execute(db, query, values)` / `db_select(db, query, values)` | Run a statement on a pool / read rows. `execute` returns `(rowsAffected, lastInsertId)`. Every connection carries an authorizer that refuses key and export pragmas. |
| `db_batch(db, statements)` | Run several `(query, values)` statements as one transaction on one connection — all or none — and return the rows affected in all. `Database.batch` in `sqlite.ts`. |
| `vault_key_status(vault_id)` | `{hasDatabase, encrypted, unlocked}`; first finishes an interrupted re-encryption. The unlock gate's first question. |
| `vault_create_key` / `vault_unlock` / `vault_unlock_remembered` / `vault_lock` | Create a new vault's key, unlock with the password, unlock from the OS keychain, forget the key held in memory. |
| `vault_change_password` / `vault_recover` | Change the password, or set a new one from the recovery key; both build a copy under a new key and return the new recovery key. See [Re-encrypting a vault](architecture/encryption.md#re-encrypting-a-vault). |
| `vault_set_remembered` / `vault_is_remembered` / `keychain_available` | The "remember on this device" switch, its state, and whether the system has a keychain. |
| `auto_backup_settings()` / `set_auto_backup_settings(vaults, interval, weekday, keep)` | The automatic backup's setting in `{appDataDir}/auto-backup.json`: which vaults, how often, how many kept, the picked folder. Setting it wakes the schedule. |
| `auto_backup_status(vault_ids)` / `pick_auto_backup_dir()` / `reset_auto_backup_dir()` / `back_up_vault_now(vault_id)` | Per vault its target folder, newest backup, running flag and last failure / native folder dialog, opened in Rust / back to each vault's `backups/` / today's raw backup of one vault now. The schedule itself runs in Rust and emits `auto-backup-changed`; no path crosses IPC — see [`security.md`](security.md#automatic-backups). |
| `pick_import_file(filter_name)` | The import window's open dialog, opened in Rust; the picked file — like one dragged in — is the one `read_emerald_file` / `read_file` may read outside the user's folders — see [`security.md`](security.md#the-file-chosen-for-the-import). |
| `save_image(data_url, vault_id)` | Decode a data-URL, write it into the vault's `images/` — sealed and named by a keyed hash in an encrypted vault. Skips if it exists. Returns the **filename**. |
| `copy_image_file(source, vault_id)` | Copy a file from an arbitrary path into the vault's `images/` under its content name. png/jpg/jpeg/gif/webp/svg only; rejects symlinks, canonicalizes the source and confines it to the allowed storage roots. Returns the filename. |
| `read_image_as_base64(filename, vault_id)` | A stored image, opened if sealed, as a data-URL — only for the PDF export (renders in a `file://` webview), a picture the `.emerald` export compresses; everything else uses the `emerald-img` scheme. |
| `read_image_file(source)` | An *external* image file as a data-URL, without storing it, so the frontend can scale it to the vault's image limits before `save_image`. Same checks as `copy_image_file` (`checked_image_source`), plus a 64 MB source cap. |
| `read_vault_drafts(vault_id)` / `write_vault_drafts(vault_id, contents)` | The vault's `drafts.json` — unsaved drafts of block and template pages (`store/draftStore.ts`), sealed in an encrypted vault. An empty object removes the file. `async`, since it is written after every pause in typing; a rename or remove that fails is retried briefly, since on Windows a scanner or sync client may hold the file. |
| `read_vault_settings(vault_id)` / `write_vault_settings(vault_id, contents)` | The vault's `settings.json` — see [Vault Settings](architecture/storage.md#vault-settings) and [`security.md`](security.md#vault-json-files) for atomicity and symlink handling. |
| `list_image_files(vault_id)` / `delete_image_files(vault_id, filenames)` | Back the *Unused images* cleanup. Confined to the vault's folder; reject any name that is not 64 hex digits plus a known extension. |
| `save_icon(data_url, vault_id)` / `read_icon_as_base64(filename, vault_id)` / `list_icon_files(vault_id)` / `delete_icon_files(vault_id, filenames)` | The same four for the vault's `icons/` (uploaded icons, already 128px; `save_icon` refuses a data URL above 2 MB). Sealed under the icons' own context; shown through `emerald-img` under `/{vaultId}/icons/{name}`. See [Icons](database.md#icons). |
| `register_vaults(vaults)` | Mirror `vaults.json` into the `id → path` registry every storage command resolves against. |
| `create_vault_dirs(vault_id)` / `ensure_vault_dirs(vault_id)` / `discard_new_vault_dirs(vault_id, remove_root)` | Build a new vault's tree (answers whether it made the vault folder itself) / verify an existing one before its database opens / take the empty tree back when the import into a new vault is cancelled at the password (plain `remove_dir`, the folder only if this attempt made it and it is empty). `ensure_vault_dirs` does not create the vault directory — see [Vault Layout](architecture/storage.md#vault-layout). |
| `default_vault_dir(vault_id)` / `probe_vault_dir(path)` | The location a vault gets when the user picks none / what a chosen folder already contains. |
| `new_vault_base_dir()` | Where new vaults are offered: `{documentDir}/Emerald Vaults`, else `{appDataDir}/vaults`. |
| `delete_vault_files(vault_id)` | Removes only the vault's own artefacts by name, never `remove_dir_all`; returns whether the vault folder is gone, so the UI can say "the folder stayed". What it deletes: [`security.md`](security.md#vault-directories-as-a-trust-boundary). |
| `discard_import_staging(vault_id)` | Removes a backup import's staging copy (`emerald.db.import` plus `-journal`/`-wal`/`-shm`). Run before and after every import; a missing file is not an error. See [DB Backup / Restore](database.md#db-backup--restore-vaultemerald). |
| `ensure_export_dir(vault_id)` | The vault's `export/` folder, every export's default destination; created on demand, refused outside the allowed storage roots and, inside the app data directory, outside `vaults/` — wherever the write command would refuse the export afterwards. |
| `export_image(path, data_url)` | Write a data-URL's image bytes to a user-chosen `.png`/`.jpg`/`.jpeg`/`.webp`/`.svg` path. Same path checks as `write_file`. |
| `write_emerald_file(vault_id, path, kind, manifest, images, icons, protection)` | Write a `.emerald` (`kind` `items`) or `.vault.emerald` (`vault`) from the frontend's manifest and the vault's pictures and icons, streamed into `{path}.part` and renamed into place; `protection` is `none`, an own `password` or the `vaultKey`. Same path checks as `write_file`. See [The `.emerald` file](architecture/editing.md#the-emerald-file). |
| `read_emerald_file(path, password?, recovery_key?)` | Open a `.emerald` within the limits of its kind and return `{ticket, kind, manifest, protected}` (a raw backup: also its `settings`); the pictures stay in the file. `EMERALD_LOCKED` / `EMERALD_VAULT_LOCKED` while a secret is missing. Same path checks as `read_file`. |
| `open_raw_backup_db(ticket, vault_id)` / `discard_raw_backup_db(vault_id)` | Unpack an opened raw backup's database beside the vault (`emerald.db.raw`) and open it under the backup's own key, returning a handle for `db_select` / close and remove it. See [Raw backups](database.md#raw-backups). |
| `store_emerald_files(ticket, vault_id)` / `close_emerald_file(ticket)` | Store an opened file's pictures and icons in the vault, once the import really starts; returns name in the file → name stored here / forget an opened file. Tickets live in Rust (`EmeraldTickets`, at most four). |
| `write_file(path, content)` | Write UTF-8 text to a user-selected `.md`/`.html`/`.json`/`.txt` path. Rejects symlinks; the path must resolve within the allowed storage roots, and inside the app data directory only `vaults.json` and `vaults/` are writable (see [Path Confinement](security.md#path-confinement)). |
| `read_file(path)` | Read a file as UTF-8. Same confinement as `write_file`, except that a `.md` may also be the file chosen for the import, wherever it lies (see [`security.md`](security.md#the-file-chosen-for-the-import)); `.md`/`.json`/`.txt` only (not `.html`). |
| `ensure_app_storage_dirs()` | Create the app data and config directories before vault metadata is written or SQLite opens. |
| `export_pdf(html, path, page_size?)` | Render HTML to a PDF at a path the frontend obtained from the `dialog` plugin, by driving the app's own webview. The page is A4 on every system; `page_size` (inches) overrides it on Windows only; the frontend passes none at present. See [PDF Export](architecture/shell.md#pdf-export). |
| `close_request_seen()` | The frontend's acknowledgement of a close request — see [Closing the window](architecture/shell.md#closing-the-window). |
| `update_menu_labels(...)` | Translate the native menu's labels. macOS only in effect — see [Window Chrome](architecture/shell.md#window-chrome). |
| `set_dock_icon(png?)` | Show a custom theme's Dock icon, or with none the one the app started with. Lasts while the app runs. macOS only in effect. |
| `set_view_menu_checked(rail, left_list, right_sidebar, view_locked)` | Mirror sidebar visibility and the view lock onto the View menu's check items, on every change (not only menu-triggered ones). macOS only in effect. |
| `update_settings()` / `set_update_settings(endpoint, auto_check)` | Read/write `{appDataDir}/update.json`, an installation-level setting like the automatic backup's `auto-backup.json`; the endpoint must be a complete `https` URL. See [`security.md` → In-App Updates](security.md#in-app-updates). |
| `check_for_update()` / `install_update()` | Reach the network for updates — `tauri-plugin-updater`, driven from `updates.rs` rather than the plugin's JS API so the CSP needs no update host. `install_update` installs only the result `check_for_update` holds, then restarts. See [`security.md` → In-App Updates](security.md#in-app-updates). |

Tauri menu events (not `invoke`) come from the native menu and are received in `AppShell` via `listen()`; the two `navigate-*` events at the end come from Rust's mouse hooks instead and are received in `useMouseNavigation`. On Windows and Linux there is no native menu — the HTML title-bar menus call the same actions directly through `src/lib/menuActions.ts`, so both run one implementation:

| Event ID | Trigger |
|---|---|
| `toggle-rail` | View > Navigation Rail |
| `toggle-left-list` | View > Entry List |
| `toggle-right-sidebar` | View > Properties |
| `reset-sidebar-widths` | View > Reset View — resets the entry-list and right-sidebar widths **and** brings back a hidden rail, entry list and right sidebar (`uiStore.showAllPanels`; with the rail hidden, Settings and the start page would otherwise be unreachable) |
| `toggle-view-lock` | View > Lock View — while on (`uiStore.viewLocked`, kept in localStorage), `AppShell` renders no resize handle on either sidebar; hiding and showing them and Reset View still work |
| `show-splash` | View > Show Loading Screen |
| `navigate-back` | Mouse back, from Rust rather than a menu: macOS NSEvent monitor; on Windows mouse software's `WM_APPCOMMAND`, via `install_app_command_hook`. A raw button press on Windows and Linux never becomes this event — the page reads it directly, see [Navigation History](architecture/navigation.md#navigation-history) |
| `navigate-forward` | Mouse forward button (same) |

Only `reset-sidebar-widths` is emitted from the frontend as well — the HTML menu re-emits it so `AppShell`'s listener handles it identically on both platforms; the other menu actions run directly through `runMenuAction`.

The three sidebar toggles, `toggle-view-lock`, `show-splash` and `switch-vault` are handled at the very top of `runMenuAction`, above its guard against running without an open vault or over the vault picker: none touches a database, and the loading screen should be viewable in the picker too. For the four check items there is a second reason: muda (Tauri's menu crate) flips a native check item's tick *itself* before emitting the event, and falling through to the guard would leave macOS showing a tick with no state behind it, which the visibility-keyed sync effect would never correct.
