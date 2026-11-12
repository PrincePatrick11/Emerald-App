# Database

Emerald uses one SQLite file per vault, always named `emerald.db`, inside the vault's own directory. Where that directory sits is the user's choice — see [Multi-Vault System](#multi-vault-system) and [Vault Layout](architecture/storage.md#vault-layout).

## Where the schema lives

`src/lib/schema.ts` holds the complete, current schema as `CREATE TABLE` and `CREATE INDEX` strings (`TABLE_DDL`, `INDEX_DDL`). It is the reference: reading it tells you what the database looks like today, without replaying any history.

Several consumers share those strings, and that sharing is the point of the file:

- the **baseline path** in `runMigrations`, which fresh vaults take;
- the rebuild migrations **v38** `merge_category_tables` (`mergeCategoryTables.ts`) and **v39** `category_optional` (`nullableCategory.ts`), which rebuild existing vaults' tables against this DDL;
- the additive migrations, which create their table or index from the same constant.

Older migrations must keep building the shape they were written for, not today's. Two files freeze that history:

- `src/lib/schemaV37.ts` — the target shape of **v33** `normalize_schema` (`normalizeSchema.ts`): the tables that changed since v37 as their own DDL, everything else re-exported from `schema.ts`. It also holds the old built-in categories (`LEGACY_*_CATEGORIES`) that v36–v38 and old-file imports resolve against.
- `src/lib/schemaV65.ts` — `entries` and `templates` with their `content` column, as v43 and v49 create them; v66 drops the column.
- `src/lib/schemaV48.ts` — every table a later migration still reshaped, as it was before: `journal_entries`, `wiki_articles` and `operations` (before v49), `tasks`, `altar_items` and `tags` (before v50/v52/v53/v54), and the three altar tables as they stood until v63 dropped them (`ALTAR_TABLE_DDL`; the backup import also builds them in its working copy to convert an older file's altars). `ddlBeforeV49(table)` is what v33 (via `schemaV37`), v38 and v39 build from, falling back to `ALTAR_TABLE_DDL` for the altar tables; `IMAGE_FIELDS_V48` is what v35 walks; `TITLED_TABLES_V48` is what v48 clears. **Nothing in it may change.**

**Whoever changes a table in a later migration that v33, v38 or v39 also build must freeze its current DDL first** — otherwise those migrations silently start building the new shape on old vaults and then fail copying columns that no longer exist.

Indexes follow the same rule. v38 and v39 create `INDEX_DDL_V38` (split into `DROPPED` and `KEPT` lists, since v47, v49 and v63 drop some of those tables), not `INDEX_DDL`, because in the chain they run before later tables exist. A table added after them brings its own index constant (`BLOCK_DEFINITIONS_INDEX_DDL`, `TEMPLATES_INDEX_DDL`, `LEXICON_INDEX_DDL`, `ALTARS_INDEX_DDL`, `ENTRIES_INDEX_DDL`, `ALTAR_ITEMS_INDEX_DDL`, `IMAGES_INDEX_DDL`, `BLOCKS_INDEX_DDL`), which its migration creates and `INDEX_DDL` appends for fresh vaults — except those of the altar tables, which went with them in v63.

Because the baseline and the chain must produce the same schema, `npm run check:schema` (`scripts/schema-check.mjs`, needs `esbuild` from `devDependencies`) proves it: it builds a vault each way and compares `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list` and every index, table by table. It also covers the resume-after-crash paths of v33, v38 and v39, the seeded categories, the data migrations against seeded old rows, old-backup imports, and the constants mirrored across languages (see [Rules for Future Schema Changes](#rules-for-future-schema-changes)). Without that check, the two paths quietly diverge after a few releases and nobody notices until a user hits an error.

## Migration Model

`src/lib/db.ts` exports `getDb()`. The first caller loads the active vault's database and runs `runMigrations(db)`; later callers get the cached instance. The database uses `PRAGMA journal_mode = DELETE` (not WAL) for robustness across unclean shutdowns.

`runMigrations` takes one of two routes:

- **Fresh file** — no tables at all (checked in `sqlite_master`, not `schema_version`: a database old enough to predate the version table has tables but no version row and must run the chain). It runs the DDL from `schema.ts`, seeds the built-in categories, the starter categories and the `core-sigil` and `core-altar` templates — in the language active at first open, since `main.tsx` waits for the stored language before anything touches the database — and stamps one `baseline` row at `BASELINE_VERSION`.
- **Existing file** — the ordered `MIGRATIONS` array runs from the highest applied version upward, each step stamping `schema_version` with version, name and ISO timestamp. Every vault reaches the same schema as a fresh one; there is no cut-off past which an old database stops being upgradable.

`BASELINE_VERSION` in `schema.ts` must equal the last entry in `MIGRATIONS`; `runMigrations` throws at startup otherwise. The current version is **66**. **Version 24 does not exist** — the runner tolerates gaps and only requires each version to be above the last applied one. The three block migrations were first numbered v39–v41 on their development branch; `renumberBlockMigrations` restamps such a vault once by name and catches up on v39.

After the migrations, every open runs:

- `prune_migration_backups` (Rust), which keeps only the newest migration backup — see [Rebuilding a table](#rebuilding-a-table). A failure is logged, never a reason not to open the vault.
- `runPeriodicCleanup(db)`, which is **not** a migration — idempotent, time-dependent, and run on every open. It purges trashed rows older than the vault's trash retention (`trash.retentionDays` in `vaultSettings.ts`, default 30 days, or never). If the loaded settings belong to another vault it purges nothing (`null` = never), so one vault's retention can never empty another's trash. Expired tags are first stripped from every tag list (`stripTagIds`). Afterwards it sweeps dangling `task_links` and tag ids without a `tags` row (`sweepDanglingTagIds` — such an id can appear when a tag goes for good while a draft or an open entry still holds the old list and saves it later).

### Migrations since v33

Per-migration detail lives in the code and in `CHANGELOG.md`. In short:

| Version | Name | What it does |
|---|---|---|
| 33 | `normalize_schema` | Full rebuild onto the v37 shape; foreign keys, indexes, `entry_number` backfill, repairs v4's damage (below) |
| 34 | `operation_other_category` | Seeds a built-in `other` operation category |
| 35 | `vault_scoped_images` | Copies images into the vault's `images/` and reduces paths to filenames ([details](architecture/storage.md#migrating-an-older-installation)) |
| 36 | `journal_linked_ids_to_content` | Journal link columns → link chips in `content` |
| 37 | `journal_paradigm_bannung_meditation_to_content` | Journal paradigm/banishing/meditation fields → blocks |
| 38 | `merge_category_tables` | Four category tables → one `categories` |
| 39 | `category_optional` | `category_id` nullable; `other` becomes an ordinary category |
| 40 | `block_definitions` | Additive: user-built blocks |
| 41 | `operation_status_to_blocks` | Operation status/end date/version → a copy of the "Status" block |
| 42 | `sigils_to_blocks` | Sigil columns → sigil blocks ([Sigil Workflow](#sigil-workflow)) |
| 43 | `templates` | Additive: templates, seeds `core-sigil` |
| 44 | `routines_to_templates` | Every routine → an unassigned template with the same id; `routines` dropped |
| 45 | `lexicon` | Additive: `languages`, `lexicon_entries` |
| 46 | `altars_soft_delete` | Additive: `altars.deleted_at` |
| 47 | `drop_links` | Drops `links`; link chips in `content` are the only record |
| 48 | `untitled_is_empty` | English default titles → empty (`clearLegacyUntitledTitles`) |
| 49 | `unify_entries` | Journal, wiki and operations → one `entries` table ([entries](#entries)) |
| 50 | `drop_dead_columns` | Drops `tasks.tags`, `altars.intention` |
| 51 | `altar_settings` | Twelve altar display columns → JSON `settings` |
| 52 | `altar_items_soft_delete` | Additive: `altar_items.updated_at`/`deleted_at` |
| 53 | `tags_by_id` | Tag lists hold ids instead of names; `tags.affected_ids` dropped ([tags](#tags)) |
| 54 | `drop_unused_descriptions` | Drops `tasks.description`/`due_date`, `block_definitions.description`, `templates.description` |
| 55 | `entries_list_index` | `idx_entries_list` (the list columns) and the partial `idx_entries_decorated` replace `idx_entries_deleted` |
| 56 | `simple_copies_and_assignments` | Drops `block_definitions.revision`; `templates.assignments` keeps only what was a default, without the flag; trashed templates lose theirs |
| 57 | `altar_elements` | Additive: `altars.elements`, the drawn shapes and text as JSON |
| 58 | `altar_placement_groups` | Additive: `altar_placements.group_id`, the group a placement belongs to |
| 59 | `symbols` | New table: the vault's own symbols for the canvas editor ([symbols](#symbols)) |
| 60 | `images` | Additive: the `images` table ([images](#images)) and its `deleted_at` index |
| 61 | `altar_category_and_template` | Additive: the built-in category `altars` (appended to the list) and the `core-altar` template ([templates](#templates)) |
| 62 | `altars_to_operations` | Altars become operations of `altars` under their own IDs, items with a picture rows of [images](#images) tagged "Altar Library" (`altar-library`, or a tag of that name already there), chips, altar fields and task links point at the operations; the altar tables are emptied, not dropped (`migrateAltars.ts`, `altarConversion.ts`); a copy of the file first (`.pre-v62.bak`) |
| 63 | `drop_altar_tables` | Converts altar rows an older device synced in since v62 the same way, then drops `altars`, `altar_items` and `altar_placements` and deletes their rows from `_sync_log` (`dropAltarTables` in `migrateAltars.ts`); a copy of the file first (`.pre-v63.bak`) when there is something to convert |
| 64 | `sigil_blocks_to_fields_and_paint` | The sigil blocks `core.sigil.calc`/`.charge` become fields blocks with that one element, `core.sigil.canvas` a paint block marked as a sigil drawing, in entries and templates (trash included); charge targets follow (`convertLegacySigilsInPlace` in `migrateLegacySigils.ts`, converter in `lib/blocks/legacySigilBlocks.ts`, see [Sigil Workflow](#sigil-workflow)); a copy of the file first (`.pre-v64.bak`) when there is something to convert |
| 65 | `blocks_table` | New tables [blocks](#blocks) and [block_refs](#block_refs): every block of every entry and template (trash included) becomes a row, built from `content` by the block parser, with what it points at; `content` is normalised to what the rows give, `updated_at` untouched (`fillMissingBlockRows`, today in `contentColumn.ts`); a copy of the file first (`.pre-v65.bak`) when there is content. Repeatable: an owner is done the moment its batch is |
| 66 | `drop_content_columns` | `entries.content` and `templates.content` go: the [blocks](#blocks) rows are the only record. Every owner whose rows do not give its `content` (written by an older version or by sync since v65) is rebuilt from it first (`reconcileBlockRows` in `contentColumn.ts`); a copy of the file first (`.pre-v66.bak`). Repeatable |

Column drops go through `dropColumnsIfPresent` (`dbRebuild.ts`), which skips columns already gone, so they are repeatable. Where a migration converts data, the same converter also runs on rows from an older `.emeralddb` file at import time — see [DB Backup / Restore](#db-backup--restore-emeralddb).

### Rebuilding a table

SQLite can only change a column's type or constraints by rebuilding the table, and the usual twelve-step recipe is unavailable here (see [Foreign Keys](#foreign-keys)). v33, v38 and v39 therefore follow the ordering in `normalizeSchema.ts`'s header: undo a crashed run, snapshot, rename to `*_old`, create, copy parents before children, drop `*_old`, create indexes, `PRAGMA foreign_key_check`.

Two traps shape every rebuild after v33:

- **Renames repoint foreign keys.** `ALTER TABLE altar_items RENAME TO altar_items_old` repoints `altar_placements`' foreign key at `altar_items_old`, so dropping `altar_items_old` would cascade-delete every placement — the same for `tasks` ← `task_links`. v38 and v39 rebuild such parent/child pairs together: children renamed first (so both halves point at each other and vanish together), parents copied first, children dropped first.
- **Past a certain point, resuming must never roll back.** Once the new tables are filled, rolling back would `DROP TABLE tasks` on the finished table and cascade into the finished `task_links`. A marker in a real table (not `TEMP TABLE`, which is scoped to one pooled connection) records that point: `_category_id_map` with `src='_state', old_id='content_rebuilt'` for v38 (which also holds the old → new category id map), `_v39_content_rebuilt` for v39. Before the marker a resumed run starts over; after it, it only redoes cleanup, index creation and the foreign-key check.

v49 and v51 avoid the rename and need no marker: v49 copies per old table, skips ids already in `entries` and drops an old table only once every row is there; v51 adds `settings`, fills rows still at `'{}'`, then drops the old columns (a `DROP TABLE altars` would cascade into `altar_placements`).

Before v33, v38, v39, v42, v44, v49, v51, v53, v62, v63, v64, v65 and v66 rewrite anything (v42, v44, v62, v63, v64 and v65 only when there is something to convert), they write a full copy of the database via `VACUUM INTO` (`backupDatabaseFile` in `dbRebuild.ts`) to `{vaultDir}/emerald.db.pre-v33.bak`, `.pre-v38.bak` and so on — the escape hatch if a migration that rewrites every table goes wrong. On image-heavy vaults the file can be sizeable. `prune_migration_backups` keeps only the newest (what it may delete: [`security.md`](security.md#vault-directories-as-a-trust-boundary)).

### Frozen history, and why failures used to be swallowed

Migrations v1–v32 carry `legacy: true`. Only for those does the runner swallow "duplicate column name" / "already exists" errors and mark the step applied anyway (`isAlreadyAppliedError`).

That leniency is harmful: it aborts the **entire remaining body** of a migration and still records it as done. Migration v4 is the case in point — v1 already creates `altars` with `background_preset`, v4 opens with an `ALTER TABLE` for the same column, and everything after it (`altar_placements.altar_id`, the default-altar seeding) never runs. The emergency migrations v30 and v31 add the missing placement columns back; v33 repairs the rest, giving placements without a valid altar one and creating the default altar if the vault has none.

The historical migrations themselves stay untouched. Rewriting history is riskier than repairing its outcome, and existing vaults have already run them exactly as written.

**Migrations from v33 onward do not carry the flag and fail loudly.**

### Removing a feature does not mean editing its old migrations

Migration 1 still creates `custom_properties` and migration 11 still alters it — both untouched, because existing vaults applied them. The removal is a *new* migration, v32, which drops the table. v33 does the same for `creations` and `altar_intentions` (carrying `creations` rows over into operations first), v47 for `links`.

## Foreign Keys

Foreign keys are **enforced on every connection**: the SQL layer (`db.rs`) runs an sqlx pool, and sqlx sets `foreign_keys = ON` as a default pragma on each connection it opens. No application code turns them on. Each connection also gets `cache_size = -32768` (32 MB): SQLCipher decrypts a page whenever it enters the page cache, and with SQLite's default of 2 MB a scan over `entries` evicts its own pages, so every repeat decrypts everything again (repeat full scans run about six times faster with the larger cache). The pool is capped at 4 connections, since every connection has its own cache; memory is only used for pages actually read.

Two consequences shape how this schema is changed:

- A constraint takes effect the moment it is declared. There is no grace period.
- `PRAGMA foreign_keys = OFF` and `BEGIN` are **not usable across separate `execute()` calls** — each call reaches one pooled connection, and which one serves the next call is not controllable. That rules out the SQLite documentation's table-rebuild recipe (see [Rebuilding a table](#rebuilding-a-table)). A *single* call is different: sqlx runs the `;`-separated statements of one string in order on the one connection it picked, so one multi-statement `execute()` can hold a real `BEGIN … COMMIT`. `importStaging.ts`'s `swapIn` does this — see [DB Backup / Restore](#db-backup--restore-emeralddb). The other way is `Database.batch` (`db_batch` in `db.rs`): a list of statements with bound values, run as one transaction on one connection, all or none. Write loops use it; it cannot wrap a whole import, whose statements are built from reads in between.

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

The built-ins, `sigils` and `altars` (since v61), cannot be deleted: an operation in `sigils` is a sigil, and a new one starts with the sigil blocks through the built-in `core-sigil` template, assigned to Operations × Sigils; an operation in `altars` is an altar and starts with an altar block and a text for notes through `core-altar`.

## Tables

Fourteen tables. `TABLES` in `schema.ts` declares the dependency order, parents before children; the sections below group related tables. The order is not cosmetic: inserts are checked against foreign keys immediately, so it governs the rebuilds and the import swap.

### schema_version

Migration bookkeeping. No rebuild touches it, since it records the very migration being run.

| Column | Type | Notes |
|---|---|---|
| version | INTEGER PK | migration version, or `BASELINE_VERSION` for a fresh vault |
| name | TEXT | migration name, or `'baseline'` |
| applied_at | TEXT | ISO 8601 |

### tags

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT UNIQUE | unique across trashed rows too; a rename touches only this row |
| color | TEXT | hex, default `'#8347ff'` |
| deleted_at | TEXT | NULL = active |

`entries.tags` and `templates.tags` are JSON arrays of `tags.id` (`src/lib/tagRefs.ts`). A trashed tag stays in its rows, merely hidden, and comes back with its restore. Lists are rewritten only when a tag disappears for good (permanent delete, empty trash, retention purge — `stripTagIds`) or merges into a live namesake on restore (`replaceTagId`). Both go through `rewriteTagRefs`, which walks `TAGGED_TABLES` including the Trash and leaves `updated_at` alone. Tasks carry no tags.

**Converting names (v53 and pre-`"12"` backups).** `tagNameResolver` maps names to ids case-insensitively, a live tag winning over a trashed namesake; a name without a tag row gets a new tag rather than being lost; a value that already is a known id stays. A trashed tag is written back into every row its old `affected_ids` listed, unless the row meanwhile carries a namesake. v53 computes all new lists first, then inserts the missing tags, then writes the rows and drops `affected_ids` last, so it is repeatable without a transaction.

### categories

One list shared by Wiki, Operations and Tasks. Journal has no categories.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `'sigils'` for the built-in; on upgraded vaults the ids of former built-ins such as `'other'`; UUID otherwise |
| name | TEXT | NOT NULL; ignored for the built-in — its display name comes from `categories.builtin.<id>` in the active locale |
| emoji | TEXT | NOT NULL DEFAULT `'📁'` |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| is_builtin | INTEGER | boolean 0/1; true only for `sigils` |
| deleted_at | TEXT | NULL = active |

There is no `UNIQUE` on `name`: uniqueness is enforced by the store (`categoryKey`: trimmed, case-insensitive), because a `UNIQUE` index would block restoring a trashed category whenever an active one shares its name. `SIGIL_CATEGORY_ID` (`'sigils'`) is the one category with behaviour. `FALLBACK_CATEGORY_ID` (`'other'`) is used only by migrations v36–v39 and for lifting pre-`"4"` backups; nothing in the live app treats that row specially. A fresh vault also seeds eight ordinary starter categories (`STARTER_CATEGORIES`, named in the app's language at creation), freely renamable and deletable.

**Merging (v38 and pre-`"4"` backups).** `mergeCategoryRows` in `src/lib/categoryMerge.ts` merges by case-insensitive display name: same-named categories from different modules become one row, ids are kept where possible, `general` and every module's `other` collapse into one `other`, and an active/trashed pair comes out active. v39 then demotes `other` to an ordinary category, writing its translated name into the row (or keeping the old one if another category already claims that name).

### block_definitions

The user-built blocks of the Blocks view. A row is only the template — an inserted block is a **copy** inside the entry's `content` (a `core.fields` section carrying its own elements, display rules, name and icon, with no link back). Nothing references this table by foreign key, and deleting a row touches no entry.

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

The templates dashboard's rows, behind Journal/Wiki/Operations' "insert a template" flow — see [Templates](architecture/templates.md#templates) for assignments and the routine conversion. Like `block_definitions`, a row is only ever copied into an entry's blocks with no link back, so deleting a row touches no entry. Its own block stack is rows of [blocks](#blocks) with `template_id` set (since v66 only there; before, `content`).

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
| tags | TEXT | JSON array of tag ids, NOT NULL DEFAULT `'[]'`; in `TAG_REF_TABLES` (`src/lib/tagRefs.ts`), not in the frozen `TAGGED_TABLES` of v53 |
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

The vault's own symbols for the canvas editor's library, made from drawings (since v59). An element on a canvas keeps its own copy of the path data, so removing a symbol here changes nothing already placed. There is no `deleted_at`: removing one is immediate, with an undo toast that writes the same row back (`symbolStore`'s `removeSymbol`/`restoreSymbol`). Rows are read through `readUserSymbol` (`src/lib/userSymbols.ts`), which drops one without an id or usable path data.

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

Indexes: `idx_entries_type` on `(type, deleted_at)` (every module loads its live entries that way), `idx_entries_category`, `idx_entries_list` on `(deleted_at, type, title, category_id, entry_number, tags, created_at, updated_at, id)` and the partial `idx_entries_decorated` on `deleted_at` `WHERE icon IS NOT NULL OR cover_image IS NOT NULL`. Until v66 `tags`, `created_at` and the rest came after `content` in the row, so reading them walked every entry's overflow pages — under SQLCipher that decrypted nearly the whole file. `idx_entries_list` answers the start-up list query (`fetchEntries`, first stage) and the tag sweep on open from the index alone; icon and cover can be data URLs and stay out of it, the few entries carrying one are found through `idx_entries_decorated`, which a query only uses with that exact condition in its WHERE.

**Old rows (v49 and pre-`"11"` backups).** The three old tables carried columns the app no longer reads — `slug`, `moon_phase`, journal `mood`/`paradigm_id`/banishing/meditation/`linked_*_ids` fields, operation status, sigil and `description` columns. Their content was converted into blocks and link chips by v36, v37, v41 and v42; v49 then copies only the shared columns. An id that sat in two old tables (a type change interrupted in an earlier version) keeps the first one (journal, wiki, operation) and the others are logged; they remain in `.pre-v49.bak`. Before copying, v49 retries the sigil drawings v42 could not save, and aborts until that succeeds — the column they wait in is about to go. Older backups go through the same converters on import, row by row (see [DB Backup / Restore](#db-backup--restore-emeralddb)).

### blocks

The blocks of entries and templates, one row each (since v65). An entry or a template is the owner; the row is its block as `BlockInstance` holds it, without the section around it (`toBlockRow`/`fromBlockRow` in `src/lib/blocks/blockRows.ts`).

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
| html | TEXT | NOT NULL DEFAULT `''`; the inner HTML. For now every type keeps it, the pictures a canvas or drawing lists included, so the block HTML of files (backup, `.emerald`, sync) can be written from the rows |
| text | TEXT | NOT NULL DEFAULT `''`; plain text for the search, without a DOM (`blockPlainText`): tags gone, block elements and chips as word boundaries; empty for a canvas and a drawing. A concealed sigil's text is in it — concealing depends on the date |
| updated_at | TEXT | NOT NULL; ISO 8601, when the block was last written by a save that changed it (a move does not count). A rebuild from a whole block stack (v65, v66, sync, an import, a seed) writes all of its owner's blocks anew, with new positions and this stamp |

`UNIQUE (entry_id, id)` and `UNIQUE (template_id, id)` (NULL is distinct, so each covers only its owner kind); indexes `idx_blocks_entry` and `idx_blocks_template` on `(owner, position)`.

**Writing (`src/lib/blockStore.ts`).** The stores keep an owner's blocks in memory as one string, `content` (`contentOf`: the block HTML of `serializeBlocks`, loaded from the rows). The stores (`createEntry`, `updateEntry`, `createTemplate`, `updateTemplate`), `entryTypeChange` and "Images" write through `planContentWrite` (that string → blocks → `planBlockWrite`), which compares the blocks to what was last saved (kept per owner in memory, read from the rows when missing, forgotten with `resetDbCache`/`markDbReplaced`) and write only blocks that are new, changed or moved (a move writes `position` alone), delete removed ones, and rewrite each written block's [block_refs](#block_refs) (`planBlockWrite`). A keystroke thus writes its own block. A single plain text block carries no ID in `content` (`serializeBlocks`, rule 2); it keeps the ID it was saved under (`blocksOfContent`).

**Whole stacks, and the old column.** A path that has a whole block stack and nothing saved to compare with — sync, the seeded templates of a fresh vault, the `.emerald` altar import, the MCP seed — replaces the owner's rows in its own batch (`replaceOwnerBlocks`). `serializeBlocks` writes the instance attributes in a fixed order (`orderedBlockAttrs`), so the same block written from its row or from the stack is the same string. The `content` column itself is gone since v66; `src/lib/contentColumn.ts` holds what still meets it: the migrations v65/v66, the two writers that run before and after v66 and ask `hasContentColumn` which form to write (`insertTemplateRow`, `altarInserts`), and a backup import's working copy, which gets the column back, filled from the rows, for as long as the import's converters for older files run, and builds the rows from it at the end (`addContentColumns`/`dropContentColumns` in `importStaging.ts`; see [Import](#import)). A backup import and a sync restore (`beginRestore`) forget what was saved (`clearSavedBlocks`).

**Asking for field values.** `lib/blocks/blockQuery.ts` (`entriesWithFieldValue`, `fieldValueSql`) finds the entries whose fields block holds a value — equals, contains, empty, not empty — through `json_extract` on `blocks.data` (`$.values."<element id>"`), the first piece of filtering by block values. Element IDs are checked, never quoted into the path as given. Text, link and image elements keep their values as markup in the slots and are not reached that way.

### block_refs

What a block points at (since v65), rewritten whenever its block is written (`blockRefs` in `src/lib/blocks/blockRefs.ts`).

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
| completed_at | TEXT | unused — the code neither writes nor reads it; kept for older backups |
| sort_order | INTEGER | NOT NULL DEFAULT 0; unused — tasks sort by `created_at`; kept for older backups |
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
| target_type | TEXT | NOT NULL; `'journal'` \| `'wiki'` \| `'operation'` \| `'task'`; v62 turned `'altar'` links into `'operation'` ones |

`UNIQUE (task_id, target_id, target_type)`.

## Indexes

Declared in `INDEX_DDL` in `schema.ts`: one on every foreign-key column, one on each side of `task_links`, one on every `deleted_at` column (for `entries` the leading column of `idx_entries_list`), `idx_entries_type` on `entries(type, deleted_at)`, the list indexes `idx_entries_list` and `idx_entries_decorated` — see [entries](#entries) — and `BLOCKS_INDEX_DDL` (an owner's blocks in order, references by target) — see [blocks](#blocks).

The `deleted_at` indexes matter because `runPeriodicCleanup` runs a range scan across every soft-delete table each time a vault is opened.

## Key Conventions

**Reading and writing rows.** `src/lib/row.ts` is the only place that converts between SQLite rows and the types in `src/types`. Read with `fromRow.*`, write with `toInt` and `toJson`. SQLite has neither booleans nor arrays: booleans come back as `0`/`1`, arrays as JSON text.

**tags field.** `tags` on entries and templates is a JSON array of tag **ids**. The ids of trashed tags stay in the list and are simply not shown (`visibleTags`); exports (`.emerald`, Markdown, HTML) write names (`liveTagNames`), and imports map names back to ids. Tasks carry no tags.

**entry_number.** A stable, compact, human-readable number, shown in the link picker as `#12`. `nextEntryNumber(db, type)` in `db.ts` assigns it at insert time, counting per `type` (journal #1 and wiki #1 can coexist) and including trashed rows, so a restored entry never duplicates a number. It is a stored value, never derived from `ROWID`, so a replace import cannot shift it. A type change gives the entry a fresh number in the target type — or its former one when it returns to the type it had when editing began (by Cancel, or by switching back by hand), unless another entry of that type has taken it meanwhile (see [Cancel after a type change](architecture/editing.md#cancel-after-a-type-change)).

**Titles.** A new entry or task is stored with an **empty** title. What the user sees is `displayTitle(t, type, title)` from `src/lib/entryTitle.ts`: the title if it has text, otherwise the translated "Untitled …" of that type — in lists, cards, tabs, search, the Trash, link chips and pickers, task links and exports. `hasOwnTitle(title)` is the one test for "has a title of its own"; nothing compares against a magic string.

The English defaults older versions stored (`LEGACY_UNTITLED_TITLES`) count as untitled only where data comes in: migration v48, a `.emeralddb` import (`clearLegacyUntitledTitles`), and a `.emerald` or Markdown import (`isLegacyUntitled`, plus the app-language "Untitled …" a Markdown/PDF export writes for an empty title). After that a title is whatever was typed. The DDL default of `tasks.title` still says `'Untitled …'`, but no insert relies on them.

**Timestamps.** ISO 8601 text produced by `nowIso()`, sorted and compared lexicographically. No column holds a date-only value; dates inside blocks are `YYYY-MM-DD`.

**`updated_at` means "last changed by you".** It moves only when someone changes that very row. The store update methods (`updateEntry`, `updateTask`, `updateTemplate`) take `{ touch }` from `src/lib/stamp.ts`:

- `true` (the default) stamps now;
- `false` keeps the stamp for writes that are a consequence of something elsewhere (a tag id stripped from or merged into a list);
- a timestamp sets exactly that one (Cancel puts back the stamp from before editing).

A patch that changes nothing is not written at all (`needsWrite`). Checking a checklist item in read mode is a change and does stamp. Ticking a task stamps that task only; its subtasks change along without a new stamp, and ones already in that state are not written. An imported entry's `updated_at` is its creation date (the file knows no other), so an old operation does not jump to the top of a list sorted by last change.

**Base64 in SQLite.** The rule is to keep image data in files (see [Rules for Future Schema Changes](#rules-for-future-schema-changes)). Two columns hold data-URLs instead — the `legacy` group of `IMAGE_FIELDS` in `schema.ts`: `entries.icon` / `cover_image`. `Favicon.tsx` (via `readIconFile` in `lib/imageLimits.ts`) and `MediaPropertyRow` (`EditProperties.tsx`) read the uploaded file with the shared `readFileAsDataUrl` helper (`lib/helpers.ts`); none of them go through `save_image`. Consumers test the value with `isImageIcon` / `startsWith('data:image/')`. Do not add more.

## Sigil Workflow

A sigil is not a kind of row but three blocks in an entry's `content` (`src/lib/blocks/sigil.ts`), in any category; a new operation in `sigils` starts with them via the built-in `core-sigil` template (see [templates](#templates)). Calculator and charge are fields blocks with that one element (element IDs `calc` and `charge`), the drawing a paint block marked as a sigil drawing — the same three exist as parts of a user-built block:

1. **Calculator** (element kind `sigilCalc`) — the intention, the letter bank (each letter once) and the letters already implemented, as the element's value in `data-block-data`, the readable version in its slot.
2. **Drawing** (`core.paint` with `data-block-config='{"sigil":true}'`, or element kind `sigilCanvas`) — the vector strokes as data JSON (`data-block-data`, layers of strokes, see [Editors](architecture/editors.md#canvas-editor)), and as inner HTML the rendered image first (`<img src="{sha}.png" data-paint="render">`), then the image of every layer that has one (`data-paint="<layer ID>"`), so backups, exports and the image cleanup see them. A block whose first image is not marked as the render (one from before the vector format) opens with that image as its only layer. No base64 in content; rendered images saved while drawing become unused files that "Delete unused images" removes.
3. **Charge** (element kind `sigilCharge`) — `loaded`, `revealDate`, `lock` and `targets` (`entry` — the whole entry — or `sigil` — only calculator and drawing) as JSON; the charging technique as a real link chip in the markup, so the "Linked entries" field and import remapping see it.

The entry's state comes from the charges (`sigilState`). A charge's `targets` are unit IDs — `<block ID>:<element ID>` for a calculator or drawing part, the block ID for a sigil drawing — or absent for every calculator and drawing of the entry. An unmarked paint block is never a target. Charged and before the reveal date, the sigil is *concealed*: calculator and drawing hidden in both modes, left out of search and every export. Charged, it is *locked* in any entry type: `lock: 'entry'` hides Edit and blocks read-mode writes except unloading, `'sigil'` makes the two blocks read-only; date and lock scope are fixed while charged.

**Converting sigil columns (v42 and pre-`"7"` backups).** `migrateLegacySigils.ts` turns every row with sigil data — and, in v42 and files below `"7"`, every operation in `sigils` — into these blocks, with the old notes (`description`) as a text block after them. A drawing is written through `save_image` (only PNG/JPEG/GIF/WebP data URLs up to ~25 MB — anything else is dropped rather than retried forever; letter banks are capped at 500 entries). A hidden drawing (`show_sigil = 0`, not charged) becomes a hidden drawing block; an operation whose content already carries sigil blocks gets no second set. If saving fails the row stays untouched, and v49 retries it before copying (see [entries](#entries)). The backup import converts rows before inserting them (`liftLegacySigilRows`) and throws if a drawing cannot be saved, rather than importing a sigil without it. These conversions still write the sigil blocks of v42 to v63; v64 converts them like any other.

**The sigil blocks of v42 to v63 (v64, backups, `.emerald`, drafts).** Up to v63 the three were block types of their own: `core.sigil.calc`, `core.sigil.canvas`, `core.sigil.charge`. `lib/blocks/legacySigilBlocks.ts` is the one place that still knows them. Each keeps its block ID and instance attributes; calculator and charge become a fields block with one element (old data JSON as the value, old inner HTML as the slot, `readHideEmpty: false`, title shown), the drawing a sigil paint block with the same data and HTML. A charge target naming a converted calculator becomes `<ID>:calc`; a drawing's ID, part targets, foreign IDs and "all" stay. A calculator or charge with unreadable data JSON, or any block with a newer `data-block-v`, is left as it is; a drawing with unreadable data is converted anyway and shows its picture. The same converter runs in v64, in the backup import's working copy after the altars (`convertLegacySigilsInPlace` in `migrateLegacySigils.ts`, every mode), on a `.emerald` file's content (`importedContent`) and on template drafts read from `drafts.json`. Block definitions need none: they never held sigil blocks, only elements. Sync is not covered: a device still on v63 can bring old sigil blocks into a converted vault, as v62 altars can; `BACKUP_VERSION` stays `'13'`.

## Image Storage

Handled natively in `src-tauri/src/images.rs`. Images live in `{vaultDir}/images/`, sealed, and are named after a keyed hash of their own bytes (HMAC under a key derived from the vault key), so the same image is stored once per vault however many entries reference it. The plain SHA-256 would let anyone holding a known picture confirm it is in the vault.

**The database stores the bare filename** — `{hash}.{ext}` (64 hex digits), no directory and no drive letter. Rendering goes through the `emerald-img` URI scheme rather than IPC; the details are in [Image Storage System](architecture/storage.md#image-storage-system).

The image commands (`save_image`, `copy_image_file`, `read_image_as_base64`, `adopt_legacy_images`, `list_image_files`, `delete_image_files`) are listed in [IPC Command Surface](architecture.md#ipc-command-surface).

## Multi-Vault System

A vault is a **directory** holding `emerald.db` (SQLCipher), `vault.key`, `images/`, `backup/`, `settings.json` (the vault's own settings, read and written by `read_vault_settings`/`write_vault_settings`) and, while a block or template page holds unsaved edits, `drafts.json`. Vault metadata lives outside SQLite in `{appDataDir}/vaults.json`. The directory layout, `vaults.json`'s shape, first-launch behaviour, the default location for new vaults and the migrations of older installations are described in [Vault Layout](architecture/storage.md#vault-layout); what matters for the database:

- `getDb()` opens the database by vault id (`Database.load(vaultId)` in `src/lib/sqlite.ts`); Rust resolves the path, so folder names with `?`, `#` or `%` need no encoding. It throws `NO_ACTIVE_VAULT` rather than fall back to another vault, and Rust refuses to open a vault whose key is not unlocked — the gate in front of `getDb()` is described in [`architecture/encryption.md`](architecture/encryption.md#the-unlock-gate). All data is encrypted at rest; there is no unencrypted database.
- Every write to `vaults.json` calls `register_vaults`, mirroring `id → path` into Rust. Storage commands resolve a vault *id* against that registry and never accept a path — see [`security.md`](security.md).
- `resetDbCache()` in `db.ts` must be called before switching vaults; it clears the per-vault `Map<vaultId, Database>` cache and advances `dbEpoch()`, by which a reader spanning several awaits (the automatic backup) notices that the database was closed or — `markDbReplaced()` after an import — replaced under it. It first awaits any load still in flight: `getDb()` only caches a connection once `Database.load` resolves, so a reset racing a load could otherwise leak that connection unclosed, keeping the file locked on Windows.
- `withDbClosed(fn)` runs `fn` with every connection closed and blocks `getDb()` for its duration (throwing `DB_CLOSED`); vault deletion uses it so a debounced autosave can't reopen the very file being removed.
- `runMigrations()` runs on every `getDb()` cache miss and is safe on existing and empty files. A new vault's `.db` file is only written the first time the app switches to it, which is why `newVaultRecord(name)` does not create it up front. All vaults share the same schema.
- `newVaultRecord(name, opts?)` in `vaultManager.ts` is the single place that builds a new vault's record; the vault picker (see [Vaults](features.md#vaults)) and the add-vault import both use it. `addVault`/`updateVault`/`removeVault`/`setActiveVaultId`/`relocateVault` read-modify-write `vaults.json` by copying, never mutating the cached object before the write lands. `removeVault` hands off the active role in the same write that removes the record, so `vaults.json` never names an active vault missing from its own list.

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported and imported via Settings → Backup. The code is `src/lib/dbBackup.ts` for the content and `src-tauri/src/backup.rs` for the encrypted container.

**File format** — self-contained JSON, sealed in the container described below:

```json
{
  "version": "13",
  "type": "backup",
  "exportedAt": "2026-04-18T...",
  "filters": { "includeJournal": true, "includeWiki": true, "..." : "..." },
  "data": {
    "entries": [], "tags": [],
    "templates": [],
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

`BACKUP_VERSION` is `"13"`. A build rejects any file newer than itself before touching anything (`migrateBackupPayload` compares numerically — a string compare would think `"10"` older than `"4"`). That is why the version is bumped whenever an older build would otherwise import a file *wrongly* rather than fail: `insertRows` filters every row against `PRAGMA table_info` (to guard against crafted files), so an older build would silently drop a column it doesn't know.

`migrateBackupPayload` lifts an older file on load; some conversions run later, row by row, before insertion. Each step is an ordered `version < N` test, so a newer file never runs an older step twice.

| Version | Since | What changed | What import does with an older file |
|---|---|---|---|
| 13 | v56–v60 | `assignments` without `isDefault`, `block_definitions` without `revision` (v56); altars carry `elements` (v57); placements may carry `group_id` (v58); `vaultImages`, the rows of [images](#images), their files in `images` (v60) | Nothing to lift: `parseAssignments` drops what was only offered, and `revision` is not read. An older build would read every assignment as merely offered, drop the drawn shapes and text, and restore the pictures' files without their names, tags and notes, so it must refuse. Import adds missing pictures by file in both modes (`insertVaultImages`), never deletes, and follows the file names the images were stored under |
| 12 | v51–v53 | altar `settings` JSON; altar items with `updated_at`/`deleted_at`; tag ids | Packs altar columns into `settings` (`altarSettingsJson`); gives items `updated_at = created_at`; `tagNamesToIds` converts entries', templates' and old routines' tag names by the v53 rule ([tags](#tags)) and drops `affected_ids` |
| 11 | v49 | one `data.entries` array with `type` | A `"11"`+ file is split back into journal/wiki/operation arrays (`splitEntries`; unknown `type` dropped), so the import paths work on three arrays; `entryRowsForInsert` projects them onto `entries`, de-duplicating ids (journal, wiki, operation wins) |
| 10 | v46 | altars carry `deleted_at` | Nothing; an older build would revive trashed altars, so it must refuse |
| 9 | v45 | `languages`, `lexiconEntries` | Nothing |
| 8 | v43 | `templates` | A file's `routines` stays standing and becomes templates at import time, after the type filters (`withRoutinesAsTemplates`, see [Routines converted to templates](architecture/templates.md#routines-converted-to-templates)) |
| 7 | v42 | sigils as blocks | Sigil columns are converted before insertion (`liftLegacySigilRows`); empty `sigils` operations get the sigil blocks only from files below `"7"` |
| 6 | v40 | `blockDefinitions` | Nothing |
| 5 | v39 | `category_id` may be `null` | Nothing; an older build has a `NOT NULL` column and must refuse |
| 4 | v38 | one `categories` array | `mergeLegacyCategoryArrays` merges the four per-module arrays by the v38 rule ([categories](#categories)), translating built-in names via `legacyDisplayName`, and remaps every row's `category_id` |
| 3 | v35 | images referenced by filename | Nothing: `restoreImages` maps whatever keys the file carries (absolute paths in v1/v2) onto the filenames it wrote, and `remapPaths` substitutes them |
| 2 | v33 | category references by id | A `"1"` file's `wiki_articles.category` becomes `category_id`, `altar_items.category` is resolved from name to id against the file's own categories, and null `linked_*_ids` become `'[]'` |

Independently of the version, journal rows with the old fields go through `liftLegacyJournalRows` (link ids and paradigm/banishing/meditation fields → blocks, looking up link targets in the file and falling back to the vault), and operations with `is_active = 0`, an `end_date` or a `version` through `convertLegacyStatusRows` (the v41 converter: the Status block is prepended to `content`; the copies follow the vault's own "Status" definition if there is one, even in the trash, else the file's, else a new one at the end of the list). `vaultRoutineLinkSource` (resolving old routines' link targets) reads `entries`. A file from before v47 may carry a `links` array; import ignores it. A pre-v54 file's `description` values are dropped by `insertRows`' column filter.

### Export

`buildBackup(options)` builds the payload; `exportDatabase()` wraps it for the manual export, and the automatic backup calls it with `FULL_BACKUP_OPTIONS` (every module, the Trash and settings, no date range) — see [Automatic Backup](architecture/storage.md#automatic-backup). A `category_id` whose category is missing from the categories list read in the same run is exported as `null`: deleting or merging a category runs over several statements, and a payload caught in between would be refused on import.

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Tasks / Tags / Lexicon`, `dateFrom`, `dateTo`, `includeDeleted`, `includeSettings`. There is no templates toggle, and no altars toggle: altars are operations. The six content-type keys and their labels are `CONTENT_TYPES` in `dbBackup.ts`, shared by the export and the import page.

- Entries and tasks are date-filtered on `created_at`. Entries are one `SELECT` with a `type` filter for the ticked kinds.
- The "library" tables travel complete, trashed rows included and without a date filter: `categories` (whenever any of Journal, Wiki, Operations or Tasks is ticked — trashed categories too, or their exported content could not be restored), `block_definitions` and `templates` (whenever Journal, Wiki or Operations is ticked, since a template's assignments can reference any of the three), `languages` and `lexicon_entries` (with `includeLexicon`; a word is nothing without its language).
- `symbols` travels complete in every backup, whatever is ticked; the import adds the ones missing by id (`INSERT OR IGNORE`, on replace too), so none is ever removed by an import.
- `includeDeleted` applies to entries, tasks and `tags` — a trashed tag travels with the Trash, since the trashed entries carrying its id come along too.
- `task_links` is scoped to the exported task ids.

ID lists for `IN (...)` clauses are bound as parameters, never concatenated into the SQL string. The ids are not necessarily app-generated — an import takes them verbatim from the file — and sqlx splits a statement on `;`, so concatenating them would let a crafted backup run arbitrary SQL during a later export.

### Import

**Opening the file** asks for a secret only when no unlocked vault's key fits the backup. Everything below runs on the decrypted JSON.

**The import runs against a staging copy of the vault, never the vault itself** (`importViaStaging` in `src/lib/importStaging.ts`). `doReplace` and `doMerge` write over many separate statements, built from reads in between, which a transaction cannot wrap — `batch` covers only a prepared list (see [Foreign Keys](#foreign-keys)) — so they write into a copy:

1. Discard any copy a crashed import left behind — `discard_import_staging(vaultId)` in `vault.rs`, scoped to that vault's directory and the fixed filename `emerald.db.import` (`IMPORT_STAGING_FILE`, mirrored in `vaultManager.ts`).
2. `VACUUM INTO` that filename, next to `emerald.db`.
3. Open the copy as its own connection (`Database.load(vaultId, 'importStaging')`, keyed like the vault) and run `doReplace`/`doMerge` against it. The live vault is untouched, however far the import gets. For the import's duration the copy's `entries` and `templates` have a `content` column again, filled with every owner's block stack from its rows (`addContentColumns` in `contentColumn.ts`): a file's rows carry their blocks that way, and the converters for older files read and write it with plain SQL. At the end every owner whose rows do not give its `content` gets its rows from it, and the column goes (`dropContentColumns`). The export writes `content` from the rows likewise (`withContents` in `blockStore.ts`), so the file format is the one it was.
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

There is no category filter on import — the type ticks (`ImportTypeFilters`) are the only selection, plus the settings groups for Merge. Both `doReplace` and `doMerge` finish with `sweepDanglingTaskLinks`, `dropUnknownTagIds` and `clearLegacyUntitledTitles` (pre-v48 files carry the English "Untitled …" defaults).

**Before anything is written**, `assertPayloadReferencesResolve` checks that every category a payload references exists — in the file, or among the target vault's own categories (an import never deletes those). It rejects an unresolvable payload with a message that names the category; the staging copy is what protects the vault.

**Rows are inserted parents-first**; foreign keys are active during import. The order is hard-coded per import path (`doReplace` and `doMerge` each have their own) and does *not* follow `TABLES`.

**Altars of an older file.** A file from before v62 carries `altars`, `altarItems` and `altarPlacements`; the export no longer writes them. They are imported when Operations is ticked (`opsCount` in the preview counts them with the operations); the links to altars are converted either way. `importAltars` builds the three tables in the working copy from `ALTAR_TABLE_DDL`, inserts the file's rows, converts them as v62 does (`convertAltarsInPlace`: operations of `altars`, pictures of "Images", chips, altar fields and task links pointing at the operations — see [Altars as operations](architecture/editors.md#altars-as-operations)) and drops the tables again. Without altars to import it still points the file's chips, altar fields and task links at their operations (`convertAltarsInPlace` with no altar rows), or they would be dropped. It runs after the tasks and their links, so they follow the altars, and before the dangling-link sweep. In `doReplace` the file's version of an operation wins (`replace`), over an operation of that ID only, never over an entry of another type; in `doMerge` the altars, items and placements get the merge prefix like everything else, and an item's category is dropped with the table. Block definitions' altar elements and defaults are turned into link elements before they are validated (`elementsWithAltarsAsOperations`).

**Categories are resolved, never deleted** — `resolveImportedCategories`. A category matches a local one by id (for the built-in) or by case-insensitive name (`categoryKey`); a match is revived from the trash if the local row is trashed and the imported one active. Anything left over is inserted, with a new id if the payload's id is taken. The content arrays are then remapped onto the local ids. A category is shared across modules, so a partial replace (Wiki only, say) must not delete categories out from under Tasks.

**Tags are resolved the same way, never deleted** — `importTagsAndRemap`, before anything else is written. A tag with a local tag's id is that tag; otherwise a case-insensitive name match (`tagNameKey`) maps it onto the local tag — a trashed local namesake is revived if the imported one is live, after its id is stripped from the rows still carrying it (the same rule as typing the name, see [Tags](architecture/modules.md#tags)). Anything left over is inserted with its own id, name trimmed to 100 characters and colour validated; rows without a valid id (`isTagId`) or name are skipped. In entry and template rows, an id the file has no tag row for (Tags unticked) survives only if that tag exists locally.

**Block definitions are added, never replaced or deleted** — `insertBlockDefinitions`, `INSERT OR IGNORE` by id without the merge prefix, so a block arriving twice stays one. It runs before `doReplace`'s first `DELETE` and normalises every row to the full column set (ids must pass `isDefinitionId`), so a malformed array in a crafted file can neither abort a half-done replace nor slip a partial row past `insertRows`, which takes its column list from the first row. A definition that exists locally (even trashed) keeps its local version.

A definition's prefills need their own remap, since nothing else touches `elements` JSON: `remapDefinitionRows`/`remapDefinitionDefaults` rewrite an image default onto the image's local filename and a link default onto the imported entry — by the merge prefix's new id in `doMerge`, by id-or-title (`resolveImportedTarget`, shared with the `.emerald` chip resolver) in replace and add-vault. A link default that resolves to nothing is dropped, so a fresh copy never starts with a chip into the void.

**Templates are added, never replaced or deleted** — `insertTemplates`, `INSERT OR IGNORE` by id, before the deletes in `doReplace` and after the merge prefix's remap in `doMerge`. A local template (including trashed) keeps its local version; new ones land at the end of the sort order. `content` gets the same image and (in merge) id remap as entries; `assignments`' category ids are remapped like content rows, and one that doesn't resolve is dropped. An assignment survives only if no local active template holds that combination; a template arriving via the trash has none, like `templateStore.restoreTemplate`.

A fresh vault (add-vault) seeds its own `core-sigil` before the import runs. If the file carries its own `templates` (`"8"`+; converted routines don't count) and the import includes Journal, Wiki or Operations, that seeded row is deleted first, so the file's version of `core-sigil` — edited, deleted or otherwise — wins; `core-altar` likewise, but only when the file carries a `core-altar` row; from a file without one the fresh vault keeps its own.

**The Lexicon is added, never replaced or deleted** — `insertLexicon`, `INSERT OR IGNORE` by id; a word is inserted only when its language exists in the target vault, since `lexicon_entries.language_id` is a real foreign key.

### Image references

Images are restored via `save_image`, which returns the filename in the importing vault. A picture the vault already holds under the very name the file knew it by keeps that name (`restoreImages`): the name is a hash of the content, and saving again could spell the type differently (a `.jpeg` taken from the disk comes back as `.jpg`), which would leave it in "Images" twice. The remap covers the columns of `IMAGE_FIELDS` in `schema.ts` (via `imageColumns(table)`), the inventory shared by the importer, migration v35 (in its frozen form, `IMAGE_FIELDS_V48`) and `collectUsedImageFilenames`. It groups the columns by how they must be treated:

| Group | Meaning | v35 rewrites | Cleanup scans |
|---|---|---|---|
| `html` | the reference sits in a `src` attribute | yes | yes |
| `plain` | the column *is* the reference | yes | yes |
| `legacy` | the column holds a data-URL | no | yes |

The `legacy` group is why the list has to be complete: `collectUsedImageFilenames` decides which file the cleanup may delete, so a missing column would be a reference nobody sees. Rewriting those columns would break their renderers, which test them with `isImageIcon` (only `data:` / `blob:` / `/`).

`entries.content` in `IMAGE_FIELDS` is the block stack as a backup file's row carries it (`BLOCK_STACK_COLUMN`): the importer remaps the pictures in it; in the vault, `collectUsedImageFilenames` reads the pictures of every block, of entries and templates, from [block_refs](#block_refs) instead, and every image name in the rows of `blocks` as well. `block_definitions.elements` is scanned directly instead of through `IMAGE_FIELDS`: the table is younger than v35, which walks that list. All of their images travel with a `.emeralddb` export.

## Rules for Future Schema Changes

- **Change `schema.ts` and add a migration.** Both, always. The DDL there is what fresh vaults get; the migration is what existing vaults get. Bump `BASELINE_VERSION` to match — `runMigrations` refuses to start otherwise.
- **Run `npm run check:schema`.** It builds a vault each way and compares them column by column (including foreign keys and indexes), then exercises the migrations against seeded legacy data. It is the only thing standing between a schema edit and two silently divergent databases.
- **Constants mirrored across languages must change together.** The check compares the image-extension list, vault file names and the `emerald-img` scheme name across `images.rs`, `schema.ts`, `vault.rs`, `vaultManager.ts` and `tauri.conf.json`. Changing one side alone fails `check:schema`, not the compiler.
- Prefer additive changes. A rename or a type change means another full rebuild in the style of `normalizeSchema.ts`; dropping a column can use `dropColumnsIfPresent`.
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` where the safe default is true). New array fields: `TEXT NOT NULL DEFAULT '[]'`.
- New references: name them `<thing>_id`, store the id and never the name, declare the foreign key, and index the column.
- New image-backed fields: reuse the file pipeline through `src/lib/images.ts` (`saveImage` / `copyImageFile`), store the returned **filename**, and add the column to the `plain` (or `html`) group of `IMAGE_FIELDS` in `schema.ts` so migration and cleanup both see it. Do not store base64 in SQLite, and do not store a path.
- Never use the retired `try { ALTER TABLE … ADD COLUMN … } catch {}` pattern, and never rely on the `legacy` error-swallowing — new migrations must fail loudly.
- **`$N` placeholders must appear in ascending order in the SQL text.** SQLite treats `$N` as a *named* parameter and assigns bind indexes by order of first appearance, not by the digit — `SELECT $21, $23, $22` binds them as 1, 2, 3 (verified against the SQLite C API). `db.rs` binds the values array purely positionally, so a `$23` written before a `$22` silently swaps two values. Every query in this codebase works only because its placeholders ascend; reusing a placeholder (`WHERE id IN ($1, $3)`) is fine, skipping ahead is not.
- If a change alters the shape of exported rows, bump `BACKUP_VERSION` in `dbBackup.ts` and extend `migrateBackupPayload` so older files still import.
