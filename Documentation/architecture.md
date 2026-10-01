# Architecture

Emerald is a desktop app built on Tauri v2 (Rust backend) and React 19 (TypeScript frontend). The two sides communicate through Tauri's IPC bridge: the frontend calls Rust commands via `invoke()`, and Rust emits events the frontend subscribes to.

This file is the overview: tech stack, module map, data flow and the IPC surface. The
patterns behind individual areas each have their own file:

| File | Covers |
|---|---|
| [`architecture/modules.md`](architecture/modules.md) | Module registry, entry store, store selectors, categories, tags, moon phase, lexicon |
| [`architecture/editing.md`](architecture/editing.md) | Edit mode, Cancel, leaving an edit, type change, auto-save, sidebar action bar, internal links |
| [`architecture/blocks.md`](architecture/blocks.md) | Content blocks: stored format, fields, sigils, user-built blocks |
| [`architecture/templates.md`](architecture/templates.md) | Templates: assignments, defaults, insertion |
| [`architecture/navigation.md`](architecture/navigation.md) | Global search, drag and drop, tabs, navigation history, left sidebar |
| [`architecture/altar.md`](architecture/altar.md) | Altar UI composition |
| [`architecture/storage.md`](architecture/storage.md) | Image storage, vault layout, vault settings |
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
| Database | SQLite via `tauri-plugin-sql` |
| Internationalisation | react-i18next |
| Icons | lucide-react |
| UI motion / drag reordering | framer-motion |
| Date formatting | date-fns |
| Markdown parsing | marked |
| Markdown serialisation | turndown |
| HTML sanitisation | DOMPurify |

## Module Map

This is the structural map — where things live. What the shared building blocks do and when to use them is in [`components.md`](components.md).

