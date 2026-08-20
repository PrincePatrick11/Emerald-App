# Database

Emerald uses a single SQLite file per vault, `emerald.db` by default, located in the OS application data directory. On macOS this is `~/Library/Application Support/com.emerald.magical-journal/` for the production build and a separate directory for the dev build (`com.emerald.magical-journal.dev`).

## Where the schema lives

`src/lib/schema.ts` holds the complete, current schema as `CREATE TABLE` and `CREATE INDEX` strings. It is the reference — reading that file tells you what the database looks like today, without replaying any history.

Two consumers share those strings, and that sharing is the point of the file:

- the **baseline path** in `runMigrations`, which fresh vaults take;
- **migration v33** `normalize_schema`, which rebuilds the tables of existing vaults.

Because both execute the same DDL, they cannot drift apart. `npm run check:schema` proves it: it builds one vault each way and compares `sqlite_master` and `PRAGMA table_info` table by table. Without that coupling and that check, the two paths quietly diverge after a few releases and nobody notices until a user hits an error.

## Migration Model

`src/lib/db.ts` exports `getDb()`. The first caller triggers `Database.load('sqlite:<vault>.db')` followed by `runMigrations(db)`; subsequent callers get the cached instance. The database is opened with `PRAGMA journal_mode = DELETE` (not WAL) for robustness across unclean shutdowns.

`runMigrations` takes one of two routes:

**Fresh file** — no tables at all. It executes the DDL from `schema.ts`, seeds the built-in categories, and stamps `schema_version` with a single `baseline` row at `BASELINE_VERSION`. The historical steps are skipped entirely.

The emptiness check looks at `sqlite_master`, not at `schema_version`: a database old enough to predate the version table has tables but no version row, and must run the chain.

**Existing file** — the ordered `MIGRATIONS` array runs from the highest applied version upward, each step stamping `schema_version` with its version, name, and ISO timestamp. Every vault reaches the same schema as a fresh one; there is no cut-off past which an old database stops being upgradable.

Afterwards `runPeriodicCleanup(db)` purges trashed rows older than 30 days. It is **not** a migration — idempotent, time-dependent, and run on every vault open.

The current version is **34**, and `BASELINE_VERSION` in `schema.ts` must equal the highest entry in `MIGRATIONS`. `runMigrations` throws at startup if the two disagree, so a new migration cannot be added without updating the baseline.

Note that **version 24 is genuinely missing** — no entry with that number has existed for some time. The runner tolerates gaps; it only requires each version to be above the last applied one.

### Frozen history, and why failures used to be swallowed

Migrations v1–v32 carry `legacy: true`. Only for those does the runner swallow "duplicate column name" / "already exists" errors and mark the step applied anyway.

That leniency is convenient and was actively harmful. It aborts the **entire remaining body** of a migration and still records it as done. Migration v4 is the case in point: v1 already creates `altars` with `background_preset`, and v4 opens with an `ALTER TABLE` for that same column. On every database, that throws, gets swallowed, and everything after it — `altar_placements.altar_id` and the default-altar seeding — never runs. The emergency migrations v30 and v31 exist to patch one symptom of this; they add the missing placement columns back but cannot restore the seeding.

v33 repairs the rest: placements without a valid altar are given one, and if the vault has no altar at all, the default altar v4 intended to create is finally created, which makes those placements visible again.

The historical migrations themselves are left untouched. Rewriting history is riskier than repairing its outcome, and existing vaults have already run them exactly as written.

**Migrations from v33 onward do not carry the flag and fail loudly.**

### Removing a feature does not mean editing its old migrations

Custom Properties were removed in 0.2.0, but migration 1 still creates `custom_properties` and migration 11 still alters it — both untouched, because they are history that existing vaults applied. The removal is a *new* migration, v32, which drops the table. v33 does the same for `creations` and `altar_intentions`, except that `creations` rows are carried over into `operations` first rather than discarded.

## Foreign Keys

Foreign keys are **enforced on every connection**. `tauri-plugin-sql` runs an sqlx pool, and sqlx sets `foreign_keys = ON` as a default pragma on each connection it opens. No application code turns them on.

Two consequences follow, and both shape how this schema is changed:

