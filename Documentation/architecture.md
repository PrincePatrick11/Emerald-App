# Architecture

Emerald is a desktop app built on Tauri v2 (Rust backend) and React 19 (TypeScript frontend). The two sides communicate through Tauri's IPC bridge: the frontend calls Rust commands via `invoke()`, and Rust emits events the frontend subscribes to.

This file is the overview: tech stack, module map, data flow and the IPC surface. The patterns behind individual areas each have their own file:

| File | Covers |
|---|---|
| [`architecture/modules.md`](architecture/modules.md) | Module registry, entry store, store selectors, categories, tags, moon phase, lexicon |
| [`architecture/editing.md`](architecture/editing.md) | Edit mode, Cancel, leaving an edit, type change, auto-save, sidebar action bar, internal links |
| [`architecture/blocks.md`](architecture/blocks.md) | Content blocks: stored format, fields, sigils, user-built blocks |
| [`architecture/templates.md`](architecture/templates.md) | Templates: assignments, defaults, insertion |
| [`architecture/navigation.md`](architecture/navigation.md) | Global search, drag and drop, tabs, navigation history, left sidebar |
| [`architecture/altar.md`](architecture/altar.md) | Altar UI composition |
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
│   │   ├── LeaveGuardModal, VaultModal         leave-an-edit question, vault manager
│   │   ├── VaultKeyDialog, BackupUnlockDialog, RecoveryKeyBox, vaultKeyParts   password, unlock, recovery key
│   │   ├── moduleViews.ts                      ViewId → lazy view (MainArea only)
│   │   ├── settings/                           SettingsModal, one *Page per tab, sections
│   │   └── titlebar/                           custom title bar, menus, SearchModal
│   ├── editor/       RichEditor and its TipTap extensions, toolbar, link picker, TagInput
│   ├── blocks/       BlockStack, block views, fields/sigil blocks, block editor
│   ├── views/        one view per module and aux view (Home … Trash)
│   ├── sidebar/
│   │   ├── panels/   Journal/Wiki/Operation properties panels, AltarSidebarPanel
│   │   └── fields/   sidebar sections, property rows, tags, links, type toggle
│   ├── templates/    template page, assignments modal, insertion, pickers
│   ├── lexicon/      LanguagePage, vocabulary/alphabet tables, TranslatePanel
│   ├── altar/        canvas, cards, library strip/section, item modal
│   └── ui/           shared component layer (see components.md)
├── store/
│   ├── entryStore.ts            Journal, Wiki and Operations entries
│   ├── taskStore.ts, altarStore.ts, tagStore.ts, categoryStore.ts
│   ├── blockDefinitionStore.ts  user-built blocks
│   ├── blockCopies.ts           updating/removing copies of a block
│   ├── blockSessionStore.ts     BlockStack ↔ sidebar block manager bridge
│   ├── templateStore.ts, templateApply.ts   templates; applying one
│   ├── lexiconStore.ts          languages and their words
│   ├── draftStore.ts            unsaved block/template page drafts
│   ├── autoBackupStore.ts       what the automatic backup did last
│   ├── altarEdit.ts             altar snapshot for Cancel
│   ├── entryEdit.ts             entry baselines for Cancel, carried across a type change
│   ├── leaveGuardStore.ts       edit guards, "save / discard / keep editing"
│   ├── uiStore.ts               tabs, active view, panels
│   ├── sessionStore.ts          per-view search/filter state (session only)
│   ├── vaultPrefs.ts            per-vault list and layout preferences
│   ├── settingsStore.ts         the open vault's settings.json
│   ├── vaultStore.ts, trashStore.ts, undoStore.ts, importStore.ts
│   ├── vaultKeyStore.ts         the unlock gate (`ensureVaultReady`)
│   ├── backupSecretStore.ts     asks for an encrypted backup's password
│   ├── imageNoticeStore.ts      "image not inserted" notice
│   └── moduleWiring.ts          per-module reload, trash wiring, startup reload
├── hooks/
│   ├── useEntryEditor.ts        auto-save, Cancel
│   ├── useEditActions.ts        registers Done/Cancel/Delete in the sidebar
│   ├── useDraftPage.ts          draft lifecycle of block/template pages
│   ├── useGlobalSearch.ts, useDeepLink.ts, useLinkItems.ts
│   ├── useOutsideClick.ts, useCloseOnKeepEditing.ts
│   ├── useCollapsedSet.ts, usePersistedFlag.ts, usePointerReorder.ts
│   ├── useOpenInNewTabAction.tsx, useSaveAsTemplateAction.tsx
│   └── useDisplayedAltar.ts, useShrunkIcon.ts, useEmojiSearchData.ts
├── lib/
│   ├── sqlite.ts                the SQL interface over the `db_*` commands
│   ├── db.ts                    connection and migration chain
│   ├── vaultKeys.ts             wrappers for the key commands in `keys.rs`
│   ├── schema.ts                live DDL, builtin/starter seed
│   ├── row.ts                   SQLite row ↔ TypeScript type conversion
│   ├── serialize.ts             per-entity write serialization
│   ├── normalizeSchema.ts, dbRebuild.ts, schemaV37.ts, schemaV48.ts   table rebuilds
│   ├── unifyEntries.ts, tagsById.ts, nullableCategory.ts, mergeCategoryTables.ts,
│   │   migrate*.ts               individual migrations, shared with importers
│   ├── modules.ts               module registry
│   ├── blocks/                  block format, types, fields, sigils, definitions, templates
│   ├── entryTitle.ts, entryTypeChange.ts, moonPhase.ts
│   ├── categories.ts, categoryMerge.ts
│   ├── tagRefs.ts, templateTags.ts, templateRows.ts, blockDefinitionRows.ts
│   ├── lexicon.ts, lexiconRows.ts
│   ├── links.ts, linkItems.ts, internalLinkHtml.ts
│   ├── tabs.ts                  tab ids, navigation history helpers
│   ├── openEdits.ts             resolve open edits before closing everything
│   ├── editorLock.ts            suspends editor saves during imports
│   ├── globalSearch.ts, searchText.ts
│   ├── dragChannel.ts, dragState.ts, altarDragState.ts
│   ├── images.ts, imageLimits.ts, shrinkImage.ts, thumbnail.ts
│   ├── export.ts, exportData.ts, emeraldFormat.ts, altarExport.ts
│   ├── dbBackup.ts, importStaging.ts   .emeralddb backup and restore
│   ├── autoBackup.ts            automatic backup: when one is due, the run
│   ├── vaultManager.ts, vaultSettings.ts
│   ├── altarConstants.ts        altar sizes, backgrounds, candle check
│   ├── altarSettings.ts         an altar's `settings` JSON
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
├── reencrypt.rs        encrypting a vault, changing the password, crash recovery
├── backup.rs           encrypted .emeralddb files
├── auto_backup.rs      automatic backups: target folder, file name, pruning
├── images.rs           image commands + emerald-img scheme
├── vault.rs            vault registry and vault directory commands
├── updates.rs          in-app updater
└── pdf_export/         native-webview PDF export
    ├── mod.rs          per-platform re-export
    └── windows.rs, macos.rs, linux.rs