```
src/
├── components/
│   ├── layout/       AppShell, LeftSidebarRail, LeftSidebarEntryList, RightSidebar, MainArea,
│   │                 TabBar, moduleViews.ts (component-layer half of the
│   │                 module registry: ViewId → lazy view; import-restricted to MainArea only)
│   │   ├── settings/ SettingsModal (two-pane shell: vertical nav + scrolling content pane,
│   │   │             fixed `w-[680px]`/`h-[600px]` so switching pages never resizes the
│   │   │             card), one component per page — GeneralPage, SidebarPage, EntriesPage
│   │   │             (composing EmojiDefaultsSection/ImageLimitsSection/TagRulesSection/TemplateDefaultSection),
│   │   │             BackupPage, StoragePage, UpdatesPage (check/install, the update-source
│   │   │             field — the only settings page that is not per vault, see Vault Settings
│   │   │             below), AboutPage — plus SettingsSection/
│   │   │             SettingsChoiceButton/SettingsChoiceRow (shared building blocks, see
│   │   │             components.md) and BrandIcons (GitHub/Patreon/Discord marks as inline
│   │   │             SVGs — lucide carries no brand icons). Every page reads and writes the
│   │   │             open vault's settings through `store/settingsStore.ts` — see
│   │   │             Vault Settings below — not `uiStore`
│   │   └── titlebar/ TitleBar (custom window chrome), WindowControls, TitleBarMenuButton
│   │                 (icon button + in-place MenuDropdown, one per menu), useTitleBarMenus
│   │                 (menu content), MenuDropdown, SearchModal (global search, opened from a
│   │                 magnifier), SearchResultList (its result rows), useIsMaximized, editCommands
│   ├── editor/       RichEditor, InternalLinkExtension,
│   │                 TagInput, ResizableImageExtension, ExternalDropExtension,
│   │                 EditorToolbar, LinkPickerModal, SuggestionList
│   ├── views/        HomeView, JournalView, WikiView, TagsView, CategoriesView,
│   │                 AltarView, OperationsView, TrashView, TasksView, BlocksView, TemplatesView,
│   │                 LexiconView
│   ├── sidebar/
│   │   ├── panels/   JournalPropertiesPanel, WikiPropertiesPanel, OperationPropertiesPanel,
│   │   │             AltarSidebarPanel
│   │   └── fields/   SidebarSection (the collapsible section of read and edit mode —
│   │                 Properties, Linked entries, Tags, Blocks, the Altar's Elements — plus
│   │                 its SidebarPropertyRow/SidebarItemRow/SidebarEmpty row types),
│   │                 EntryReadSections (Journal/Wiki/Operations' read-mode sidebar body),
│   │                 EditProperties (edit-mode property rows: EditPropertyRow,
│   │                 PropertySelect, MediaPropertyRow), CategoryIconCoverRows,
│   │                 PropertiesEditView (a language page's layout shell), Favicon,
│   │                 TagsField/TagsSection (edit vs. read), EntryTypeField (the
│   │                 Journal/Operations/Wiki type toggle above Category, see Edit Mode
│   │                 Architecture below), AltarReadingSummary, PlacedElementRow
│   ├── templates/    TemplateEditor (a template's own page, built on LibraryPageFrame),
│   │                 TemplateAssignments (a template's sidebar summary of its assignments and
│   │                 default, collapsible, with the button that opens TemplateAssignmentsModal),
│   │                 TemplateAssignmentsModal (the table dialog that sets assignments and
│   │                 default), TemplateDefaultsOverview (the dashboard's read-only overview, its
│   │                 own panel table: Journal on top, then Wiki/Operations as columns), assignmentParts.tsx (AssignmentTable —
│   │                 the modal's — plus the shared state icons/labels), TemplateUsage (the
│   │                 entries using a template, in its sidebar), TemplateInsertion (the editor's
│   │                 "Insert template" button, empty-entry suggestions, and the
│   │                 applied-template notice), TemplatePickerModal, TemplateApplyDialog
│   │                 (append/replace + title/tags checkboxes), useAssignmentLabel
│   ├── lexicon/      LanguagePage (a language's own page — its own frame rather than
│   │                 LibraryPageFrame, since it saves every row straight away instead of
│   │                 on "Done"), VocabularyTable (the words, each field saved on blur),
│   │                 AlphabetTable (the transliteration pairs), TranslatePanel (the
│   │                 translate field under the language list, see Lexicon below)
│   ├── altar/        AltarCanvas, AltarCard, AltarCardPreview, AltarItemVisual,
│   │                 AltarLibraryStrip, AltarItemTile (the 70×85px
│   │                 library tile, shared by the strip and the dashboard section below),
│   │                 AltarItemModal (add/edit item dialog, extracted from AltarLibraryStrip),
│   │                 AltarLibrarySection (the Altar dashboard's library-under-the-altars
│   │                 section)
│   └── ui/           Button, Modal, ContextMenu, EditContextMenu (the app's own text
│                     right-click menu — mounted once in `App.tsx`, alongside `AppShell`
│                     rather than inside it, since `AppShell` returns early for the first-run
│                     vault-setup screen and the menu has to reach that screen's fields too),
│                     EmojiPicker, Dashboard, DashboardItem (the clickable dashboard-row/card
│                     frame — click, middle-click, focus ring), EntryListTab, ListToolbar,
│                     FilterPanel, RailButton, TabIconButton, UndoToast, ImportDestinationModal,
│                     Dropdown, FieldDropdown (a properties-panel-styled, portalled Dropdown —
│                     CategorySelect only, now that the templates dashboard sets assignments and
│                     defaults through IconToggleGroup cells instead of dropdowns),
│                     CollapsibleGroupHeader, CategorySelect, EntryDetailFrame,
│                     LibraryPageFrame (the "Done"-to-save page frame shared by a block's own
│                     page and a template's — back link, "Unsaved", name-as-title,
│                     scrolling body, EditActionBar in the sidebar),
│                     InlineConfirm (the "Sure? Yes/Cancel" row-action confirmation),
│                     InlineNameEditor (the input/error/Save/Cancel body of a one-line name
│                     editor), RenameField (the in-place rename input used inside a
│                     `DashboardItem`) — the shared component layer; what each one
│                     encapsulates and where it can be extended is in components.md
├── store/            entryStore (the one store for Journal, Wiki and Operations — see Entry Store
│                                      below), uiStore, tagStore, taskStore,
│                     altarStore, categoryStore (the one Wiki/Operations/Tasks/Altar category
│                                      list, see Categories below), templateStore (the templates
│                                      dashboard, see Templates below),
│                     lexiconStore (the Lexicon's languages and their words — one store for
│                                      both, see Lexicon below), draftStore.ts (the
│                                      unsaved-draft stores behind a block's and a template's
│                                      own page — see useDraftPage below; formerly
│                                      blockDraftStore.ts, one store only), undoStore,
│                     settingsStore (the open vault's settings.json — see Vault Settings below;
│                                      theme/font/language state moved here from uiStore),
│                     imageNoticeStore (the one "image not inserted" notice — wrong format or
│                                      too large — behind ImageNoticeModal, see components.md),
│                     trashStore, vaultStore, importStore,
│                     moduleWiring.ts (store-layer half of the module registry: per-module
│                                      reload, trash restore/permanent-delete, and the
│                                      startup/vault-switch/import reload sequence — see
│                                      Module Registry below)
├── hooks/            useEntryEditor (debounced auto-save + save-on-navigate + save-on-unmount,
│                                      used by JournalView, WikiView, OperationsView),
│                     useEditActions (registers Save/Cancel/Delete into the right sidebar,
│                                      used by all five entry views),
│                     useDraftPage (the "Fertig speichert nur Geändertes" draft lifecycle behind
│                                      a block's and a template's own page, over a draftStore.ts
│                                      instance), useShrunkIcon (shrinks an image icon to 64px
│                                      before it lands in a block/template draft), 
│                     useSaveAsTemplateAction ("Save as template" context-menu entry, shared by
│                                      every entry with a block stack),
│                     useOutsideClick (mousedown-outside(+Escape) dismiss pattern, used by
│                                      eight menus/popovers),
│                     useGlobalSearch (assembles the search corpus from the stores and runs it
│                                      against the query; backs the title bar's search field),
│                     useDeepLink (global search's deep link for a view with no detail page —
│                                      run onOpen once, then scroll the matching row into view;
│                                      used by TasksView, CategoriesView, TagsView),
│                     useOpenInNewTabAction (the "Open in New Tab" ContextMenuAction for an
│                                      ActiveView, the menu counterpart to DashboardItem's
│                                      middle-click; used by HomeView, WikiView, OperationsView,
│                                      BlocksView, TemplatesView, LexiconView and the four
│                                      LeftSidebarEntryList configs),
│                     useDisplayedAltar (the altar the view is actually showing, matched
│                                      against activeView.id rather than read straight off
│                                      altarStore — see Altar UI Composition below)
├── lib/              db.ts, schema.ts, normalizeSchema.ts, row.ts,
│                     entryTypeChange.ts (turns a Journal/Wiki/Operation entry into another of
│                                      the three — one UPDATE on the same row, see Edit Mode
│                                      Architecture below),
│                     unifyEntries.ts (migration v49), schemaV48.ts (the frozen DDL of every
│                                      table v49–v53 reshaped), tagsById.ts (migration v53),
│                     tagRefs.ts (tag ids in entries/templates: rewriteTagRefs, stripTagIds,
│                                      replaceTagId, tagNameResolver), altarSettings.ts
│                                      (an altar's `settings` JSON, v51),
│                     links.ts, tabs.ts (tab IDs, isContentView), globalSearch.ts, searchText.ts,
│                     modules.ts (the module registry — see Module Registry below),
│                     entryTitle.ts (displayTitle/hasOwnTitle — an entry's title is stored
│                                      empty and shown as "Untitled …"; see Module Registry
│                                      below),
│                     dragChannel.ts (generic set/get/subscribe factory), dragState.ts,
│                     altarDragState.ts (both are thin named-export adapters over their own
│                                      createDragChannel() instance),
│                     blocks/templates.ts (a template's shape, its assignments and defaulting
│                                      rules — see Templates below), templateRows.ts (the raw
│                                      `templates` row access shared by the store, migration
│                                      v44, fresh-vault seeding and import — same pattern as
│                                      blockDefinitionRows.ts), migrateRoutinesToTemplates.ts
│                                      (routine → template conversion, shared by migration v44
│                                      and the backup importer),
│                     lexicon.ts (the Lexicon's rules: the alphabet, looking a word up and
│                                      translating a text with both — see Lexicon below),
│                     lexiconRows.ts (the raw `languages`/`lexicon_entries` row access shared
│                                      by the store and the backup import — same pattern as
│                                      blockDefinitionRows.ts),
│                     moonPhase.ts, export.ts, menuActions.ts,
│                     platform.ts, categories.ts (categoryLabel, categoriesUsedBy,
│                                      categoryUsageCounts — the one display-name,
│                                      used-categories and usage-count rule for all four
│                                      categorized modules, see Categories below),
│                     categoryMerge.ts (categoryKey, mergeCategoryRows — shared by migration v38,
│                                      the fresh-vault seed, and the backup-import lift),
│                     formatDate.ts (locale-aware date-fns formatting, wired into
│                                      changeAppLanguage; export.ts/emeraldFormat.ts stay
│                                      locale-independent on purpose),
│                     sortItems.ts (the one SortMode comparator for every dashboard),
│                     groupBy.ts (groupBy/groupByMonth → DashboardGroup[]),
│                     exportData.ts, emeraldFormat.ts, vaultManager.ts, dbBackup.ts,
│                     helpers.ts (incl. isImageIcon, iconTitle (icon + name as one
│                                      trash-row title, falling back to the name alone for an
│                                      image icon), generateId,
│                                      hexToRgb, isValidHexColor, readFileAsDataUrl,
│                                      ACCEPTED_IMAGE_MIME, isAcceptedImageFile),
│                     images.ts (imageSrc, saveImage, copyImageFile, canvasImageSrc,
│                                      findUnusedImages — the image pipeline, see Image
│                                      Storage System below),
│                     thumbnail.ts (shared thumbnail encoder: WebP quality ladder under the
│                                      512-KB cap, used by altar cards),
│                     altarConstants.ts, altarExport.ts, styleClasses.ts,
│                     updates.ts (the four updater IPC calls plus the progress event —
│                                      thin wrapper over `updates.rs`, see
│                                      security.md#in-app-updates),
│                     emojiSearchData/{en,de,es,fr}.json (localised emoji search datasets,
│                                      generated from emojibase-data, lazy-loaded per locale)
├── fonts.css         @font-face rules of the eight bundled typefaces — generated by
│                     scripts/make-fonts-css.mjs (`npm run fonts`), see Font System below
├── themes/           emerald-noctis.css, emerald-parchment.css, theme.ts
├── i18n/             react-i18next setup + locales/en.json de.json es.json fr.json
│                     (only `en` ships in the start bundle; de/es/fr load on demand via
│                      `changeAppLanguage` — always use that instead of i18n.changeLanguage)
└── types/index.ts    Shared TypeScript interfaces

src-tauri/
└── src/
    ├── main.rs          entry point, delegates to lib.rs
    ├── lib.rs           command registration, path guards, native menu, mouse nav monitor, setup
    ├── images.rs        image commands (save/copy/read/list/delete/adopt) + emerald-img scheme
    ├── vault.rs         vault registry + vault dir commands (register/probe/create/delete/…)
    ├── updates.rs       in-app updater: variable source, signature/version verification, install — see security.md#in-app-updates
    └── pdf_export/      Native-webview PDF export (one file per platform, #[cfg(target_os)] dispatch)
        ├── mod.rs           #[cfg(target_os = "…")] re-export of the platform `export_pdf`
        ├── windows.rs       WebView2 + ICoreWebView2_7::PrintToPdf
        ├── macos.rs         WKWebView createPDFWithConfiguration
        └── linux.rs         WebKitGTK WebKitPrintOperation + gtk::PrintSettings, virtual "Print to File" printer resolved via FFI
```