- A constraint takes effect the moment it is declared. There is no grace period.
- `PRAGMA foreign_keys = OFF` and `BEGIN` are **not usable** here. Each reaches exactly one pooled connection, and which connection serves the next statement is not controllable. The usual twelve-step table-rebuild recipe from the SQLite documentation is therefore unavailable — see `normalizeSchema.ts` for the ordering that replaces it.

Eight relations are declared, with deliberately chosen delete behaviour rather than a blanket `CASCADE`:

| Relation | ON DELETE | Reason |
|---|---|---|
| `altar_placements.altar_id` → `altars.id` | CASCADE | a placement without its altar is meaningless |
| `altar_placements.item_id` → `altar_items.id` | CASCADE | likewise |
| `task_links.task_id` → `tasks.id` | CASCADE | likewise |
| `tasks.parent_task_id` → `tasks.id` | SET NULL | the subtask survives as a standalone task |
| `wiki_articles.category_id` → `wiki_categories.id` | RESTRICT | content must never vanish with its category |
| `operations.category_id` → `operation_categories.id` | RESTRICT | likewise |
| `tasks.category_id` → `task_categories.id` | RESTRICT | likewise |
| `altar_items.category_id` → `altar_categories.id` | RESTRICT | likewise |

### What foreign keys cannot cover

`links.source_id` / `links.target_id` and `task_links.target_id` are **polymorphic** — the accompanying `*_type` column decides whether the target is a journal entry, a wiki article, or an operation. SQL has no polymorphic foreign key. The same applies to the JSON-array references (`routines.operation_ids`, `journal_entries.linked_wiki_ids`, every `tags` column) and to the loose optional ID columns `paradigm_id`, `bannung_type_wiki_id`, `meditation_type_wiki_id`, `charging_technique_wiki_id`.

These are exactly the places where orphans accumulate, and they are unguarded. Two things stand in for the missing constraints:

`checkIntegrity(db)` in `schema.ts` reports orphans across all of them — the polymorphic link tables, the loose ID columns, and the JSON arrays (which it parses in JavaScript, since SQL cannot). It is a diagnostic: it scans whole tables and is not called on the production path.

`sweepDanglingLinks(db)` in `db.ts` deletes link rows whose endpoint no longer exists. Both the 30-day purge and emptying the trash call it, so the two paths cannot drift; before, only the trash cleaned up, and only for journal and wiki entries.

### Deleting a category never deletes its content

`RESTRICT` does not delete anything; it refuses a delete that would leave a dangling reference. `reassignCategoryContent(db, table, categoryId)` is the other half: it moves the affected content to the built-in default category (`FALLBACK_CATEGORY` in `schema.ts`) so that the delete becomes permissible. Every permanent category deletion calls it first — the per-store `permanentlyDelete*Category` actions, `taskStore.deleteCategory`, `altarStore.deleteCategory`, and `trashStore.emptyTrash`.

The default categories themselves (`other` for Wiki, Operations and Altar, `general` for Tasks) cannot be deleted at all. They are the destination everything else is moved to — deleting one would leave its own content stranded and then block every future attempt to empty the trash.

Before this, categories were hard-deleted while their content was left alone, and articles, operations, and tasks were left pointing at a `category_id` with no matching row. The 30-day purge did the same on its own. Category tables are consequently **no longer in `CLEANUP_TABLES`**; they leave only through the trash, and only after their content has been moved.

## Tables

Sixteen tables, listed here in the dependency order `TABLES` declares — parents before children. That order is not cosmetic: inserts are checked against foreign keys immediately, so it governs the rebuild in v33 and the backup import.

### schema_version

Migration bookkeeping. The only table v33 does not rebuild, since it records the very migration being run.

| Column | Type | Notes |
|---|---|---|
| version | INTEGER PK | migration version, or `BASELINE_VERSION` for a fresh vault |
| name | TEXT | migration name, or `'baseline'` |
| applied_at | TEXT | ISO 8601 |

### tags

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT UNIQUE | the value entries actually reference |
| color | TEXT | hex, default `'#8347ff'` |
| affected_ids | TEXT | JSON array; snapshot for restoring a deleted tag |
| deleted_at | TEXT | NULL = active |

### links

Internal `[[wiki-style]]` references between entries. `source_id` and `target_id` are polymorphic — no foreign key possible.