```

Only `en` ships in the start bundle; de/es/fr load on demand through `changeAppLanguage` — always use that instead of `i18n.changeLanguage`.

## Data Flow

```
SQLite (emerald.db)
    ↓  read on startup (getDb + runMigrations)
    ↓  fromRow.* (row.ts)
Zustand stores (in-memory)
    ↓  React subscriptions
Components (render)
    ↓  user edits
Store actions (updateEntry, updateTask, …)
    ↓  toInt / toJson (row.ts)
    ↓  db.execute / db.select / db.batch  (src/lib/sqlite.ts → db_* commands in db.rs)
SQLite (persisted)
```

Stores are the single source of truth for in-memory state. Components never query SQLite directly. All SQL happens inside store action functions in `src/store/*.ts`.

`src/lib/row.ts` sits on both edges of that flow and is the only place that translates between SQLite rows and the types in `src/types`. SQLite has neither booleans nor arrays — booleans arrive as `0`/`1`, arrays as JSON text — and converting per store lets the same field hold a number in one code path and a boolean in another.

The schema itself lives in `src/lib/schema.ts`, not in `db.ts`: fresh vaults execute that DDL directly, existing ones reach the same shape through the migration chain and the rebuild in `normalizeSchema.ts`. `npm run check:schema` builds a vault each way and compares them. See [`database.md`](database.md) for the details.

### Startup loading and lazy data

`AppShell` calls `reloadAllStores()` (`src/store/moduleWiring.ts`) on mount and again on every vault switch — see [Module Registry](architecture/modules.md#module-registry) for the sequence. Views do **not** refetch on mount; a view that mounts before the startup fetch resolves renders its empty state until the store fills.

Two details of what the stores load:

- **Sigil drawings are files, not columns.** A drawing is an image file referenced from the canvas block's `<img src>`, so the entry rows stay small. `entryBlockSummary(...).sigil` resolves the first visible, unconcealed drawing (`image`) and the target date; the Operations dashboard shows only the target date, in row and card alike.
- **`altar_placements` load in one query.** `fetchAltars` selects the whole table once (`LIVE_PLACEMENTS`, joined to the live `altar_items` so placements of trashed elements stay hidden) and groups rows by `altar_id` in JS (`mapPlacementRows`).

### Store write serialization

Every content-store update method (`updateEntry`, `updateTask`/`toggleComplete`, `updateTag`, `updateTemplate`, `updateDefinition`, `updateAltar`/`updateAltarGrid`/`updateAltarResolution`, `updateItem`, `updatePlacement`, the lexicon's updates) reads a snapshot from the store, merges the patch into it, and writes the row back — the whole row, except that `updateEntry` writes `content` only when the patch carries it (it is by far the largest column). Two overlapping updates to the same entity — an autosave while the sidebar changes a property, an altar's thumbnail save overlapping a title save — would race, and the later one would overwrite the other's fields with a stale snapshot.

`src/lib/serialize.ts` closes that race. `serialized(serialKey(domain, id), task)` chains same-key tasks strictly one after another, so a merge-and-write always runs against the previous one's result. The invariant: **any store method that writes back a whole row from a snapshot must run its write through `serialized()`, keyed per entity id.** `serialKey` types the domains (`entry`/`task`/`tag`/`altar`/`altarItem`/`placement`/`blockDefinition`/`template`/`language`); `templateStore` and `lexiconStore` use one store-wide key (`'*'`). `taskStore.toggleComplete` queues each affected descendant under its own `task:<id>` key, so a concurrent `updateTask` on a child can't have its `completed` columns rewound by the parent's cascade (or vice versa).

Deliberately not serialized, each with a comment at its definition: `bumpAltarUpdatedAt` (writes only `updated_at`) and `updateCategory` (writes only the columns passed in, no snapshot merge).

A serialized task must never await another task under its own key — it would wait on itself — and the chain carries no timeout, so a task that never settles occupies its key permanently. `drainSerialized()` resolves once every currently-queued chain has settled. `vaultStore.openActiveVault`, `dbBackup.importDatabase` (all modes) and `resolveOpenEdits` (`lib/openEdits.ts`) await it before swapping the database underneath the stores: the editor lock ([`editing.md`](architecture/editing.md#auto-save-the-useentryeditor-hook)) only stops *future* saves, so writes already in flight must finish first.

### Code splitting

`MainArea` loads every view with `React.lazy` via `VIEW_COMPONENTS` in `moduleViews.ts`, so TipTap (the largest chunk) only loads when an editor view first opens. `SettingsModal` is lazy for the same reason (it pulls in `dbBackup`). `menuActions.runMenuAction` imports the export/import modules (`export.ts`, `exportData.ts`, `emeraldFormat.ts`, `altarExport.ts` — and with them `turndown` and `marked`) with `await import()` per action, and `src/i18n/index.ts` ships only `en` eagerly. `vite.config.ts` deliberately has **no catch-all vendor chunk** — a blanket `return "vendor"` would pull the lazy libraries back into the eager bundle.

## IPC Command Surface

All Rust commands are *registered* in `src-tauri/src/lib.rs` and invoked from TypeScript with `invoke()`; most are *defined* in `db.rs`, `keys.rs`, `reencrypt.rs`, `backup.rs`, `auto_backup.rs`, `images.rs`, `vault.rs` and `updates.rs`.

**File commands run off the main thread.** `write_file`, `read_file`, `export_image`, `ensure_app_storage_dirs` and all seven commands in `images.rs` are `async` and wrap their `std::fs` work in `tauri::async_runtime::spawn_blocking`, so a multi-megabyte `.emeralddb` doesn't block the window. `async fn` alone would not do: the blocking call would still run on a runtime worker and could starve the SQL pools, PDF export and IPC replies on a machine with few cores. The `emerald-img` scheme handler uses `spawn_blocking` as well. The four native-menu commands stay synchronous on purpose — they mutate `NSMenu`, which is main-thread-only on macOS.

- A static `IMAGE_WRITE_LOCK` in `images.rs` serializes the image folder's writes and deletes; without it, a storage cleanup could delete a file whose hash a concurrent `save_image` had just judged "already exists".
- `resolve_allowed_roots()` caches its result in a `OnceLock` once every root canonicalizes, and re-resolves on every call while any root fails (a not-yet-existing directory, an unmounted drive), so a transient failure heals on the next call.

| Command | Purpose |
|---|---|
| `db_load(vault_id, file)` / `db_close(db)` | Open / close the pool of one of the vault's databases (`file` is `main` or `importStaging`, never a path). `db_load` returns the handle the other two take and refuses a vault without `vault.key`. See [`architecture/encryption.md`](architecture/encryption.md#the-sql-layer). |
| `db_execute(db, query, values)` / `db_select(db, query, values)` | Run a statement on a pool / read rows. `execute` returns `(rowsAffected, lastInsertId)`. Every connection carries an authorizer that refuses key and export pragmas. |
| `db_batch(db, statements)` | Run several `(query, values)` statements as one transaction on one connection — all or none — and return the rows affected in all. `Database.batch` in `sqlite.ts`. |
| `vault_key_status(vault_id)` | `{hasDatabase, encrypted, unlocked}`; first finishes an interrupted re-encryption. The unlock gate's first question. |
| `vault_create_key` / `vault_unlock` / `vault_unlock_remembered` / `vault_lock` | Create a new vault's key, unlock with the password, unlock from the OS keychain, forget the key held in memory. |
| `vault_encrypt_existing` / `vault_change_password` / `vault_recover` | Re-encrypt a plain vault, change the password, or set a new one from the recovery key; all three build a copy under a new key and return the new recovery key. See [Re-encrypting a vault](architecture/encryption.md#re-encrypting-a-vault). |
| `vault_set_remembered` / `vault_is_remembered` / `keychain_available` | The "remember on this device" switch, its state, and whether the system has a keychain. |
| `write_backup_file(vault_id, path, content)` / `read_backup_file(path, password?, recovery_key?)` | Write a `.emeralddb` sealed under the vault key / open one with an unlocked vault's key, a password or a recovery key (`BACKUP_LOCKED` when none fits). |
| `auto_backup_status(vault_id)` / `pick_auto_backup_dir(vault_id)` / `reset_auto_backup_dir(vault_id)` / `write_auto_backup(vault_id, content, keep?)` | The automatic backup: target folder and newest backup / native folder dialog, opened in Rust / back to the vault's `backup/` / write today's sealed backup and prune beyond `keep`. No path crosses IPC — see [`security.md`](security.md#automatic-backups). |
| `save_image(data_url, vault_id)` | Decode a data-URL, write it into the vault's `images/` — sealed and named by a keyed hash in an encrypted vault. Skips if it exists. Returns the **filename**. |
| `copy_image_file(source, vault_id)` | Copy a file from an arbitrary path into the vault's `images/` under its content name. png/jpg/jpeg/gif/webp/svg only; rejects symlinks, canonicalizes the source and confines it to the allowed storage roots. Returns the filename. |
| `read_image_as_base64(filename, vault_id)` | A stored image, opened if sealed, as a data-URL — only for the PDF export (renders in a `file://` webview) and the backup writer (embeds bytes in JSON); everything else uses the `emerald-img` scheme. |
| `read_image_file(source)` | An *external* image file as a data-URL, without storing it, so the frontend can scale it to the vault's image limits before `save_image`. Same checks as `copy_image_file` (`checked_image_source`), plus a 64 MB source cap. |
| `read_vault_drafts(vault_id)` / `write_vault_drafts(vault_id, contents)` | The vault's `drafts.json` — unsaved drafts of block and template pages (`store/draftStore.ts`), sealed in an encrypted vault. An empty object removes the file. `async`, since it is written after every pause in typing; a rename or remove that fails is retried briefly, since on Windows a scanner or sync client may hold the file. |
| `read_vault_settings(vault_id)` / `write_vault_settings(vault_id, contents)` | The vault's `settings.json` — see [Vault Settings](architecture/storage.md#vault-settings) and [`security.md`](security.md#vault-json-files) for atomicity and symlink handling. |
| `adopt_legacy_images(vault_id, filenames)` | Copy images from the pre-per-vault shared pool into a vault's own folder. Migration v35 only. |
| `list_image_files(vault_id)` / `delete_image_files(vault_id, filenames)` | Back the *Unused images* cleanup. Confined to the vault's folder; reject any name that is not 64 hex digits plus a known extension. |
| `register_vaults(vaults)` | Mirror `vaults.json` into the `id → path` registry every storage command resolves against. |
| `create_vault_dirs(vault_id)` / `ensure_vault_dirs(vault_id)` | Build a new vault's tree / verify an existing one before its database opens. `ensure_vault_dirs` does not create the vault directory — see [Vault Layout](architecture/storage.md#vault-layout). |
| `default_vault_dir(vault_id)` / `probe_vault_dir(path)` | The location a vault gets when the user picks none / what a chosen folder already contains. |
| `new_vault_base_dir()` | Where new vaults are offered: `{documentDir}/Emerald Vaults`, else `{appDataDir}/vaults`. |
| `legacy_default_db_exists()` | Whether an `emerald.db` from before `vaults.json` sits in `app_config_dir`, `app_data_dir` or the migration target — a genuine first start vs. an installation with data on disk. |
| `migrate_vault_layout(vault_id, legacy_db_name)` | Move a pre-per-vault flat database into its own directory. Returns that directory. |
| `delete_vault_files(vault_id)` | Removes only the vault's own artefacts by name, never `remove_dir_all`; returns whether the vault folder is gone, so the UI can say "the folder stayed". What it deletes: [`security.md`](security.md#vault-directories-as-a-trust-boundary). |
| `discard_import_staging(vault_id)` | Removes a backup import's staging copy (`emerald.db.import` plus `-journal`/`-wal`/`-shm`). Run before and after every import; a missing file is not an error. See [DB Backup / Restore](database.md#db-backup--restore-emeralddb). |
| `prune_migration_backups(vault_id)` | Deletes every migration backup but the newest (written by `backupDatabaseFile` in `dbRebuild.ts`; name rule in [`security.md`](security.md#vault-directories-as-a-trust-boundary)). Returns the count. Called by `getDb()` after `runMigrations`; failure is only logged. |
| `ensure_backup_dir(vault_id)` | The vault's `backup/` folder, the database export's default destination; recreated on demand, refused outside the allowed storage roots. |
| `export_image(path, data_url)` | Write a data-URL's image bytes to a user-chosen `.png`/`.jpg`/`.jpeg`/`.webp` path. Same path checks as `write_file`. |
| `write_file(path, content)` | Write UTF-8 text to a user-selected `.md`/`.emerald`/`.json`/`.txt` path. Rejects symlinks; the path must resolve within the allowed storage roots, and inside the app data directory only `vaults.json` and `vaults/` are writable (see [Path Confinement](security.md#path-confinement)). |
| `read_file(path)` | Read a file as UTF-8. Same allowlist and confinement as `write_file`. |
| `ensure_app_storage_dirs()` | Create the app data and config directories before vault metadata is written or SQLite opens. |
| `export_pdf(html, path, page_size?)` | Render HTML to a PDF at a path the frontend obtained from the `dialog` plugin, by driving the app's own webview. `page_size` (inches) overrides the default Letter page — used by the Altar export only. See [PDF Export](architecture/shell.md#pdf-export). |
| `close_request_seen()` | The frontend's acknowledgement of a close request — see [Closing the window](architecture/shell.md#closing-the-window). |
| `update_menu_labels(...)` | Translate the native menu's labels. macOS only in effect — see [Window Chrome](architecture/shell.md#window-chrome). |
| `set_view_menu_checked(rail, left_list, right_sidebar)` | Mirror sidebar visibility onto the View menu's check items, on every change (not only menu-triggered ones). macOS only in effect. |
| `set_export_menu_enabled(entry, pdf, emerald)` | Enable/disable the native "Export as …" items for the current view (`computeMenuEnabledState`). macOS only in effect. |
| `set_altar_export_menu_enabled(enabled)` | Enable/disable the native "Export as Image" submenu. macOS only in effect. |
| `update_settings()` / `set_update_settings(endpoint, auto_check)` | Read/write `{appDataDir}/update.json`, an installation-level setting like the automatic backup's `auto-backup.json`; the endpoint must be a complete `https` URL. See [`security.md` → In-App Updates](security.md#in-app-updates). |
| `check_for_update()` / `install_update()` | The only commands that reach the network — `tauri-plugin-updater`, driven from `updates.rs` rather than the plugin's JS API so the CSP needs no update host. `install_update` installs only the result `check_for_update` holds, then restarts. See [`security.md` → In-App Updates](security.md#in-app-updates). |

Tauri menu events (not `invoke`) come from the native menu and are received in `AppShell` via `listen()`. On Windows and Linux there is no native menu — the HTML title-bar menus call the same actions directly through `src/lib/menuActions.ts`, so both run one implementation:

| Event ID | Trigger |
|---|---|
| `export-pdf` | Export > Export as PDF… |
| `export-markdown` | Export > Export as Markdown… |
| `export-emerald` | Export > Export as Emerald… |
| `import-markdown` | Import > From Markdown… |
| `import-emerald` | Import > From Emerald… |
| `export-altar-jpeg` / `-png` / `-webp` | Export > Export as Image > JPEG… / PNG… / WebP… |
| `toggle-rail` | View > Navigation Rail |
| `toggle-left-list` | View > Entry List |
| `toggle-right-sidebar` | View > Properties |
| `reset-sidebar-widths` | View > Reset View — resets the entry-list and right-sidebar widths and the altar library height, leaves the altar's full-window mode, **and** brings back a hidden rail, entry list and right sidebar (`uiStore.showAllPanels`; with the rail hidden, Settings and the Vault button would otherwise be unreachable) |
| `show-splash` | View > Show Loading Screen |
| `navigate-back` | Mouse back button (macOS NSEvent monitor) |
| `navigate-forward` | Mouse forward button (macOS NSEvent monitor) |

Only `reset-sidebar-widths` is emitted from the frontend as well — the HTML menu re-emits it so `AppShell`'s listener handles it identically on both platforms; the other menu actions run directly through `runMenuAction`.

The three sidebar toggles and `show-splash` are handled at the very top of `runMenuAction`, above its no-active-vault guard: none touches a database, and the loading screen should be viewable during vault setup too. For the toggles there is a second reason: muda (Tauri's menu crate) flips a native check item's tick *itself* before emitting the event, and falling through to the guard would leave macOS showing a tick with no state behind it, which the visibility-keyed sync effect would never correct.