## Data Flow

```
SQLite (emerald.db)
    ↓  read on startup (getDb + runMigrations)
    ↓  fromRow.* (row.ts)
Zustand stores (in-memory)
    ↓  React subscriptions
Components (render)
    ↓  user edits
Store actions (updateEntry, updateOperation, …)
    ↓  toInt / toJson (row.ts)
    ↓  db.execute / db.select
SQLite (persisted)
```

Stores are the single source of truth for in-memory state. Components never query SQLite directly. All SQL happens inside store action functions in `src/store/*.ts`.

`src/lib/row.ts` sits on both edges of that flow and is the only place that translates between SQLite rows and the types in `src/types`. SQLite has neither booleans nor arrays — booleans arrive as the numbers `0`/`1`, arrays as JSON text — so something has to convert, and doing it per store is how the same field ended up holding a number in one code path and a boolean in another.

The schema itself lives in `src/lib/schema.ts`, not in `db.ts`: fresh vaults execute that DDL directly, existing ones reach the same shape through the migration chain and the rebuild in `normalizeSchema.ts`. `npm run check:schema` builds a vault each way and compares them. See [`database.md`](database.md) for the details.

### Startup loading and lazy data

`AppShell` calls `reloadAllStores()` (`src/store/moduleWiring.ts`) on mount and again on every vault switch — see [Module Registry](architecture/modules.md#module-registry) above for what it does and why it now loads tags, then categories, then content in sequence rather than firing all seven fetches in parallel. Views do **not** refetch on mount — `TasksView` and `AltarView` used to, redundantly; a view that mounts before the startup fetch resolves simply renders its empty state until the store fills.

Two deliberate exceptions to "the store holds the whole row":

- **Sigil drawings are files, not columns.** Until v42 `operations.drawing_data` held every sigil drawing as base64 — by far the widest column — which forced a lazy-loading dance (`ensureDrawingLoaded`, `preserveLoadedDrawings`, a separate `thumbnail_data`). Since v42 the drawing is an image file referenced from the canvas block's `<img src>`, so the operation list query (`OPERATION_COLUMNS`) carries only small columns. `entryBlockSummary(...).sigil.image` still resolves the filename of the first visible, unconcealed drawing, but the Operations dashboard's cards no longer render it — a sigil operation's card looks like any other operation's card now (icon, title, "Category · date"); only the list (row) layout still reads `.sigil` off the summary, for the target date shown there.
- **`altar_placements` load in one query.** `fetchAltars` selects the whole table once (since v52 joined to the live `altar_items`, `LIVE_PLACEMENTS`, so placements of trashed elements stay hidden) and groups rows by `altar_id` in JS (`mapPlacementRows` + a `Map` over items); it used to run one query per altar on every startup and every AltarView mount.

### Store write serialization

Every content-store update method (`updateEntry`, `updateArticle`, `updateOperation`, `updateTask`/`toggleComplete`, `updateTag`, `updateTemplate`, `updateAltar`/`updateAltarGrid`/`updateAltarResolution`, `updateItem`, `updatePlacement`) follows the same shape: read a snapshot from the store, merge the patch into it, and write the *entire* row back to SQLite. Two overlapping updates to the same entity — an editor autosave firing while the sidebar changes a property, or an altar's automatic thumbnail save overlapping a title save — used to race: whichever finished last won, overwriting the other's fields with a stale snapshot, including content that had just been typed.

`src/lib/serialize.ts` closes that race. `serialized(serialKey(domain, id), task)` chains same-key tasks strictly one after another on a `Map<string, Promise<void>>`, so a merge-and-write always runs against the previous one's result rather than a snapshot taken before it landed. The invariant going forward: **any store method that writes back a whole row from a snapshot must run its write through `serialized()`, keyed per entity id.** `serialKey` types the domains that currently participate (`journal`/`wiki`/`operation`/`task`/`tag`/`altar`/`altarItem`/`placement`/`blockDefinition`/`template`/`language`). `taskStore.toggleComplete` queues each affected descendant under its own `task:<id>` key rather than one shared key, so a concurrent `updateTask` on a child can't have its `completed` columns rewound by the parent's cascade (or vice versa).

Deliberately not serialized, each with a comment at its own definition rather than here: `bumpAltarUpdatedAt` (writes only `updated_at`, nothing to race) and the four `updateCategory` variants (write only the columns passed in, no snapshot merge to race against).

A serialized task must never await another task under its own key — that would wait on itself and never settle — so the chain deliberately carries no timeout: a task that never settles occupies its key permanently. `drainSerialized()` resolves once every currently-queued chain has settled. `vaultStore.openActiveVault` and `dbBackup.importDatabase` (replace/add-vault only, not merge) await it before resetting the DB connection or replacing rows outright — the editor lock (above) only stops *future* saves from being queued, so writes already in flight still need to run to completion first.

### Code splitting

`MainArea` loads all eight views with `React.lazy` via `VIEW_COMPONENTS` in `src/components/layout/moduleViews.ts` (see [Module Registry](architecture/modules.md#module-registry) above), so TipTap (the largest chunk) only loads when a Journal/Wiki/Operations view first opens. `SettingsModal` is lazy for the same reason (it pulls the whole `dbBackup` machinery). `menuActions.runMenuAction` imports the export/import modules (`export.ts`, `exportData.ts`, `emeraldFormat.ts`, `altarExport.ts` — and with them `turndown` and `marked`) with `await import()` per action, and `src/i18n/index.ts` ships only `en` eagerly (see the module map). `vite.config.ts` deliberately has **no catch-all vendor chunk** — Rollup splits along these `import()` boundaries, and a blanket `return "vendor"` would pull the lazy libraries back into the eager bundle.

## IPC Command Surface

All Rust commands are *registered* in `src-tauri/src/lib.rs` and invoked from TypeScript with `invoke()`; over half of them are *defined* in `images.rs` and `vault.rs` and referenced as `images::…` / `vault::…` in the handler list.

**File commands run off the main thread.** `write_file`, `read_file`, `export_image`, `ensure_app_storage_dirs` and all seven commands in `images.rs` (including `read_image_file`, which reads an arbitrary external image file for the frontend to scale against the vault's image limits before saving it) are `async` and wrap their `std::fs` work in `tauri::async_runtime::spawn_blocking` — a multi-megabyte `.emeralddb` with embedded images used to block the window for the duration of the write. `async fn` alone would not have been enough: without `spawn_blocking`, the blocking call still runs on a runtime worker and can starve the SQL plugin, PDF export and IPC replies on a machine with few cores. The four native-menu commands stay synchronous on purpose — they mutate `NSMenu`, which is main-thread-only on macOS. A static `IMAGE_WRITE_LOCK` mutex in `images.rs` serializes the image folder's writes and deletes, a guarantee that used to be implicit when those commands ran on the main thread one at a time; without it, a storage cleanup could delete a file whose hash a concurrent `save_image` had just judged "already exists" and skipped writing. `resolve_allowed_roots()` caches its result behind a `OnceLock` once every root canonicalizes successfully — it used to re-run six `canonicalize` syscalls on every file command — and falls back to re-resolving on every call if any root fails to canonicalize (a not-yet-existing directory, an unmounted network drive), so a transient failure heals on the next call instead of freezing a wrong answer in for the rest of the session. The `emerald-img` scheme handler likewise moved from one `std::thread::spawn` per image to `spawn_blocking`, reusing the async runtime's blocking pool instead of creating and tearing down an OS thread per request.

| Command | Purpose |
|---|---|
| `save_image(data_url, vault_id)` | Decode base64 data-URL, write `{sha256}.{ext}` into the vault's `images/`, skip if it exists. Returns the **filename**. |
| `copy_image_file(source, vault_id)` | Read a file from an arbitrary path, write it into the vault's `images/` under its SHA-256 name. Accepts png/jpg/jpeg/gif/webp/svg only. Rejects symlinks, canonicalizes the source, and verifies it falls within the allowed storage roots. Returns the filename. |
| `read_image_as_base64(filename, vault_id)` | Read a stored image and return a data-URL. Only for the two callers that cannot use the `emerald-img` scheme: the PDF export renders in a `file://` webview, and the backup writer embeds bytes in JSON. |
| `read_image_file(source)` | Read an *external* image file (not yet in any vault) and return a data-URL, without storing it — so the frontend can scale it and check it against the vault's image-size settings before handing the result to `save_image`. Same extension allowlist and root confinement as `copy_image_file` (`checked_image_source`, their shared helper), plus its own 64 MB source-file cap. |
| `read_vault_drafts(vault_id)` / `write_vault_drafts(vault_id, contents)` | The vault's `drafts.json` — the unsaved drafts of block and template pages (`store/draftStore.ts`). Same rules as the settings file; an empty object removes the file. Both are `async` commands — written after every pause in typing, they must not run on the main thread — and a rename or remove that fails is tried again a few times, since on Windows a scanner or sync client may hold the file for a moment |
| `read_vault_settings(vault_id)` / `write_vault_settings(vault_id, contents)` | The vault's `settings.json` — see [Vault Settings](architecture/storage.md#vault-settings) above and [`security.md`](security.md) for the write's atomicity and symlink handling. |
| `adopt_legacy_images(vault_id, filenames)` | Copy images out of the pre-per-vault shared pool into a vault's own folder. Migration v35 only. |
| `list_image_files(vault_id)` / `delete_image_files(vault_id, filenames)` | Back the *Unused images* cleanup. Confined to the vault's own folder; both reject any name that is not 64 hex digits plus a known extension. |
| `register_vaults(vaults)` | Mirror `vaults.json` into the `id → path` registry every storage command resolves against. |
| `create_vault_dirs(vault_id)` / `ensure_vault_dirs(vault_id)` | Build a new vault's tree / verify an existing one before its database is opened. `ensure_vault_dirs` does not create the vault directory — see [Vault Layout](architecture/storage.md#vault-layout). |
| `default_vault_dir(vault_id)` / `probe_vault_dir(path)` | The location a vault gets when the user picks none / what a folder chosen in the dialog already contains. |
| `new_vault_base_dir()` | The folder new vaults are offered in: `{documentDir}/Emerald Vaults`, falling back to `{appDataDir}/vaults` where the platform exposes no documents folder. |
| `legacy_default_db_exists()` | Whether an `emerald.db` from before `vaults.json` existed is sitting in `app_config_dir`, `app_data_dir`, or the migration target — the difference between a genuine first start and an installation whose journal is already on disk. |
| `migrate_vault_layout(vault_id, legacy_db_name)` | Move a pre-per-vault flat database into its own directory. Returns that directory. |
| `delete_vault_files(vault_id)` | Removes only the vault's own artefacts by name — database, journal, `settings.json`, recognised images, an *empty* `backup/` — never `remove_dir_all`. The directories go with plain `remove_dir`, which fails while anything else (a backup, a `desktop.ini`) is still inside; that failure is the answer, not an error. Returns whether the vault folder itself is gone, so the UI can say "the folder stayed". |
| `discard_import_staging(vault_id)` | Removes a backup import's staging copy — the fixed filename `emerald.db.import`, plus `-journal`/`-wal`/`-shm` — from a vault's own directory. Run before every import (clears whatever a crashed one left behind) and after (success or failure alike). A missing file is not an error. See [DB Backup / Restore](database.md#db-backup--restore-emeralddb) in `database.md`. |
| `prune_migration_backups(vault_id)` | Deletes every migration backup in the vault's own folder except the newest — only regular files named exactly `emerald.db.pre-v<number>.bak` (what `backupDatabaseFile` in `dbRebuild.ts` writes before a table rebuild), never a symlink, a directory or another name. Returns how many it removed; a missing folder is `0`. Called by `getDb()` after `runMigrations` on every vault open, its failure only logged. |
| `ensure_backup_dir(vault_id)` | The vault's `backup/` folder — the database export dialog's default destination. Created with the vault by `create_vault_dirs`, recreated here on demand; refused for a vault outside the allowed storage roots, where `write_file` could not write anyway. A non-empty `backup/` is deliberately not part of what `delete_vault_files` removes: a backup should outlive the vault it was taken from. |
| `export_image(path, data_url)` | Decode a base64 data-URL and write the binary image bytes to a user-chosen path. Permitted extensions: `.png`, `.jpg`, `.jpeg`, `.webp`. Same symlink rejection, allowed-roots confinement, and `canonicalize`-before-write checks as `write_file`. |
| `write_file(path, content)` | Write UTF-8 text to a user-selected path. Permitted extensions: `.md`, `.emerald`, `.emeralddb`, `.json`, `.txt`. Path must resolve within allowed storage roots. |
| `read_file(path)` | Read a file and return its UTF-8 content. Same extension allowlist and root confinement as `write_file`. |
| `ensure_app_storage_dirs()` | Create app data and app config directories if they don't exist. Called before frontend writes vault metadata or opens SQLite. |
| `export_pdf(html, path, page_size?)` | Render the supplied HTML to a PDF at `path` by driving the app's own webview. The frontend first prompts the user for a save location via the `dialog` plugin and passes the chosen path here. `page_size`, an optional `(width_in, height_in)` tuple in inches, overrides the default Letter/Portrait page with a custom size — used only by the Altar PDF export (see below); Journal/Wiki/Operations export calls it without `page_size` and gets the old default behavior. Per-platform implementations live in `src-tauri/src/pdf_export/{windows,macos,linux}.rs`, all behind the same `pub async fn export_pdf` signature; `mod.rs` does the `#[cfg(target_os = "…")]` re-export so `lib.rs` calls `pdf_export::export_pdf` without knowing which platform it's on. |
| `close_request_seen()` | The frontend's acknowledgement of a close request — see [Closing the window](architecture/shell.md#closing-the-window). |
| `update_menu_labels(...)` | Update native menu item labels for i18n (edit, view, export, import submenus and their items, including `show_splash` and the View menu's three `CheckMenuItem`s, which need their own `MenuItemKind::Check` arm). macOS only in effect — see [Window Chrome](architecture/shell.md#window-chrome). |
| `set_view_menu_checked(rail, left_list, right_sidebar)` | Mirror the frontend's sidebar visibility onto the View menu's three check items. Called on every change, since other actions besides the menu itself can flip the same state (e.g. `setActiveView` opening the right sidebar for edit mode). macOS only in effect. |
| `set_export_menu_enabled(entry, pdf, emerald)` | Enable/disable the native "Export as …" items for the current view. Driven by `computeMenuEnabledState`; macOS only in effect. |
| `set_altar_export_menu_enabled(enabled)` | Enable/disable the native "Export as Image" submenu. macOS only in effect. |
| `update_settings()` / `set_update_settings(endpoint, auto_check)` | Read/write `{appDataDir}/update.json` — the one installation-level (not per-vault) setting. `set_update_settings` validates the endpoint as a complete `https` URL before writing. See [`security.md` → In-App Updates](security.md#in-app-updates). |
| `check_for_update()` / `install_update()` | The only two commands that reach the network — `tauri-plugin-updater` under the app's own signing key, driven entirely from `src-tauri/src/updates.rs` rather than the plugin's JS API, so the WebView's CSP never needs an update host added to `connect-src`. `check_for_update` holds its result in app state; `install_update` installs only that held result and restarts the app. See [`security.md` → In-App Updates](security.md#in-app-updates). |

Tauri menu events (not `invoke`) are emitted by the native menu and received in `AppShell` via `listen()`. On Windows and Linux there is no native menu (see [Window Chrome](architecture/shell.md#window-chrome) below) — the HTML title-bar menu buttons call the same actions directly through `src/lib/menuActions.ts`, so both platforms run one implementation:

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
| `reset-sidebar-widths` | View > Reset View — resets the entry-list and right-sidebar widths and the altar library height, leaves the altar's full-window mode, **and** brings back a hidden rail, entry list and right sidebar (`uiStore.showAllPanels`; with the rail hidden, Settings and the Vault button would otherwise be gone until the View menu is found) |
| `show-splash` | View > Show Loading Screen |
| `navigate-back` | Mouse back button (macOS NSEvent monitor) |
| `navigate-forward` | Mouse forward button (macOS NSEvent monitor) |

Only `reset-sidebar-widths` is still emitted from the frontend as well — the HTML menu re-emits it so `AppShell`'s existing listener handles it identically on both platforms. The other twelve are called directly through `runMenuAction`. The three sidebar toggles and `show-splash` are handled at the very top of `runMenuAction`, above its no-active-vault guard: none of the four touches a database, and `show-splash` in particular should work during vault setup too — that's the moment a loading screen is most likely to be looked for again. For the three toggles specifically there is a second reason to return early there: muda (Tauri's menu crate) flips a native check item's tick *itself* before emitting the event, and falling through to the guard would leave macOS showing a tick with no state behind it, which the `[railOpen, leftListOpen, rightSidebarOpen]`-keyed sync effect would then never correct.