| Column | Type | Notes |
|---|---|---|
| source_id | TEXT | part of composite PK |
| source_type | TEXT | `'journal'` \| `'wiki'` \| `'operation'` |
| target_id | TEXT | part of composite PK |
| target_type | TEXT | as above |

### routines

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | default `'📋'` |
| content | TEXT | plain text; newlines become paragraphs on drop |
| tags | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| operation_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| wiki_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| created_at / updated_at | TEXT | ISO 8601 |

### wiki_categories, operation_categories, task_categories

Identical shape. Defaults for `emoji` differ: `'📄'`, `'⚡'`, `'📋'`.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | fixed string for built-ins (`'sigils'`, `'servitors'`, `'other'`, `'general'`, …), UUID otherwise |
| name | TEXT | |
| emoji | TEXT | |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| is_builtin | INTEGER | boolean 0/1; built-ins cannot be deleted through the UI |
| deleted_at | TEXT | NULL = active |

The default task category `general` is seeded with `is_builtin = 0`. That looks like an oversight in migration v17, but it is the state of every existing database, so the baseline reproduces it rather than silently diverging.

### altar_categories

No soft delete — deleting an altar category is immediate, and its items move to `other` first.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| emoji | TEXT | NOT NULL DEFAULT `'✨'` |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at | TEXT | ISO 8601 |

### altars

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Altar'` |
| intention | TEXT | |
| background_preset | TEXT | default `'midnight'` |
| background_image_data | TEXT | despite the name, holds a **file path**, not base64 |
| background_overlay | REAL | NOT NULL DEFAULT 0.2 |
| background_overlay_color | TEXT | NOT NULL DEFAULT `'dark'` |
| grid_enabled | INTEGER | boolean 0/1 |
| grid_size / grid_opacity | REAL | defaults 32 / 0.06 |
| grid_color | TEXT | default `'#dce8e2'` |
| snap_to_grid | INTEGER | boolean 0/1 |
| rotation_snap_enabled | INTEGER | boolean 0/1 |
| rotation_snap_angle | REAL | default 15 |
| snap_scale_to_grid | INTEGER | boolean 0/1 |
| resolution | TEXT | e.g. `'1920x1080'`; the aspect ratio is derived from it |
| thumbnail_data / icon_data | TEXT | data-URLs — see the note under Key Conventions |
| created_at / updated_at | TEXT | ISO 8601 |

Numeric grid defaults must stay in sync with `DEFAULT_GRID_*` in `altarConstants.ts`. The unused `aspect_ratio` column was removed in v33.

### journal_entries

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Entry'` |
| content | TEXT | HTML produced by TipTap |
| entry_number | INTEGER | stable per row — see Key Conventions |
| moon_phase | TEXT | one of the eight `MoonPhase` keys, or NULL |
| mood | TEXT | unused; reserved |
| paradigm_id | TEXT | wiki article id, no FK (optional) |
| linked_operation_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| linked_wiki_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| is_bannung | INTEGER | boolean 0/1 |
| bannung_type_wiki_id | TEXT | wiki article id, no FK |
| is_meditation | INTEGER | boolean 0/1 |
| meditation_duration | INTEGER | minutes, nullable |
| meditation_type_wiki_id | TEXT | wiki article id, no FK |
| tags | TEXT | JSON array of tag **names** |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Both `linked_*_ids` columns were nullable until v33, unlike every other JSON array in the schema; consumers had to special-case `NULL` for exactly those two.

### wiki_articles

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | |
| slug | TEXT UNIQUE | URL-friendly title |
| content | TEXT | HTML produced by TipTap |
| category_id | TEXT | **FK → wiki_categories.id**, RESTRICT, default `'other'` |
| entry_number | INTEGER | |
| cover_image / icon | TEXT | file path or emoji |
| tags | TEXT | JSON array of tag names |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

`category_id` was called `category` before v33 — the odd one out among `<thing>_id` columns.

