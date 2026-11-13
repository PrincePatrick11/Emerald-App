# Database

Emerald uses one SQLite file per vault, always named `emerald.db`, inside the vault's own directory. Where that directory sits is the user's choice — see [Multi-Vault System](#multi-vault-system) and [Vault Layout](architecture/storage.md#vault-layout).

## Where the schema lives

`src/lib/schema.ts` holds the complete, current schema as `CREATE TABLE` and `CREATE INDEX` strings (`TABLE_DDL`, `INDEX_DDL`). It is the only record of the schema: a fresh vault is created straight from it, and reading it tells you what every vault this version opens looks like.

`npm run check:schema` (`scripts/schema-check.mjs`, needs `esbuild` from `devDependencies`) builds a fresh vault under `node:sqlite` and checks what the app and its import rely on: exactly the tables of `schema.ts`, the foreign keys, `checkIntegrity` and the sweep, deleting a category, the seeds, the block rows and their readers, the indexes the lists use, a backup's round trip in every mode — and that a vault or a backup from an older version is refused without being changed. It also compares constants mirrored across languages (see [Rules for Future Schema Changes](#rules-for-future-schema-changes)).

## Opening a Vault

`src/lib/db.ts` exports `openVaultDb(vaultId)` and `getDb()`. `openVaultDb` loads the database and runs `runMigrations(db)`; the unlock gate (`ensureVaultReady`, see [encryption](architecture/encryption.md#the-unlock-gate)) calls it right after unlocking, before the vault's settings or drafts are read or written. `getDb()` returns the active vault's connection and runs the periodic cleanup once per session (it needs the vault's trash retention, which is loaded after the gate). The database uses `PRAGMA journal_mode = DELETE` (not WAL) for robustness across unclean shutdowns.

`runMigrations` first reads the highest version in `schema_version` — before it writes anything — and then takes one of these routes:

- **Empty file** — a new vault. It runs the DDL from `schema.ts`, seeds the built-in categories, the starter categories and the `core-sigil` and `core-altar` templates — in the language active at first open, since `main.tsx` waits for the stored language before anything touches the database — and stamps one `baseline` row at `BASELINE_VERSION`, last. A new vault whose creation was cut short before the stamp — tables of `schema.ts` only, no entries or tasks — is dropped and created again on the next open.
- **Below `FRESH_START_VERSION`** (100), or tables without a version that are not such an unfinished new vault — a vault from before the fresh start of the schema, built by the old migration chain v1–v66 that this version no longer has. It is refused with `VAULT_OUTDATED` and left exactly as it was; the vault picker says so (`vault.outdated`). A converter for such vaults is a task of its own.
- **Above `BASELINE_VERSION`** — a vault of a newer app: refused with `VAULT_TOO_NEW` (`vault.tooNew`), unchanged too.
- **Between the two** — the steps of `MIGRATIONS` above the stored version run in order, each stamping `schema_version` with version, name and ISO timestamp. The list is empty today: `BASELINE_VERSION` equals `FRESH_START_VERSION`, and `runMigrations` throws at startup if the last step and `BASELINE_VERSION` disagree. A vault connected to a sync server has its triggers dropped for the run and is marked for a snapshot first (`markMigrated`), since a migration changes rows on every device on its own.

An unencrypted vault with a database is refused the same way by the gate, before any password question: every such vault predates encryption, and with it the fresh start.

`runPeriodicCleanup(db)` is **not** a migration — idempotent, time-dependent, and run on the first `getDb()` of a session. It purges trashed rows older than the vault's trash retention (`trash.retentionDays` in `vaultSettings.ts`, default 30 days, or never). If the loaded settings belong to another vault it purges nothing (`null` = never), so one vault's retention can never empty another's trash. Expired tags are first stripped from every tag list (`stripTagIds`). Afterwards it sweeps dangling `task_links` and tag ids without a `tags` row (`sweepDanglingTagIds` — such an id can appear when a tag goes for good while a draft or an open entry still holds the old list and saves it later).

## Foreign Keys

Foreign keys are **enforced on every connection**: the SQL layer (`db.rs`) runs an sqlx pool, and sqlx sets `foreign_keys = ON` as a default pragma on each connection it opens. No application code turns them on. Each connection also gets `cache_size = -32768` (32 MB): SQLCipher decrypts a page whenever it enters the page cache, and with SQLite's default of 2 MB a scan over `entries` evicts its own pages, so every repeat decrypts everything again (repeat full scans run about six times faster with the larger cache). The pool is capped at 4 connections, since every connection has its own cache; memory is only used for pages actually read.

Two consequences shape how this schema is changed:

- A constraint takes effect the moment it is declared. There is no grace period.
- `PRAGMA foreign_keys = OFF` and `BEGIN` are **not usable across separate `execute()` calls** — each call reaches one pooled connection, and which one serves the next call is not controllable. That rules out the SQLite documentation's table-rebuild recipe spread over several calls. A *single* call is different: sqlx runs the `;`-separated statements of one string in order on the one connection it picked, so one multi-statement `execute()` can hold a real `BEGIN … COMMIT`. `importStaging.ts`'s `swapIn` does this — see [DB Backup / Restore](#db-backup--restore-emeralddb). The other way is `Database.batch` (`db_batch` in `db.rs`): a list of statements with bound values, run as one transaction on one connection, all or none. Write loops use it; it cannot wrap a whole import, whose statements are built from reads in between.

Eight relations are declared, each with a deliberately chosen delete behaviour:

| Relation | ON DELETE | Reason |
|---|---|---|
| `task_links.task_id` → `tasks.id` | CASCADE | a link without its task is meaningless |
| `blocks.entry_id` → `entries.id` | CASCADE | a block is part of its entry |
| `blocks.template_id` → `templates.id` | CASCADE | likewise for a template |
| `block_refs.block_row` → `blocks.row_id` | CASCADE | a reference is part of its block |
| `lexicon_entries.language_id` → `languages.id` | CASCADE | a word without its language is nothing |
| `tasks.parent_task_id` → `tasks.id` | SET NULL | the subtask survives as a standalone task |
| `entries.category_id` → `categories.id` | RESTRICT | content must never vanish with its category (always `NULL` for a journal entry) |
| `tasks.category_id` → `categories.id` | RESTRICT | likewise |

Both `category_id` columns point at the one `categories` table and are nullable — `NULL` means no category, which is what a new entry starts with.

### What foreign keys cannot cover

`task_links.target_id` is **polymorphic** — `target_type` (`'journal' | 'wiki' | 'operation' | 'task'`) decides what kind of row the target is, and SQL has no polymorphic foreign key. The same applies to the JSON-array references `templates.assignments` (category ids) and `entries.tags`/`templates.tags` (tag ids).

These are exactly the places where orphans accumulate. Three things stand in for the missing constraints:

- **`checkIntegrity(db)`** in `schema.ts` reports `task_links` rows whose target is missing or exists with another `type` than `target_type`, unknown category ids in `templates.assignments` (parsed in JavaScript, since SQL cannot), and tag ids in `entries.tags`/`templates.tags` without a `tags` row (trashed tags count as existing). It scans whole tables and is a diagnostic only, not called on the production path.
- **`sweepDanglingTaskLinks(db)`** in `db.ts` deletes `task_links` rows whose target does not exist **with the matching type** (`LINK_TARGET_EXISTS`: `entries` by `id` and `type`, plus `tasks`). Its rule and `checkIntegrity`'s map of target types are kept in step by hand. Soft-deleted targets count as valid — trashed content isn't an orphan yet. It runs in the periodic cleanup, when the trash is emptied, and at the end of every backup import (a partial restore or an imported link row can point at something the import didn't bring).
- **Permanent deletes clean up directly.** `taskStore.permanentlyDeleteTask` (which takes every subtask in the Trash along) deletes both directions. A task's *soft* delete removes no `task_links` row — `taskStore` only loads the links of tasks outside the Trash, and restoring the task brings them back.

`lib/entryTypeChange.ts` (see [Changing an entry's type](architecture/editing.md#changing-an-entrys-type)) changes a Journal/Wiki/Operation entry's kind with one `UPDATE` of the same row (`retypeRow`). It is the one place allowed to rewrite `target_type` on existing `task_links` rows, and does so in the same step, so the sweep never has a reason to remove them.

### Deleting a category never deletes its content

`RESTRICT` deletes nothing; it refuses a delete that would leave a dangling reference. `reassignCategoryContent(db, categoryId)` in `schema.ts` is the other half: it sets `category_id` to `NULL` across `CATEGORIZED_TABLES` (`entries`, `tasks`) so the delete becomes permissible, and calls `dropCategoryFromTemplates`, which strips the category out of every template's `assignments` (trashed ones too). A template isn't content and doesn't become "Uncategorized" — it simply stops applying to a combination that no longer exists. `templateStore`'s `dropCategoriesFromTemplatesInMemory` mirrors that trim in the loaded store.

When a category is merged into a namesake instead (`reassignCategoryContent(db, from, to)`, via `mergeCategory` from `categoryStore.restoreCategory` and `updateCategory`), content and assignments move to `to` (`moveCategoryInTemplates`): an assignment moves along only where no template already holds that entry type and `to`.

Only a **permanent** deletion reassigns: `categoryStore.permanentlyDeleteCategory`, `trashStore.emptyTrash`, and the periodic cleanup for an expired category (`purgeCategory`). That is why `categories` is **not in `CLEANUP_TABLES`** — it is purged separately, after its content is released. A *soft* delete never reassigns: content keeps pointing at the trashed category, the UI groups it under "Uncategorized", and restoring the category brings everything back. `reassignCategoriesInMemory` in `categoryStore.ts` applies the same move to the loaded content stores, so an in-memory row doesn't write back a `category_id` the foreign key would reject.

The built-ins, `sigils` and `altars`, cannot be deleted: an operation in `sigils` is a sigil, and a new one starts with the sigil blocks through the built-in `core-sigil` template, assigned to Operations × Sigils; an operation in `altars` is an altar and starts with an altar block and a text for notes through `core-altar`.

## Tables

Fourteen tables. `TABLES` in `schema.ts` declares the dependency order, parents before children; the sections below group related tables. The order is not cosmetic: inserts are checked against foreign keys immediately, so it governs the creation of the schema and the import swap.

### schema_version

Which state of the schema the vault is at — what `runMigrations` reads first (see [Opening a Vault](#opening-a-vault)). A fresh vault has one `baseline` row; each later migration step adds its own. The import swap leaves it alone.

| Column | Type | Notes |
|---|---|---|
| version | INTEGER PK | `BASELINE_VERSION` for a fresh vault, or the version of a migration step |
| name | TEXT | `'baseline'`, or the migration step's name |
| applied_at | TEXT | ISO 8601 |

### tags

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT UNIQUE | unique across trashed rows too; a rename touches only this row |
| color | TEXT | hex, default `'#8347ff'` |
| deleted_at | TEXT | NULL = active |

`entries.tags` and `templates.tags` are JSON arrays of `tags.id` (`src/lib/tagRefs.ts`). A trashed tag stays in its rows, merely hidden, and comes back with its restore. Lists are rewritten only when a tag disappears for good (permanent delete, empty trash, retention purge — `stripTagIds`) or merges into a live namesake on restore (`replaceTagId`). Both go through `rewriteTagRefs`, which walks `TAG_REF_TABLES` (`entries`, `templates`, `images`) including the Trash and leaves `updated_at` alone. Tasks carry no tags.

### categories

One list shared by Wiki, Operations and Tasks. Journal has no categories.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `'sigils'` and `'altars'` for the built-ins; the key for a starter category (`'ritual'`, …); UUID otherwise |
| name | TEXT | NOT NULL; ignored for the built-ins — their display name comes from `categories.builtin.<id>` in the active locale |
| emoji | TEXT | NOT NULL DEFAULT `'📁'` |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| is_builtin | INTEGER | boolean 0/1; true only for `sigils` and `altars` |
| deleted_at | TEXT | NULL = active |

There is no `UNIQUE` on `name`: uniqueness is enforced by the store (`categoryKey`: trimmed, case-insensitive), because a `UNIQUE` index would block restoring a trashed category whenever an active one shares its name. `SIGIL_CATEGORY_ID` (`'sigils'`) and `ALTAR_CATEGORY_ID` (`'altars'`) are the categories with behaviour (see above). A fresh vault also seeds eight ordinary starter categories (`STARTER_CATEGORIES`, named in the app's language at creation), freely renamable and deletable.

### block_definitions

The user-built blocks of the Blocks view. A row is only the template — an inserted block is a **copy** among the entry's blocks (a `core.fields` section carrying its own elements, display rules, name and icon, with no link back). Nothing references this table by foreign key, and deleting a row touches no entry.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | NOT NULL |
| icon | TEXT | emoji, NOT NULL DEFAULT `'🧩'` |
| elements | TEXT | JSON array of `ElementDef` (`id`, `kind`, `label`, `options`, `hideWhenEmpty`, `defaultValue`, plus `calcMode` for a `sigilCalc` element and `brushColor`/`brushSize` for a `sigilCanvas` one), NOT NULL DEFAULT `'[]'`; read through the same validation as a copy in content |
| display | TEXT | JSON `{ readHideEmpty, readOnly, showTitle }`, NOT NULL DEFAULT `'{}'` (missing keys fall back to their defaults) |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active; purged after the retention period (`CLEANUP_TABLES`) |

An element's kind never changes — the builder adds a new element instead.

An element's `defaultValue` (the builder's "Prefill") is what a new copy starts with. A scalar (checklist, choice, …) is stored as the value itself; a `link` element stores `{id, entryType, label}`; an `image` element stores the filename; a `sigilCharge` element stores `{lock, targets}`, with `targets` holding element ids (block-qualified only once a copy exists) or `null` for "all sigils in this block". Nothing here is markup — `instantiateDefinition` turns a default into a link chip or `<img>` only inside the copy it creates, so the definition row never needs the link or image machinery to understand it.

### templates

The templates dashboard's rows, behind Journal/Wiki/Operations' "insert a template" flow — see [Templates](architecture/templates.md#templates) for assignments. Like `block_definitions`, a row is only ever copied into an entry's blocks with no link back, so deleting a row touches no entry. Its own block stack is rows of [blocks](#blocks) with `template_id` set.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID (or `'core-sigil'`, `'core-altar'` for the built-ins) |
| name | TEXT | NOT NULL |
| icon | TEXT | emoji or image, NOT NULL DEFAULT `'📄'` |
| title | TEXT | NOT NULL DEFAULT `''`; the title a new entry gets — empty means the entry starts untitled |
| tags | TEXT | JSON array of tag ids, NOT NULL DEFAULT `'[]'` |
| assignments | TEXT | JSON array of `{entryType, category}`, NOT NULL DEFAULT `'[]'`; `category` is a category id, `null` (no category) or `'*'` (all categories). No assignments = no entry starts with it, it can still be inserted by hand; a template in the Trash has none |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active; purged after the retention period (`CLEANUP_TABLES`) |

`core-sigil` is seeded with the three sigil blocks (`sigilBlockSet()` in `lib/blocks/sigil.ts`), assigned to Operations × Sigils, and `core-altar` with an altar block on a dark night and a text block (`altarBlockSet()` in `lib/blocks/canvas.ts`), assigned to Operations × Altars; otherwise each is an ordinary row — editable, deletable, reassignable. `templateStore`, not the database, enforces "at most one template per combination" among *active* templates (`assignTemplate`); deleting a template clears its assignments, so it comes back without them. Older blocks may still carry `data-block-origin`, `data-block-rev` and `data-template-origin`, which nothing reads. An `isDefault: false` in older data only offered a template for selection and is dropped by `parseAssignments`. A dangling category id in `assignments` has no foreign key to stop it (see [What foreign keys cannot cover](#what-foreign-keys-cannot-cover)) — `checkIntegrity` reports it.

### languages

The Lexicon's languages, each with its alphabet here and its words in [`lexicon_entries`](#lexicon_entries). Nothing outside the module references a language and a language references nothing.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | NOT NULL |
| icon | TEXT | emoji or image, NOT NULL DEFAULT `'🗣️'` (`DEFAULT_LANGUAGE_ICON`) |
| alphabet | TEXT | JSON array of `{from, to}`, NOT NULL DEFAULT `'[]'` — the transliteration table, read by `parseAlphabet` in `src/lib/lexicon.ts`. `from` may be several characters (`th` → `ᚦ`); the longest match wins |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active; purged after the retention period (`CLEANUP_TABLES`) |

### images

The details of pictures in "Images", the place of their own next to tags and categories. A row gives a stored file a name, tags and a note; every other file of the vault's `images/` folder is listed too, unnamed, when a text, a field, a canvas or a block default shows it (`isShownUse`). A file used only as a drawing, a canvas's render or a background is not, nor one nothing shows (such as a render left behind while painting): the image cleanup takes those. Where a picture is used comes from `collectImageUses` (`src/lib/imageUsage.ts`), which reads the block stacks of entries and templates, the custom blocks' defaults and the canvases' backgrounds; `withoutImage` takes a picture out of a block stack's texts and image fields, as deleting one asks for. A row keeps its file from the image cleanup (`collectUsedImageFilenames`), in the trash too, until it is deleted for good; every picture taken in from the disk (the add dialog, the picture picker, a drop on a canvas) gets one through `takeIn` in `imageStore.ts`, which keeps the name of a row already there for that file and adds the tags; a row in the trash comes back with `detached` emptied, since the picture is taken in anew rather than restored into its texts.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| file | TEXT | NOT NULL UNIQUE — the stored file name (`storedImageName`); one row per file |
| name | TEXT | NOT NULL DEFAULT `''` — a picture added from the disk starts with the file's name without its extension |
| note | TEXT | NOT NULL DEFAULT `''` |
| tags | TEXT | JSON array of tag ids, NOT NULL DEFAULT `'[]'`; in `TAG_REF_TABLES` (`src/lib/tagRefs.ts`) |
| detached | TEXT | JSON array, NOT NULL DEFAULT `'[]'` — while the picture is in the trash, the entries and templates it was taken out of, each with its content before and after; restoring it writes `before` back where the content is still `after` (`restorePicture` in `src/store/imageActions.ts`), so the image cleanup keeps every file named in it. Not carried into another vault by a backup |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active; its file is hidden from "Images" meanwhile. Deleted for good from the Trash, the file goes too where nothing else uses it (`removeUnusedFiles` in `imageStore.ts`); purged after the retention period (`CLEANUP_TABLES`), the file is left to the cleanup |

### lexicon_entries

The words of a language. `ON DELETE CASCADE` on `language_id` means permanently deleting a language takes its words along — from the trash view, "Empty trash" and the retention purge, which lists `languages` and never this table. There is no `deleted_at`: deleting a word is immediate, with an undo toast that writes the same row back under its own id (`lexiconStore`'s `deleteEntry`/`restoreEntry`) — single vocabulary rows in the Trash would be noise.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| language_id | TEXT | NOT NULL, **FK → languages.id**, CASCADE |
| term | TEXT | NOT NULL DEFAULT `''`; the word in the language |
| translation | TEXT | NOT NULL DEFAULT `''`; what it means in your own tongue |
| pronunciation | TEXT | NOT NULL DEFAULT `''` |
| note | TEXT | NOT NULL DEFAULT `''` |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at / updated_at | TEXT | ISO 8601 |

How words are matched when translating lives in `src/lib/lexicon.ts` — see [Lexicon](architecture/modules.md#lexicon).

### symbols

The vault's own symbols for the canvas editor's library, made from drawings. An element on a canvas keeps its own copy of the path data, so removing a symbol here changes nothing already placed. There is no `deleted_at`: removing one is immediate, with an undo toast that writes the same row back (`symbolStore`'s `removeSymbol`/`restoreSymbol`). Rows are read through `readUserSymbol` (`src/lib/userSymbols.ts`), which drops one without an id or usable path data.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID; in the library `own.<id>` |
| name | TEXT | NOT NULL DEFAULT `''`; at most 80 characters |
| d | TEXT | NOT NULL DEFAULT `''`; the lines, path data in a box of 100 × 100 (commands and numbers only, `isSymbolPath`) |
| solid | TEXT | NOT NULL DEFAULT `''`; the filled parts, in the same box |
| weight | REAL | NOT NULL DEFAULT 5; the lines' width in that box, 1–16 |
| created_at | TEXT | ISO 8601; the library lists the newest first |

### entries

Journal entries, wiki articles and operations in one table. What distinguishes them lives in their [blocks](#blocks); `type` only says which module the entry belongs to, so a type change is an `UPDATE`.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| type | TEXT | NOT NULL, `CHECK (type IN ('journal','wiki','operation'))` |
| title | TEXT | NOT NULL DEFAULT `''`; empty for a new entry — see "Titles" under [Key Conventions](#key-conventions) |
| category_id | TEXT | nullable **FK → categories.id**, RESTRICT; `NULL` = no category (the default). A journal entry is **always** `NULL` |
| entry_number | INTEGER | stable per row, counted **per type** — see [Key Conventions](#key-conventions) |
| icon / cover_image | TEXT | data-URL, or emoji for icon — see the Base64 note under [Key Conventions](#key-conventions) |
| tags | TEXT | NOT NULL DEFAULT `'[]'`; JSON array of tag **ids** — see [tags](#tags) |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Indexes: `idx_entries_type` on `(type, deleted_at)` (every module loads its live entries that way), `idx_entries_category`, `idx_entries_list` on `(deleted_at, type, title, category_id, entry_number, tags, created_at, updated_at, id)` and the partial `idx_entries_decorated` on `deleted_at` `WHERE icon IS NOT NULL OR cover_image IS NOT NULL`. `idx_entries_list` answers the start-up list query (`fetchEntries`, first stage) and the tag sweep on open from the index alone; icon and cover can be data URLs and stay out of it, the few entries carrying one are found through `idx_entries_decorated`, which a query only uses with that exact condition in its WHERE.

### blocks

The blocks of entries and templates, one row each. An entry or a template is the owner; the row is its block as `BlockInstance` holds it, without the section around it (`toBlockRow`/`fromBlockRow` in `src/lib/blocks/blockRows.ts`).

| Column | Type | Notes |
|---|---|---|
| row_id | INTEGER PK | the row's key; block IDs are unique per owner only (a duplicated entry, a template saved from an entry and a merge import keep them) |
| id | TEXT | NOT NULL; the block's ID (`data-block-id`) |
| entry_id | TEXT | **FK → entries.id**, CASCADE |
| template_id | TEXT | **FK → templates.id**, CASCADE; exactly one of the two is set (`CHECK`) |
| position | TEXT | NOT NULL; sorts as a string (`lib/blocks/position.ts`): base-62 fraction digits, so a key fits between any two and moving or inserting a block writes that one row |
| type | TEXT | NOT NULL; `core.text`, `core.fields`, … or a type this version does not know |
| version | INTEGER | `data-block-v`; NULL = absent (version 1) |
| hidden | INTEGER | NOT NULL DEFAULT 0; `data-block-hidden="1"` |
| title | TEXT | `data-block-title`; NULL = absent |
| show_title | INTEGER | `data-block-show-title` (`1`/`0`); NULL = the type's default |
| config / data | TEXT | the block's JSON as written (`data-block-config`/`-data`), NULL when absent; field values sit in `data` by element ID, for filters through SQLite's JSON functions |
| attrs | TEXT | NOT NULL DEFAULT `'{}'`; JSON object of every other `data-*` attribute, in order — older copies' `data-block-origin`, a newer type's own, and an instance attribute whose value the app does not write that way (`hidden="0"`) |
| html | TEXT | NOT NULL DEFAULT `''`; the inner HTML. For now every type keeps it, the pictures a canvas or drawing lists included, so the block HTML of `.emerald` files and sync can be written from the rows; a backup carries it as it is |
| text | TEXT | NOT NULL DEFAULT `''`; plain text, written for a later search over the rows — the search reads the stores' in-memory content today (see below) — without a DOM (`blockPlainText`): tags gone, block elements and chips as word boundaries; empty for a canvas and a drawing. A concealed sigil's text is in it — concealing depends on the date |
| updated_at | TEXT | NOT NULL; ISO 8601, when the block was last written by a save that changed it (a move does not count). A rebuild from a whole block stack (sync, a seed) writes all of its owner's blocks anew, with new positions and this stamp; a backup restores each block with its own position and stamp |

`UNIQUE (entry_id, id)` and `UNIQUE (template_id, id)` (NULL is distinct, so each covers only its owner kind); indexes `idx_blocks_entry` and `idx_blocks_template` on `(owner, position)`.

**Writing (`src/lib/blockStore.ts`).** The stores keep an owner's blocks in memory as one string, `content` (`contentOf`: the block HTML of `serializeBlocks`, loaded from the rows). The stores (`createEntry`, `updateEntry`, `createTemplate`, `updateTemplate`), `entryTypeChange` and "Images" write through `planContentWrite` (that string → blocks → `planBlockWrite`), which compares the blocks to what was last saved (kept per owner in memory, read from the rows when missing, forgotten with `resetDbCache`/`markDbReplaced`) and write only blocks that are new, changed or moved (a move writes `position` alone), delete removed ones, and rewrite each written block's [block_refs](#block_refs) (`planBlockWrite`). A keystroke thus writes its own block. A single plain text block carries no ID in `content` (`serializeBlocks`, rule 2); it keeps the ID it was saved under (`blocksOfContent`).

**Whole stacks.** A path that has a whole block stack and nothing saved to compare with — sync, the seeded templates of a fresh vault (`insertTemplateRow` in `templateRows.ts`), the MCP seed — replaces the owner's rows in its own batch (`replaceOwnerBlocks`). `serializeBlocks` writes the instance attributes in a fixed order (`orderedBlockAttrs`), so the same block written from its row or from the stack is the same string. The `entries` and `templates` tables have no `content` column; a backup brings the rows themselves (`copyBlockStatements`: each block with its position and `updated_at`, its references written from it; see [Import](#import)). A backup import and a sync restore (`beginRestore`) forget what was saved (`clearSavedBlocks`).

**Asking for field values.** `lib/blocks/blockQuery.ts` (`entriesWithFieldValue`, `fieldValueSql`) finds the entries whose fields block holds a value — equals, contains, empty, not empty — through `json_extract` on `blocks.data` (`$.values."<element id>"`), the first piece of filtering by block values. Element IDs are checked, never quoted into the path as given. Text, link and image elements keep their values as markup in the slots and are not reached that way.

### block_refs

What a block points at, rewritten whenever its block is written (`blockRefs` in `src/lib/blocks/blockRefs.ts`).

| Column | Type | Notes |
|---|---|---|
| block_row | INTEGER | NOT NULL, **FK → blocks.row_id**, CASCADE |
| target_kind | TEXT | NOT NULL, `'entry'` or `'image'` |
| target | TEXT | NOT NULL; the entry's ID, or the picture's stored file name |
| role | TEXT | NOT NULL; `content` (a chip, a picture in a text, an image field, a picture on a canvas), `render` (a canvas's or drawing's rendered picture), `layer` (a drawing layer's picture), `background` (a canvas's background), `default` (a custom block's prefill) |

`PRIMARY KEY (block_row, target_kind, target, role)` — with a `rowid`, since re-encrypting a vault renames pictures in every table by it (`reencrypt.rs`); `idx_block_refs_target` on `(target_kind, target)` answers "who points at this". A drawing without a vector document has its render as its only layer, as `parseDrawing` reads it. Who reads it: "Images" (`collectImageUses` in `imageUsage.ts`, whose roles are these — `render` and `layer` are the drawing itself, not pictures of their own, so "Images" neither lists nor removes them), the image cleanup (`collectUsedImageFilenames`, every role, the trash included — and, since deleting a file is for good, every image name in the rows of `blocks` as well, so a block `blockRefs` cannot fully read keeps its pictures), and a type change, which finds the entries and templates whose chips point at the entry (`entryTypeChange.ts`). "Linked entries" and the search read the open stores instead: they must see what is being typed.

### Moon phase

Not stored — derived from a journal entry's `created_at`; see [Moon Phase](architecture/modules.md#moon-phase).

### tasks

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | empty for a new task (the DDL default `'Untitled Task'` is never used — see "Titles" under [Key Conventions](#key-conventions)) |
| category_id | TEXT | nullable **FK → categories.id**, RESTRICT; `NULL` = no category (the default) |
| parent_task_id | TEXT | **FK → tasks.id**, SET NULL |
| priority | TEXT | `'low'` \| `'medium'` \| `'high'`, default `'medium'` |
| completed | INTEGER | boolean 0/1 |
| completed_at | TEXT | unused — the code neither writes nor reads it |
| sort_order | INTEGER | NOT NULL DEFAULT 0; unused — tasks sort by `created_at` |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Tasks have no `entry_number` and no tags.

The self-reference makes insert order matter: a child inserted before its parent violates the foreign key. `insertTasks` in `dbBackup.ts` inserts with `parent_task_id` NULL and fills it in afterwards.

A creation call site that omits `category_id` leaves the row without a category — the state it is meant to start in, in both categorized tables.

### task_links

Links a task to a journal entry, wiki article, operation or another task. `target_id` is polymorphic — no foreign key possible (see [What foreign keys cannot cover](#what-foreign-keys-cannot-cover)).

A task in the Trash keeps its rows, so restoring it brings its links back; `taskStore` loads only the links of tasks outside the Trash. They go when the task is deleted for good (`ON DELETE CASCADE`).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| task_id | TEXT | NOT NULL, **FK → tasks.id**, CASCADE |
| target_id | TEXT | NOT NULL; polymorphic |
| target_type | TEXT | NOT NULL; `'journal'` \| `'wiki'` \| `'operation'` \| `'task'` |

`UNIQUE (task_id, target_id, target_type)`.

## Indexes

Declared in `INDEX_DDL` in `schema.ts`: one on every foreign-key column, one on each side of `task_links`, one on every `deleted_at` column (for `entries` the leading column of `idx_entries_list`), `idx_entries_type` on `entries(type, deleted_at)`, the list indexes `idx_entries_list` and `idx_entries_decorated` — see [entries](#entries) — and the block indexes (an owner's blocks in order, references by target) — see [blocks](#blocks).

The `deleted_at` indexes matter because `runPeriodicCleanup` runs a range scan across every soft-delete table each time a vault is opened.

## Key Conventions

**Reading and writing rows.** `src/lib/row.ts` is the only place that converts between SQLite rows and the types in `src/types`. Read with `fromRow.*`, write with `toInt` and `toJson`. SQLite has neither booleans nor arrays: booleans come back as `0`/`1`, arrays as JSON text.

**tags field.** `tags` on entries and templates is a JSON array of tag **ids**. The ids of trashed tags stay in the list and are simply not shown (`visibleTags`); exports (`.emerald`, Markdown, HTML) write names (`liveTagNames`), and imports map names back to ids. Tasks carry no tags.

**entry_number.** A stable, compact, human-readable number, shown in the link picker as `#12`. `nextEntryNumber(db, type)` in `db.ts` assigns it at insert time, counting per `type` (journal #1 and wiki #1 can coexist) and including trashed rows, so a restored entry never duplicates a number. It is a stored value, never derived from `ROWID`, so a replace import cannot shift it. A type change gives the entry a fresh number in the target type — or its former one when it returns to the type it had when editing began (by Cancel, or by switching back by hand), unless another entry of that type has taken it meanwhile (see [Cancel after a type change](architecture/editing.md#cancel-after-a-type-change)).

**Titles.** A new entry or task is stored with an **empty** title. What the user sees is `displayTitle(t, type, title)` from `src/lib/entryTitle.ts`: the title if it has text, otherwise the translated "Untitled …" of that type — in lists, cards, tabs, search, the Trash, link chips and pickers, task links and exports. `hasOwnTitle(title)` is the one test for "has a title of its own"; nothing compares against a magic string. The one exception is where data comes in: a `.emerald` or Markdown import reads the app-language "Untitled …" a Markdown/PDF export writes for an empty title as no title. The DDL default of `tasks.title` still says `'Untitled Task'`, but no insert relies on it.

**Timestamps.** ISO 8601 text produced by `nowIso()`, sorted and compared lexicographically. No column holds a date-only value; dates inside blocks are `YYYY-MM-DD`.

**`updated_at` means "last changed by you".** It moves only when someone changes that very row. The store update methods (`updateEntry`, `updateTask`, `updateTemplate`) take `{ touch }` from `src/lib/stamp.ts`:

- `true` (the default) stamps now;
- `false` keeps the stamp for writes that are a consequence of something elsewhere (a tag id stripped from or merged into a list);
- a timestamp sets exactly that one (Cancel puts back the stamp from before editing).

A patch that changes nothing is not written at all (`needsWrite`). Checking a checklist item in read mode is a change and does stamp. Ticking a task stamps that task only; its subtasks change along without a new stamp, and ones already in that state are not written. An imported entry's `updated_at` is its creation date (the file knows no other), so an old operation does not jump to the top of a list sorted by last change.

**Base64 in SQLite.** The rule is to keep image data in files (see [Rules for Future Schema Changes](#rules-for-future-schema-changes)). Two columns hold data-URLs instead — the `legacy` group of `IMAGE_FIELDS` in `schema.ts`: `entries.icon` / `cover_image`. `Favicon.tsx` (via `readIconFile` in `lib/imageLimits.ts`) and `MediaPropertyRow` (`EditProperties.tsx`) read the uploaded file with the shared `readFileAsDataUrl` helper (`lib/helpers.ts`); none of them go through `save_image`. Consumers test the value with `isImageIcon` / `startsWith('data:image/')`. Do not add more.

## Sigil Workflow

A sigil is not a kind of row but three blocks of an entry (`src/lib/blocks/sigil.ts`), in any category; a new operation in `sigils` starts with them via the built-in `core-sigil` template (see [templates](#templates)). Calculator and charge are fields blocks with that one element (element IDs `calc` and `charge`), the drawing a paint block marked as a sigil drawing — the same three exist as parts of a user-built block:

1. **Calculator** (element kind `sigilCalc`) — the intention, the letter bank (each letter once) and the letters already implemented, as the element's value in `data-block-data`, the readable version in its slot.
2. **Drawing** (`core.paint` with `data-block-config='{"sigil":true}'`, or element kind `sigilCanvas`) — the vector strokes as data JSON (`data-block-data`, layers of strokes, see [Editors](architecture/editors.md#canvas-editor)), and as inner HTML the rendered image first (`<img src="{sha}.png" data-paint="render">`), then the image of every layer that has one (`data-paint="<layer ID>"`), so backups, exports and the image cleanup see them. A block whose first image is not marked as the render (one from before the vector format) opens with that image as its only layer. No base64 in content; rendered images saved while drawing become unused files that "Delete unused images" removes.
3. **Charge** (element kind `sigilCharge`) — `loaded`, `revealDate`, `lock` and `targets` (`entry` — the whole entry — or `sigil` — only calculator and drawing) as JSON; the charging technique as a real link chip in the markup, so the "Linked entries" field and import remapping see it.

The entry's state comes from the charges (`sigilState`). A charge's `targets` are unit IDs — `<block ID>:<element ID>` for a calculator or drawing part, the block ID for a sigil drawing — or absent for every calculator and drawing of the entry. An unmarked paint block is never a target. Charged and before the reveal date, the sigil is *concealed*: calculator and drawing hidden in both modes, left out of search and every export. Charged, it is *locked* in any entry type: `lock: 'entry'` hides Edit and blocks read-mode writes except unloading, `'sigil'` makes the two blocks read-only; date and lock scope are fixed while charged.

## Image Storage

Handled natively in `src-tauri/src/images.rs`. Images live in `{vaultDir}/images/`, sealed, and are named after a keyed hash of their own bytes (HMAC under a key derived from the vault key), so the same image is stored once per vault however many entries reference it. The plain SHA-256 would let anyone holding a known picture confirm it is in the vault.

**The database stores the bare filename** — `{hash}.{ext}` (64 hex digits), no directory and no drive letter. Rendering goes through the `emerald-img` URI scheme rather than IPC; the details are in [Image Storage System](architecture/storage.md#image-storage-system).

The image commands (`save_image`, `copy_image_file`, `read_image_as_base64`, `list_image_files`, `delete_image_files`) are listed in [IPC Command Surface](architecture.md#ipc-command-surface).

## Multi-Vault System

A vault is a **directory** holding `emerald.db` (SQLCipher), `vault.key`, `images/`, `backup/`, `settings.json` (the vault's own settings, read and written by `read_vault_settings`/`write_vault_settings`) and, while a block or template page holds unsaved edits, `drafts.json`. Vault metadata lives outside SQLite in `{appDataDir}/vaults.json`. The directory layout, `vaults.json`'s shape, first-launch behaviour and the default location for new vaults are described in [Vault Layout](architecture/storage.md#vault-layout); what matters for the database:

- `getDb()` opens the database by vault id (`Database.load(vaultId)` in `src/lib/sqlite.ts`); Rust resolves the path, so folder names with `?`, `#` or `%` need no encoding. It throws `NO_ACTIVE_VAULT` rather than fall back to another vault, and Rust refuses to open a vault whose key is not unlocked — the gate in front of `getDb()` is described in [`architecture/encryption.md`](architecture/encryption.md#the-unlock-gate). All data is encrypted at rest; there is no unencrypted database.
- Every write to `vaults.json` calls `register_vaults`, mirroring `id → path` into Rust. Storage commands resolve a vault *id* against that registry and never accept a path — see [`security.md`](security.md).
- `resetDbCache()` in `db.ts` must be called before switching vaults; it clears the per-vault `Map<vaultId, Database>` cache and advances `dbEpoch()`, by which a reader spanning several awaits (the automatic backup) notices that the database was closed or — `markDbReplaced()` after an import — replaced under it. It first awaits any load still in flight: `getDb()` only caches a connection once `Database.load` resolves, so a reset racing a load could otherwise leak that connection unclosed, keeping the file locked on Windows.
- `withDbClosed(fn)` runs `fn` with every connection closed and blocks `getDb()` for its duration (throwing `DB_CLOSED`); vault deletion uses it so a debounced autosave can't reopen the very file being removed.
- `runMigrations()` runs whenever `openVaultDb` loads a vault that is not cached yet, and is safe on existing and empty files (see [Opening a Vault](#opening-a-vault)). A new vault's `.db` file is only written the first time the app switches to it, which is why `newVaultRecord(name)` does not create it up front. All vaults share the same schema.
- `newVaultRecord(name, opts?)` in `vaultManager.ts` is the single place that builds a new vault's record; the vault picker (see [Vaults](features.md#vaults)) and the add-vault import both use it. `addVault`/`updateVault`/`removeVault`/`setActiveVaultId`/`relocateVault` read-modify-write `vaults.json` by copying, never mutating the cached object before the write lands. `removeVault` hands off the active role in the same write that removes the record, so `vaults.json` never names an active vault missing from its own list.

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported and imported via Settings → Backup. The code is `src/lib/dbBackup.ts` for the content and `src-tauri/src/backup.rs` for the encrypted container.

**File format** — self-contained JSON, sealed in the container described below:

```json
{
  "version": "15",
  "type": "backup",
  "exportedAt": "2026-04-18T...",
  "filters": { "includeJournal": true, "includeWiki": true, "..." : "..." },
  "data": {
    "entries": [], "tags": [],
    "templates": [], "blocks": [],
    "tasks": [], "taskLinks": [],
    "categories": [],
    "blockDefinitions": [],
    "languages": [], "lexiconEntries": []
  },
  "images": { "3f2a….png": "data:image/png;base64,..." },
  "settings": { "version": 1, "appearance": { "…": "…" }, "trash": { "…": "…" }, "…": "…" }
}
```

**Settings.** `settings` is an optional top-level field, outside `data` and not gated by `BACKUP_VERSION`, since it is independent of every date and type filter. Export writes the vault's current settings when `includeSettings` is ticked. Replace import applies them outright (`replaceSettings`); add-vault writes them into the new vault before switching to it, so it opens with the backup's language and appearance; Merge applies only the settings groups picked in the import dialog (`withSettingsGroups(current, incoming, groups)` in `vaultSettings.ts`), so merging a backup from elsewhere doesn't overwrite local settings nobody asked to change. A file without `settings` leaves the target's settings untouched. Reading them goes through `importableSettings()`, which discards any key the current build doesn't recognise.

**Container.** On disk the JSON is sealed under the vault key and prefixed with a copy of the vault's `vault.key`, so the file opens with the password (or recovery key) the vault had when the backup was made, even after a later password change and on another machine. Layout, and how a backup is opened, are in [Encrypted backups](architecture/encryption.md#encrypted-backups). The container is not part of the backup version: a file without it is plain JSON of the same format, and still imports.

### Backup versions

`BACKUP_VERSION` is `"15"`: journal entries, wiki articles and operations in one `data.entries` array, each row with `type`; the blocks of the exported entries and of the templates as the rows of [blocks](#blocks) in `data.blocks` (without `row_id` and `text`; entries and templates carry no `content`); the rows of [images](#images) in `data.vaultImages`, their files in `images`.

Only this version is read. `readBackupPayload` compares numerically (a string compare would think `"10"` older than `"4"`) before anything is touched: a file below `"15"` comes from before the fresh start and is refused with `BACKUP_OUTDATED` (`settings.importErrorOldVersion`), a newer one with `BACKUP_TOO_NEW` (`settings.importErrorNewVersion`). Nothing is converted, and the vault stays as it was. A current file is then split into journal, wiki and operation arrays (`splitEntries`; unknown `type` dropped), so the import paths work on three arrays; `entryRowsForInsert` projects them back onto `entries`, de-duplicating ids (journal, wiki, operation wins).

The version is bumped whenever an older build would otherwise import a file *wrongly* rather than fail: `insertRows` filters every row against `PRAGMA table_info` (to guard against crafted files), so an older build would silently drop a column it doesn't know.

### Export

`buildBackup(options)` builds the payload; `exportDatabase()` wraps it for the manual export, and the automatic backup calls it with `FULL_BACKUP_OPTIONS` (every module, the Trash and settings, no date range) — see [Automatic Backup](architecture/storage.md#automatic-backup). A `category_id` whose category is missing from the categories list read in the same run is exported as `null`: deleting or merging a category runs over several statements, and a payload caught in between would be refused on import.

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Tasks / Tags / Lexicon`, `dateFrom`, `dateTo`, `includeDeleted`, `includeSettings`. There is no templates toggle, and no altars toggle: altars are operations. The six content-type keys and their labels are `CONTENT_TYPES` in `dbBackup.ts`, shared by the export and the import page.

- Entries and tasks are date-filtered on `created_at`. Entries are one `SELECT` with a `type` filter for the ticked kinds.
- The "library" tables travel complete, trashed rows included and without a date filter: `categories` (whenever any of Journal, Wiki, Operations or Tasks is ticked — trashed categories too, or their exported content could not be restored), `block_definitions` and `templates` (whenever Journal, Wiki or Operations is ticked, since a template's assignments can reference any of the three), `languages` and `lexicon_entries` (with `includeLexicon`; a word is nothing without its language).
- `symbols` travels complete in every backup, whatever is ticked; the import adds the ones missing by id (`INSERT OR IGNORE`, on replace too), so none is ever removed by an import.
- `includeDeleted` applies to entries, tasks and `tags` — a trashed tag travels with the Trash, since the trashed entries carrying its id come along too.
- `task_links` is scoped to the exported task ids.
- `blocks` is scoped to the exported entries and templates (`exportBlockRows`). `block_refs` does not travel: the import writes it from the blocks. The pictures of the blocks are taken from the blocks themselves (`blockRefs`) plus every stored name anywhere in the row, so a picture that only stands in a block's JSON — a copy's image prefill — travels too, and a block `blockRefs` cannot fully read keeps its pictures.

ID lists for `IN (...)` clauses are bound as parameters, never concatenated into the SQL string. The ids are not necessarily app-generated — an import takes them verbatim from the file — and sqlx splits a statement on `;`, so concatenating them would let a crafted backup run arbitrary SQL during a later export.

### Import

**Opening the file** asks for a secret only when no unlocked vault's key fits the backup. Everything below runs on the decrypted JSON.

**The import runs against a staging copy of the vault, never the vault itself** (`importViaStaging` in `src/lib/importStaging.ts`). `doReplace` and `doMerge` write over many separate statements, built from reads in between, which a transaction cannot wrap — `batch` covers only a prepared list (see [Foreign Keys](#foreign-keys)) — so they write into a copy:

1. Discard any copy a crashed import left behind — `discard_import_staging(vaultId)` in `vault.rs`, scoped to that vault's directory and the fixed filename `emerald.db.import` (`IMPORT_STAGING_FILE`, mirrored in `vaultManager.ts`).
2. `VACUUM INTO` that filename, next to `emerald.db`.
3. Open the copy as its own connection (`Database.load(vaultId, 'importStaging')`, keyed like the vault) and run `doReplace`/`doMerge` against it. The live vault is untouched, however far the import gets. The file brings its blocks as rows: after their owners, `insertImportedBlocks` writes the blocks of every owner the import actually inserted (an entry the type filter left out, or a template that already existed here, gets none), each through `remapBlock` (`lib/blocks/blockRemap.ts`: the pictures under the names they were stored under here, and on a merge every chip's `data-id` and every ID in the config and data JSON — a link prefill, an altar's links — onto the prefixed entry) and `copyBlockStatements` (its position and `updated_at` kept, its [block_refs](#block_refs) written from it; positions that are not valid keys in ascending order are replaced by fresh ones in the file's order).
4. Swap the copy in with one multi-statement `execute()` on the vault's connection: `ATTACH DATABASE`, `BEGIN IMMEDIATE`, `PRAGMA defer_foreign_keys = ON` (the vault is briefly empty mid-swap), `DELETE FROM` every table in `TABLES` except `schema_version` (children first), `INSERT INTO … SELECT` with explicit columns (parents first), `COMMIT`, `DETACH DATABASE`. One `execute()` stays on one pooled connection, so this is a real transaction that survives a crash. If the string aborts after `BEGIN`, `resetDbCache()` closes the whole pool, which makes SQLite roll back and detach — the connection would otherwise sit in the pool with an open transaction and lock every later write.
5. Delete the staging copy, on success and on failure.

A failure in steps 1–4 leaves the vault exactly as it was. The database briefly exists twice on disk — worth knowing on a nearly-full disk. Images are written straight into the vault's `images/` (content-addressed, so a repeat write is a no-op); an aborted import leaves them unused until the *Unused images* cleanup finds them.

All three modes go through `importViaStaging`, and automatic editor saves are suspended for the whole import in all three: every mode ends in the swap, which would discard a save made between the copy and the swap.

**Import modes:**

| Mode | Behaviour |
|---|---|
| `replace` | Deletes only what the backup has data for (partial-backup-safe) — `entries` per present type plus every imported id (an id may sit under another type locally), tasks and links only if it carries tasks — then inserts. `tags`, `categories`, `block_definitions`, `templates` and the Lexicon are never wiped; they are resolved or *added to* (see below). |
| `merge` | Generates an 8-char base36 timestamp prefix. All entry ids are prefixed; cross-references are remapped. `entry_number` is offset past the highest existing one **per type**, since it is a stored value and would otherwise collide. `categories` and `tags` are resolved, not prefixed. |
| `add-vault` | Creates a new vault → `switchVault()` → runs the replace logic against the empty vault. |

There is no category filter on import — the type ticks (`ImportTypeFilters`) are the only selection, plus the settings groups for Merge. Both `doReplace` and `doMerge` finish with `sweepDanglingTaskLinks` and `dropUnknownTagIds`.

**Before anything is written**, `assertPayloadReferencesResolve` checks that every category a payload references exists — in the file, or among the target vault's own categories (an import never deletes those). It rejects an unresolvable payload with a message that names the category; the staging copy is what protects the vault.

**Rows are inserted parents-first**; foreign keys are active during import. The order is hard-coded per import path (`doReplace` and `doMerge` each have their own) and does *not* follow `TABLES`.

**Categories are resolved, never deleted** — `resolveImportedCategories`. A category matches a local one by id (for the built-in) or by case-insensitive name (`categoryKey`); a match is revived from the trash if the local row is trashed and the imported one active. Anything left over is inserted, with a new id if the payload's id is taken. The content arrays are then remapped onto the local ids. A category is shared across modules, so a partial replace (Wiki only, say) must not delete categories out from under Tasks.

**Tags are resolved the same way, never deleted** — `importTagsAndRemap`, before anything else is written. A tag with a local tag's id is that tag; otherwise a case-insensitive name match (`tagNameKey`) maps it onto the local tag — a trashed local namesake is revived if the imported one is live, after its id is stripped from the rows still carrying it (the same rule as typing the name, see [Tags](architecture/modules.md#tags)). Anything left over is inserted with its own id, name trimmed to 100 characters and colour validated; rows without a valid id (`isTagId`) or name are skipped. In entry and template rows, an id the file has no tag row for (Tags unticked) survives only if that tag exists locally.

**Block definitions are added, never replaced or deleted** — `insertBlockDefinitions`, `INSERT OR IGNORE` by id without the merge prefix, so a block arriving twice stays one. It runs before `doReplace`'s first `DELETE` and normalises every row to the full column set (ids must pass `isDefinitionId`), so a malformed array in a crafted file can neither abort a half-done replace nor slip a partial row past `insertRows`, which takes its column list from the first row. A definition that exists locally (even trashed) keeps its local version.

A definition's prefills need their own remap, since nothing else touches `elements` JSON: `remapDefinitionRows`/`remapDefinitionDefaults` rewrite an image default onto the image's local filename and a link default onto the imported entry — by the merge prefix's new id in `doMerge`, by id-or-title (`resolveImportedTarget`, shared with the `.emerald` chip resolver) in replace and add-vault. A link default that resolves to nothing is dropped, so a fresh copy never starts with a chip into the void.

**Templates are added, never replaced or deleted** — `insertTemplates`, `INSERT OR IGNORE` by id, before the deletes in `doReplace` and after the merge prefix's remap in `doMerge`. A local template (including trashed) keeps its local version; new ones land at the end of the sort order. Their blocks go through `insertImportedBlocks`/`remapBlock` like an entry's, and only for templates that were actually inserted; `assignments`' category ids are remapped like content rows, and one that doesn't resolve is dropped. An assignment survives only if no local active template holds that combination; a template arriving via the trash has none, like `templateStore.restoreTemplate`.

A fresh vault (add-vault) seeds its own `core-sigil` and `core-altar` before the import runs. If the file carries its own `templates` and the import includes Journal, Wiki or Operations, those seeded rows are deleted first, so the file's version of them — edited, deleted or otherwise — wins.

**The Lexicon is added, never replaced or deleted** — `insertLexicon`, `INSERT OR IGNORE` by id; a word is inserted only when its language exists in the target vault, since `lexicon_entries.language_id` is a real foreign key.

### Image references

Images are restored via `save_image`, which returns the filename in the importing vault. A picture the vault already holds under the very name the file knew it by keeps that name (`restoreImages`): the name is a hash of the content, and saving again could spell the type differently (a `.jpeg` taken from the disk comes back as `.jpg`), which would leave it in "Images" twice. The remap covers the columns of `IMAGE_FIELDS` in `schema.ts` (via `imageColumns(table)`), the inventory shared by the importer and `collectUsedImageFilenames`. It groups the columns by how they must be treated:

| Group | Meaning | Rewritten on import | Cleanup scans |
|---|---|---|---|
| `html` | the reference sits in a `src` attribute | yes | yes |
| `plain` | the column *is* the reference | yes | yes |
| `legacy` | the column holds a data-URL | no | yes |

The `legacy` group is why the list has to be complete: `collectUsedImageFilenames` decides which file the cleanup may delete, so a missing column would be a reference nobody sees. Rewriting those columns would break their renderers, which test them with `isImageIcon` (only `data:` / `blob:` / `/`).

`IMAGE_FIELDS` lists `entries.icon` and `cover_image` (group `legacy`); the `html` and `plain` groups are empty and are where a new image column goes. The blocks are not in it: on import they are remapped by `remapBlock`, and in the vault `collectUsedImageFilenames` reads the pictures of every block, of entries and templates, from [block_refs](#block_refs), and every image name in the rows of `blocks` as well. `block_definitions.elements` is scanned directly too. All of their images travel with a `.emeralddb` export.

## Rules for Future Schema Changes

- **Change `schema.ts`, append a step to `MIGRATIONS` and raise `BASELINE_VERSION`.** All three, always. The DDL in `schema.ts` is what fresh vaults get; the step — a `version` above the current baseline, a `name` and an `up(db)` — is what vaults created before get. `BASELINE_VERSION` must equal the last step's version — `runMigrations` refuses to start otherwise. Steps are never removed or rewritten once released; a vault below `FRESH_START_VERSION` stays refused.
- **Run `npm run check:schema`.** It checks the fresh vault against `schema.ts` (tables, stamp, foreign keys, indexes), that old and newer vaults are refused unchanged, and that the migration mechanism runs an injected step; extend it with a vault at the previous baseline brought up by the new step and compared with a fresh one.
- **Constants mirrored across languages must change together.** The check compares the image-extension list, vault file names and the `emerald-img` scheme name across `images.rs`, `schema.ts`, `vault.rs`, `vaultManager.ts` and `tauri.conf.json`. Changing one side alone fails `check:schema`, not the compiler.
- Prefer additive changes. A rename or a type change means rebuilding the table inside one multi-statement `execute()` or `batch` (see [Foreign Keys](#foreign-keys)).
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` where the safe default is true). New array fields: `TEXT NOT NULL DEFAULT '[]'`.
- New references: name them `<thing>_id`, store the id and never the name, declare the foreign key, and index the column.
- New image-backed fields: reuse the file pipeline through `src/lib/images.ts` (`saveImage` / `copyImageFile`), store the returned **filename**, and add the column to the `plain` (or `html`) group of `IMAGE_FIELDS` in `schema.ts` so import and cleanup both see it. Do not store base64 in SQLite, and do not store a path.
- Never swallow errors in a migration step (`try { ALTER TABLE … } catch {}`) — steps must fail loudly.
- **`$N` placeholders must appear in ascending order in the SQL text.** SQLite treats `$N` as a *named* parameter and assigns bind indexes by order of first appearance, not by the digit — `SELECT $21, $23, $22` binds them as 1, 2, 3 (verified against the SQLite C API). `db.rs` binds the values array purely positionally, so a `$23` written before a `$22` silently swaps two values. Every query in this codebase works only because its placeholders ascend; reusing a placeholder (`WHERE id IN ($1, $3)`) is fine, skipping ahead is not.
- If a change alters the shape of exported rows so that an older build would import a file wrongly, bump `BACKUP_VERSION` in `dbBackup.ts` (see [Backup versions](#backup-versions)). `readBackupPayload` reads only the current version: older files are refused, not lifted, unless a converter for them is added deliberately.