### operations

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Operation'` |
| content | TEXT | HTML produced by TipTap |
| category_id | TEXT | **FK → operation_categories.id**, RESTRICT |
| entry_number | INTEGER | |
| description | TEXT | |
| icon / cover_image | TEXT | |
| version | TEXT | free-text version label |
| is_active | INTEGER | boolean, NOT NULL DEFAULT 1 |
| end_date / target_reveal_date | TEXT | date-only `YYYY-MM-DD` from `<input type="date">` |
| charging_technique_wiki_id | TEXT | wiki article id, no FK |
| is_loaded | INTEGER | boolean 0/1 |
| intention_text | TEXT | |
| letter_bank / implemented_letters | TEXT | JSON arrays |
| show_intention_in_properties | INTEGER | boolean, default 1 |
| show_letter_bank_in_properties | INTEGER | boolean, default 1 |
| show_sigil | INTEGER | boolean, default 1 |
| drawing_data / thumbnail_data | TEXT | data-URLs |
| tags | TEXT | JSON array of tag names |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

### altar_items

The shared library of objects that can be placed on altars.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | NOT NULL DEFAULT `'✨'` |
| category_id | TEXT | **FK → altar_categories.id**, RESTRICT, default `'other'` |
| note | TEXT | |
| image_data | TEXT | file path |
| created_at | TEXT | ISO 8601 |

Until v33 this column was called `category` and held the category **name** — the only name-based reference in the schema. That is why migration v23 had to cascade a rename across two tables. It now holds the id, and renaming a category touches nothing else.

### tasks

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Task'` |
| description | TEXT | |
| category_id | TEXT | **FK → task_categories.id**, RESTRICT |
| parent_task_id | TEXT | **FK → tasks.id**, SET NULL |
| priority | TEXT | `'low'` \| `'medium'` \| `'high'` |
| due_date | TEXT | date-only `YYYY-MM-DD` |
| completed | INTEGER | boolean 0/1 |
| completed_at | TEXT | ISO 8601 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| tags | TEXT | JSON array of tag names |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Tasks have no `entry_number`; migration v9 only added that column to journal entries, wiki articles, and operations.

The self-reference makes insert order matter: a child inserted before its parent violates the foreign key. `insertTasks` in `dbBackup.ts` inserts with `parent_task_id` NULL and fills it in afterwards.

### altar_placements

One placed object on one altar.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| altar_id | TEXT | **FK → altars.id**, CASCADE, NOT NULL |
| item_id | TEXT | **FK → altar_items.id**, CASCADE, NOT NULL |
| x / y | REAL | percent of canvas, 0–100 |
| z_index | INTEGER | stacking order |
| width / height | REAL | NOT NULL DEFAULT 8 |
| rotation / opacity | REAL | degrees / 0–1 |
| locked / hidden | INTEGER | boolean 0/1 |

The obsolete `scale` column, from which older versions derived a fallback size, was removed in v33.

`AltarPlacement` in `src/types` also carries `name`, `emoji`, `category_id`, and `image_data`. Those are **not** columns — they are joined in from `altar_items` when placements are loaded.

### task_links

Links a task to a journal entry, wiki article, or operation. `target_id` is polymorphic — no foreign key possible.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| task_id | TEXT | **FK → tasks.id**, CASCADE |
| target_id | TEXT | polymorphic |
| target_type | TEXT | `'journal'` \| `'wiki'` \| `'operation'` |

`UNIQUE (task_id, target_id, target_type)` — the table previously allowed duplicate rows for the same link.

## Indexes

Declared in `INDEX_DDL` in `schema.ts`: one on every foreign-key column, one on each side of both link tables, and one on every `deleted_at` column.

The `deleted_at` indexes matter because `runPeriodicCleanup` runs a range scan across every soft-delete table each time a vault is opened. Before v33 the entire schema had three indexes.

## Key Conventions

**Reading and writing rows.** `src/lib/row.ts` is the only place that converts between SQLite rows and the types in `src/types`. Read with `fromRow.*`, write with `toInt` and `toJson`. SQLite has neither booleans nor arrays: booleans come back as the numbers `0`/`1`, arrays as JSON text. Doing this conversion ad hoc is how `OperationCategory.is_builtin` and `TaskCategory.is_builtin` ended up holding `0`/`1` while being declared `boolean`, which the surrounding code then papered over with casts back to `number`.

**tags field.** `entry.tags` on journal entries, wiki articles, operations, tasks, and routines is a JSON array of tag **name** strings such as `["Ritual", "Moon"]`, not UUIDs. The `tags` table exists for autocomplete and colours.

**entry_number.** A stable, compact, human-readable number, shown in the link picker as `#12`. Migration v9 backfilled it once from `ROWID`. Until v33, no insert ever wrote the column — the stores masked that by selecting `ROWID as entry_number` and overlaying the persisted value, which meant a replace-import that reassigned ROWIDs shifted every displayed number. The alias is gone; `nextEntryNumber(db, table)` in `db.ts` assigns the number at insert time, and v33 backfills the rows that never had one.

**Timestamps.** ISO 8601 text produced by `nowIso()`, sorted and compared lexicographically. `due_date`, `end_date`, and `target_reveal_date` are the exception: they come from `<input type="date">` and are date-only `YYYY-MM-DD`.

**Base64 in SQLite.** The rule below is to keep image data in files. `altars.thumbnail_data`, `altars.icon_data`, and `operations.drawing_data` / `thumbnail_data` predate it and still hold data-URLs. Do not add more.

## Sigil Workflow

A sigil is an operation row with `category_id = 'sigils'`:

1. **Intention** — the practitioner writes their magical intention in `intention_text`.
2. **Letter reduction** — unique letters go into `letter_bank`; the ones to use are marked in `implemented_letters`.
3. **Drawing** — the canvas drawing is serialised to `drawing_data`, with a `thumbnail_data` copy for list views.
4. **Visibility** — `show_sigil` controls display; `target_reveal_date` can defer it to a future date.
5. **Loading** — `is_loaded` marks the sigil as charged; `charging_technique_wiki_id` points at a wiki article describing the technique.

The standalone Creation module that preceded this is gone. Its `creations` table was removed in v33 and its rows were carried over into `operations` under `category_id = 'sigils'`; the backup format never exported that table, so those rows had been silently lost on every restore.

## Image Storage

Handled natively in `src-tauri/src/lib.rs`. Images are SHA-256-deduplicated — identical images are stored only once regardless of how many entries reference them. The UI may hold a data-URL for display, but persistence always uses file paths.

| Command | Behaviour |
|---|---|
| `save_image(data_url)` | Decodes base64, writes `{appDataDir}/images/{sha256}.{ext}`, skips if already present |
| `copy_image_file(source)` | Copies an existing file into storage with the same dedupe logic |
| `read_image_as_base64(path)` | Reads a stored file and returns a data-URL for rendering |

## Multi-Vault System

Vault metadata is stored outside SQLite in `{appDataDir}/vaults.json`:

```json
{
  "vaults": [
    { "id": "default", "name": "Emerald", "dbName": "emerald.db", "createdAt": "..." },
    { "id": "uuid",    "name": "My Vault", "dbName": "emerald-uuid.db", "createdAt": "..." }
  ],
  "activeVaultId": "default"
}
```

- `id='default'` / `dbName='emerald.db'` is bootstrapped on first run for backward compatibility.
- `getActiveDbName()` in `vaultManager.ts` is called by `getDb()` to resolve the correct DB file.
- `resetDbCache()` in `db.ts` must be called before switching vaults; it clears the per-vault `Map<identifier, Database>` cache.
- `runMigrations()` is idempotent — called on every `getDb()` cache miss, safe on both existing and empty DBs. A newly created vault's `.db` file is only written the first time the app switches to it, which is why `newVaultRecord(name)` does not create it up front.
- All vaults share the same schema.
- `newVaultRecord(name)` in `vaultManager.ts` is the single place that builds a new vault's record (`crypto.randomUUID()` for `id`, `dbName: emerald-<id>.db`, `createdAt`). It is used by `vaultStore.createVault()` (the Vault management modal's "Add Vault" row — see [Vaults in `features.md`](features.md#vaults)) and by `.emeralddb` add-vault import. `addVault`/`updateVaultName`/`removeVault`/`setActiveVaultId` all read-modify-write `vaults.json` by copying rather than mutating the cached object before the write lands.

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported and imported via Settings → Backup.

**File format** — self-contained JSON:

```json
{
  "version": "2",
  "type": "backup",
  "exportedAt": "2026-04-18T...",
  "filters": { "includeJournal": true, "includeWiki": true, "..." : "..." },
  "data": {
    "journalEntries": [], "wikiArticles": [], "wikiCategories": [],
    "operations": [], "operationCategories": [], "tags": [],
    "routines": [],
    "altars": [], "altarCategories": [], "altarItems": [], "altarPlacements": [],
    "tasks": [], "taskCategories": [], "taskLinks": [],
    "links": []
  },
  "images": { "/abs/path/img.png": "data:image/png;base64,..." }
}
```

`version` is `"2"` since the schema was unified. `migrateBackupPayload` lifts a `"1"` file on load: `wiki_articles.category` becomes `category_id`, `altar_items.category` is resolved from a category name to an id against the backup's own categories, and null `linked_*_ids` become `'[]'`. Without that step `insertRows` would silently drop the columns it no longer recognises — its `PRAGMA table_info` filter guards against crafted files and cannot tell malicious apart from merely old — and every article from an older backup would land in the default category.

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Routines / Altars / Tasks / Tags`, `dateFrom`, `dateTo`, `includeDeleted`. Altars, routines, and tasks are date-filtered on `created_at`. `altar_items` and `altar_placements` are scoped to exported altars; `task_links` to exported task IDs.

**Before anything is written**, `assertPayloadReferencesResolve` checks that every category a payload references exists — in the file itself, or among the rows the import will leave standing. `doReplace` empties the vault before inserting and cannot use a transaction (see the Foreign Keys section), so a payload that fails halfway would leave nothing behind. The check runs for merge too, where a mid-insert failure would leave a half-imported vault.

Categories are exported in full, including soft-deleted ones. Filtering them by `deleted_at IS NULL` while still exporting their articles produced backups that could not be restored at all once the foreign keys were in place.

**Import modes:**

| Mode | Behaviour |
|---|---|
| `replace` | Deletes only tables the backup has data for (partial-backup-safe), then inserts. The global `tags` table is wiped only when the backup contains Journal, Wiki, Operations, Tasks, *or* Routines data. |
| `merge` | Generates an 8-char base36 timestamp prefix. All entry IDs are prefixed; cross-references and wiki slugs are remapped. `entry_number` is offset past the highest existing one, since it is now a stored value rather than a read-time `ROWID` and would otherwise collide. Categories and tags use `INSERT OR IGNORE` by original ID/name. |
| `add-vault` | Creates a new vault DB → `switchVault()` → runs the replace logic on the empty DB. |

Rows are inserted parents-first, following the order in `TABLES`; foreign keys are active during import and reject anything else.

ID lists for `IN (...)` clauses are bound as parameters, never concatenated into the SQL string. The IDs are not necessarily app-generated — an import takes them verbatim from the file — and sqlx splits a statement on `;` and executes each part, so concatenating them let a crafted backup run arbitrary SQL during a later, unrelated export.

Images are restored via `save_image`. The path remap covers journal `content`; wiki `content` / `icon` / `cover_image`; operation `content` / `icon` / `cover_image` / `drawing_data` / `thumbnail_data`; altar `background_image_data` / `thumbnail_data` / `icon_data`; and altar item `image_data`.

## Rules for Future Schema Changes

- **Change `schema.ts` and add a migration.** Both, always. The DDL there is what fresh vaults get; the migration is what existing vaults get. Bump `BASELINE_VERSION` to match — `runMigrations` refuses to start otherwise.
- **Run `npm run check:schema`.** It builds a vault each way and compares them column by column, then exercises the rebuild against seeded legacy data. It is the only thing standing between a schema edit and two silently divergent databases.
- Prefer additive changes. A rename or a type change means another full rebuild in the style of `normalizeSchema.ts`.
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` where the safe default is true). New array fields: `TEXT NOT NULL DEFAULT '[]'`.
- New references: name them `<thing>_id`, store the id and never the name, declare the foreign key, and index the column.
- New image-backed fields: reuse the file pipeline (`save_image` / `copy_image_file`). Do not store base64 in SQLite.
- Never use the retired `try { ALTER TABLE … ADD COLUMN … } catch {}` pattern, and never rely on the `legacy` error-swallowing — new migrations must fail loudly.
- If a change alters the shape of exported rows, bump `BACKUP_VERSION` in `dbBackup.ts` and extend `migrateBackupPayload` so older files still import.
