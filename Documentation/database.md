# Database

Emerald uses a single SQLite file per vault, always named `emerald.db`, inside that vault's own directory. Where that directory sits is the user's choice — see [Multi-Vault System](#multi-vault-system). A vault created without picking a folder — whether through the vault modal or the `.emeralddb` add-vault import — defaults to `{documentDir}/Emerald Vaults/{name}`. Vaults migrated from a pre-multi-vault installation instead live under `{appDataDir}/vaults/{id}/` (which is also the fallback when the documents folder cannot be resolved); on macOS that is `~/Library/Application Support/com.emerald.app/vaults/…` for the production build and a separate directory for the dev build (`com.emerald.app.dev`).

`appDataDir` itself is keyed by the app's `identifier`, which changed with 0.2.x. A one-time adoption step copies a previous installation's `vaults.json` — and anything it points at that still lives under the old `{appDataDir}/vaults/{id}/` layout — across into the new `appDataDir`/`appConfigDir` on first start; see [`architecture.md`](architecture.md#adopting-a-previous-identifiers-data) for the mechanism, and the note under [Multi-Vault System](#multi-vault-system) below for what it means for `vaults.json`.

## Where the schema lives

`src/lib/schema.ts` holds the complete, current schema as `CREATE TABLE` and `CREATE INDEX` strings. It is the reference — reading that file tells you what the database looks like today, without replaying any history.

Two consumers share those strings, and that sharing is the point of the file:

- the **baseline path** in `runMigrations`, which fresh vaults take;
- **migration v38** `merge_category_tables` (`src/lib/mergeCategoryTables.ts`), which rebuilds the tables of existing vaults against this same DDL.

**Migration v33** `normalize_schema` no longer builds from `schema.ts` directly. Since v38 replaced the four per-module category tables with one `categories` table, `schema.ts` and the shape v33 has to produce disagree — running v33 against the live DDL would create `categories` on an old vault and then fail copying `wiki_categories`/`operation_categories`/`task_categories`/`altar_categories`, whose columns no longer exist there. `src/lib/schemaV37.ts` freezes v33's target shape instead: the tables that changed since v37 (the four category tables plus the five content tables that referenced them) as their own DDL, everything else re-exported from `schema.ts`. **Whoever changes one of those tables in a later migration must freeze it there too**, or v33 silently starts building the new shape on old vaults.

Indexes follow the same rule in a smaller way: v38 creates `INDEX_DDL_V38`, not `INDEX_DDL`, because in the chain it runs before the tables of later migrations exist. A table added after v38 brings its own index constant (`BLOCK_DEFINITIONS_INDEX_DDL` for v39), which its migration creates and `INDEX_DDL` appends for fresh vaults.

Because the baseline and both rebuilds ultimately produce the same schema, they cannot drift apart. `npm run check:schema` proves it: it builds a vault each way and compares `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list`, and every index, table by table — including a v33 resume-after-crash path and a v38 resume-after-crash path, and a check that a fresh vault seeds the same categories a migrated one ends up with. The script covers more than the schema comparison — it also exercises migration v35's image-reference rewrite, migration v36's journal-link rewrite (below), and the constants that are mirrored between `images.rs` / `schema.ts` / `vault.rs` / `vaultManager.ts` / `tauri.conf.json` (image extensions, vault file names, scheme name). It needs `esbuild`, which is declared in `devDependencies`. Without that coupling and that check, the two paths quietly diverge after a few releases and nobody notices until a user hits an error.

## Migration Model

`src/lib/db.ts` exports `getDb()`. The first caller triggers `Database.load('sqlite:<vault>.db')` followed by `runMigrations(db)`; subsequent callers get the cached instance. The database is opened with `PRAGMA journal_mode = DELETE` (not WAL) for robustness across unclean shutdowns.

`runMigrations` takes one of two routes:

**Fresh file** — no tables at all. It executes the DDL from `schema.ts`, seeds the built-in categories plus the starter set (below) — in whatever language is active when the vault is first opened, since `main.tsx` waits for the stored language before anything touches the database — and stamps `schema_version` with a single `baseline` row at `BASELINE_VERSION`. The historical steps are skipped entirely.

The emptiness check looks at `sqlite_master`, not at `schema_version`: a database old enough to predate the version table has tables but no version row, and must run the chain.

**Existing file** — the ordered `MIGRATIONS` array runs from the highest applied version upward, each step stamping `schema_version` with its version, name, and ISO timestamp. Every vault reaches the same schema as a fresh one; there is no cut-off past which an old database stops being upgradable.

Afterwards `runPeriodicCleanup(db)` purges trashed rows older than 30 days. It is **not** a migration — idempotent, time-dependent, and run on every vault open.

The current version is **41** (v41 `sigils_to_blocks`, `src/lib/migrateLegacySigils.ts`: sigils become calculator, drawing and charge blocks, see [Sigil Workflow](#sigil-workflow); v40 `operation_status_to_blocks`, `src/lib/migrateOperationStatusToBlocks.ts`: every operation that was inactive or had an end date or version gets a copy of the "Status" block — created only if some operation needs it — at the top of its content, the columns are reset, `updated_at` stays), and `BASELINE_VERSION` in `schema.ts` must equal the highest entry in `MIGRATIONS`. `runMigrations` throws at startup if the two disagree, so a new migration cannot be added without updating the baseline.

Note that **version 24 is genuinely missing** — no entry with that number has existed for some time. The runner tolerates gaps; it only requires each version to be above the last applied one.

### Frozen history, and why failures used to be swallowed

Migrations v1–v32 carry `legacy: true`. Only for those does the runner swallow "duplicate column name" / "already exists" errors and mark the step applied anyway.

That leniency is convenient and was actively harmful. It aborts the **entire remaining body** of a migration and still records it as done. Migration v4 is the case in point: v1 already creates `altars` with `background_preset`, and v4 opens with an `ALTER TABLE` for that same column. On every database, that throws, gets swallowed, and everything after it — `altar_placements.altar_id` and the default-altar seeding — never runs. The emergency migrations v30 and v31 exist to patch one symptom of this; they add the missing placement columns back but cannot restore the seeding.

v33 repairs the rest: placements without a valid altar are given one, and if the vault has no altar at all, the default altar v4 intended to create is finally created, which makes those placements visible again.

**v36 `journal_linked_ids_to_content`** rewrites `journal_entries.linked_operation_ids`/`linked_wiki_ids` into internal-link chip blocks appended to `content` (`src/lib/migrateLinkedIdsToContent.ts`), then clears both columns and rebuilds the affected rows' `links` table entries (the migration writes past the store layer, so `syncLinks` never runs for it). A target already in the trash is skipped rather than carried over as a dead chip, a target already linked in the content is not appended twice, and a row whose column holds invalid JSON is left completely untouched (logged via `console.warn`) so a retry on the next launch can still pick it up — the migration is resumable rather than all-or-nothing.

**v38 `merge_category_tables`** (`src/lib/mergeCategoryTables.ts`) replaces `wiki_categories`, `operation_categories`, `task_categories`, and `altar_categories` with one global `categories` table and repoints `wiki_articles`, `operations`, `tasks`, and `altar_items` at it. Merging is by case-insensitive display name (`mergeCategoryRows` in `src/lib/categoryMerge.ts`, shared with the fresh-vault seed and the backup-import lift below): two categories from different modules with the same name become one row, ids are kept where possible, `general` and every module's `other` collapse into the one built-in `other`, and if an active and a trashed category would merge, the merged row comes out active. Only `other` (the fallback) and `sigils` (what the sigil editor keys on) stay built-in; every other pre-v38 built-in becomes an ordinary, renameable, deletable category.

It is a rebuild in the same style as v33 (see the Foreign Keys section for why `PRAGMA foreign_keys = OFF` isn't available here), with one trap v33 didn't have to deal with: v33 predates the foreign keys it would otherwise trip. `ALTER TABLE altar_items RENAME TO altar_items_old` repoints `altar_placements`'s foreign key at `altar_items_old`, so if `altar_items_old` were dropped afterwards, `ON DELETE CASCADE` would take every placement with it — the same for `tasks` ← `task_links`. The migration avoids it by rebuilding those two parent/child pairs together: children renamed to `*_old` first (so both halves of a pair point at each other and vanish together), parents copied first into the new table, children dropped first during cleanup.

Because a crash can land mid-rebuild, the migration tracks its own progress in a real table, `_category_id_map` (not `TEMP TABLE` — that's scoped to one pooled connection and might not survive to the next statement). It holds the old-id → new-id mapping the content copy needs, plus one marker row (`src='_state', old_id='content_rebuilt'`) written the instant all six content tables have been copied into their new shape. That marker is the line past which resuming may never roll back: rolling back after it would `DROP TABLE tasks` on the now-populated table and cascade-delete the also-now-populated `task_links` (and the altar equivalent) along with it. Before the marker, resuming just re-runs step 1 (undo the renames) and starts over; after it, resuming only redoes cleanup (drop the `_old` tables and the four retired category tables) and the foreign-key check — nothing is re-copied. If the map table itself is already gone (a crash right at the very end), the migration falls back to checking whether `wiki_articles` already references `categories` to tell the two states apart.

Before v33's or v38's rebuild touches anything, they write a full file backup of the database via `VACUUM INTO` — to `{vaultDir}/emerald.db.pre-v33.bak` and `.pre-v38.bak` respectively. The name is fixed, the file is never cleaned up, and on image-heavy vaults it can be sizeable — but it is the escape hatch if a migration that rewrites every table goes wrong. (Opening a vault additionally takes a `VACUUM INTO` backup right before the normalization runs, see the changelog for 0.2.0.)

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
| `wiki_articles.category_id` → `categories.id` | RESTRICT | content must never vanish with its category |
| `operations.category_id` → `categories.id` | RESTRICT | likewise |
| `tasks.category_id` → `categories.id` | RESTRICT | likewise |
| `altar_items.category_id` → `categories.id` | RESTRICT | likewise |

Since v38 all four point at the same `categories` table (previously each module had its own).

### What foreign keys cannot cover

`links.source_id` / `links.target_id` and `task_links.target_id` are **polymorphic** — the accompanying `*_type` column decides what kind of row the target is. SQL has no polymorphic foreign key. The same applies to the JSON-array references (`routines.operation_ids`, `journal_entries.linked_wiki_ids`) and to the loose optional ID columns `paradigm_id`, `bannung_type_wiki_id`, `meditation_type_wiki_id`, `charging_technique_wiki_id`. (The `tags` columns are also unconstrained JSON arrays, but they hold tag *names*, not IDs — there is nothing to orphan-check them against.)

`source_type`/`source_id` on `links` are narrower than the target side: only Journal, Wiki, and Operations have an editor to type `[[` into, so a link can only *originate* from one of those three (`source_type: 'journal' | 'wiki' | 'operation'`, matching `BacklinkEntry.type` in `src/lib/links.ts`). A link's *target* — on `links` and on `task_links` — can additionally be a Task or an Altar, both of which are link destinations only (`target_type`/`ContentType`: `'journal' | 'wiki' | 'operation' | 'task' | 'altar'`).

These are exactly the places where orphans accumulate, and they are unguarded. Two things stand in for the missing constraints:

`checkIntegrity(db)` in `schema.ts` reports orphans across the ID-bearing JSON arrays (`journal_entries.linked_operation_ids` / `linked_wiki_ids`, `routines.operation_ids` / `wiki_ids`), which it parses in JavaScript, since SQL cannot. It is a diagnostic: it scans whole tables and is not called on the production path. Its `contentTables` map (deciding which table a `*_type` value points at) has to be kept in step by hand with `CONTENT_IDS` below — the two are separate, hand-maintained lists over the same five types.

`sweepDanglingLinks(db)` in `db.ts` deletes `links`/`task_links` rows whose endpoint no longer exists, checked against `CONTENT_IDS` (a `UNION ALL` of live ids across `journal_entries`, `wiki_articles`, `operations`, `tasks`, `altars` — soft-deleted rows count as valid, since trashed content isn't an orphan yet). Every trash-emptying and permanent-delete path that can leave a link dangling calls it: the 30-day purge, `altarStore.deleteAltar` and `taskStore.permanentlyDeleteTask` additionally delete the rows that point *at* them directly (`links`/`task_links WHERE target_id = …`) before the row itself goes, and `dbBackup`'s `doReplace`/`doMerge` call `sweepDanglingLinks` once the import finishes, since a partial restore (e.g. Tasks only) or an imported link row can point at something the import didn't bring back. A task's own *soft* delete only removes the `task_links` rows where the task is the source (`task_links.task_id`) — rows that point at it as a target are left standing, matching the rule that trashed content isn't yet an orphan; the permanent delete removes both directions.

### Deleting a category never deletes its content

`RESTRICT` does not delete anything; it refuses a delete that would leave a dangling reference. `reassignCategoryContent(db, categoryId)` in `schema.ts` is the other half: it moves the affected content — across all four categorized tables (`CATEGORIZED_TABLES`: `wiki_articles`, `operations`, `tasks`, `altar_items`) in one call, since a category is shared across modules now — to the built-in fallback (`FALLBACK_CATEGORY_ID`, `'other'`) so that the delete becomes permissible. Only a *permanent* category deletion calls it — `categoryStore.permanentlyDeleteCategory` and `trashStore.emptyTrash`. A category's *soft* delete (moving it to Trash) never reassigns its content — it stays pointing at the now-trashed category, which the UI groups into an "Uncategorized" bucket; restoring the category from Trash brings it back with no data lost. Reassignment only happens once there is no category row left to point at. `reassignCategoriesInMemory` in `categoryStore.ts` is the same move applied to the four already-loaded content stores, so an in-memory row doesn't try to write back a `category_id` the foreign key would now reject.

The two built-ins, `other` and `sigils`, cannot be deleted at all — `other` is the destination everything else is moved to (deleting it would leave its own content stranded and then block every future attempt to empty the trash), and `sigils` gives a new operation its sigil blocks (`defaultBlocksFor` in `src/lib/blocks/layouts.ts`).

Before this (pre-v33), categories were hard-deleted while their content was left alone, and articles, operations, and tasks were left pointing at a `category_id` with no matching row. The 30-day purge did the same on its own. `categories` is consequently **not in `CLEANUP_TABLES`**; it leaves only through the trash, and only after its content has been moved.

## Tables

Thirteen tables, listed here in the dependency order `TABLES` declares — parents before children. That order is not cosmetic: inserts are checked against foreign keys immediately, so it governs the rebuild in v33/v38 and the backup import.

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
| affected_ids | TEXT | NOT NULL DEFAULT `'[]'`; JSON array; snapshot for restoring a deleted tag |
| deleted_at | TEXT | NULL = active |

### links

Internal `[[wiki-style]]` references between entries. `source_id` and `target_id` are polymorphic — no foreign key possible.

| Column | Type | Notes |
|---|---|---|
| source_id | TEXT | part of composite PK |
| source_type | TEXT | `'journal'` \| `'wiki'` \| `'operation'` — only the modules with an editor can be a link source |
| target_id | TEXT | part of composite PK |
| target_type | TEXT | `'journal'` \| `'wiki'` \| `'operation'` \| `'task'` \| `'altar'` |

### routines

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | default `'📋'` |
| content | TEXT | NOT NULL DEFAULT `''`; plain text; newlines become paragraphs on drop |
| tags | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| operation_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| wiki_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'` |
| created_at / updated_at | TEXT | ISO 8601 |

### categories

Since v38, one list for Wiki, Operations, Tasks, and Altar items — replacing the four identically-shaped per-module tables (`wiki_categories`, `operation_categories`, `task_categories`, `altar_categories`). Journal has no categories (it groups by moon phase instead).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `'other'` / `'sigils'` for the two built-ins, UUID otherwise |
| name | TEXT | ignored for built-ins — their display name comes from `categories.builtin.<id>` in the active locale |
| emoji | TEXT | NOT NULL DEFAULT `'📁'` |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| is_builtin | INTEGER | boolean 0/1; true only for `other` and `sigils` — every other pre-v38 built-in is now an ordinary row |
| deleted_at | TEXT | NULL = active |

No `UNIQUE` on `name` — uniqueness is enforced by the store (`categoryKey`: trimmed, case-insensitive), not the database, because a `UNIQUE` index would block restoring a trashed category from the trash the moment an active one shares its name. `other` is the fallback everything reassigns to on delete (`FALLBACK_CATEGORY_ID`); `sigils` is the one category with behaviour — an operation in it is a sigil and opens the sigil editor (`SIGIL_CATEGORY_ID`). A fresh vault also seeds eight ordinary starter categories (`STARTER_CATEGORIES`: paradigm, ritual, meditation, herbs, crystals, candles, deities, tools), named in the app's language at creation time and freely renamable/deletable from then on.

### block_definitions

Since v39: the user-built blocks of the Blocks view. A row is only the template — an inserted block is a **copy** inside the entry's `content` (a `core.fields` section carrying its own elements, display rules, name and icon, plus `data-block-origin="<id>"` and `data-block-rev="<revision>"`). Nothing references this table by foreign key, and deleting a row touches no entry.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID; copies name it in `data-block-origin`, which is why imports keep it |
| name | TEXT | NOT NULL |
| icon | TEXT | emoji, NOT NULL DEFAULT `'🧩'` |
| description | TEXT | NOT NULL DEFAULT `''`; not passed on to copies |
| elements | TEXT | JSON array of `ElementDef` (`id`, `kind`, `label`, `options`, `hideWhenEmpty`, `archived`), NOT NULL DEFAULT `'[]'`; read through the same validation as a copy in content |
| display | TEXT | JSON `{ readHideEmpty, readOnly, showTitle }`, NOT NULL DEFAULT `'{}'` (missing keys fall back to their defaults) |
| revision | INTEGER | NOT NULL DEFAULT 1; rises with every save that changes name, icon, elements or display — a copy with a lower `data-block-rev` is "an older version" |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active; trashed rows are purged after 30 days like the content tables (`CLEANUP_TABLES`) |

A removed element stays in `elements` with `archived: true`, so it can be restored and copies keep its values. The kind of an element never changes — the builder adds a new element instead.

### altars

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Altar'` |
| intention | TEXT | NOT NULL DEFAULT `''` |
| background_preset | TEXT | default `'midnight'` |
| background_image_data | TEXT | despite the name, holds the **bare filename** of a stored image, not base64 (migration v35 reduced old paths/data URLs to filenames) |
| background_overlay | REAL | NOT NULL DEFAULT 0.2 |
| background_overlay_color | TEXT | NOT NULL DEFAULT `'dark'` |
| grid_enabled | INTEGER | boolean 0/1 |
| grid_size / grid_opacity | REAL | defaults 32 / 0.06 |
| grid_color | TEXT | default `'#dce8e2'` |
| snap_to_grid | INTEGER | boolean 0/1 |
| rotation_snap_enabled | INTEGER | boolean 0/1 |
| rotation_snap_angle | REAL | default 15 |
| snap_scale_to_grid | INTEGER | boolean 0/1 |
| resolution | TEXT | NOT NULL DEFAULT `'1920x1080'`; the aspect ratio is derived from it |
| thumbnail_data / icon_data | TEXT | data-URLs — see the note under Key Conventions |
| created_at / updated_at | TEXT | ISO 8601 |

Numeric grid defaults must stay in sync with `DEFAULT_GRID_*` in `altarConstants.ts`. The unused `aspect_ratio` column was removed in v33.

### journal_entries

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Entry'` |
| content | TEXT | NOT NULL DEFAULT `''`; HTML produced by TipTap |
| entry_number | INTEGER | stable per row — see Key Conventions |
| moon_phase | TEXT | one of the eight `MoonPhase` keys, or NULL |
| mood | TEXT | unused; reserved |
| paradigm_id | TEXT | wiki article id, no FK (optional); legacy — see note below |
| linked_operation_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'`; legacy — see note below |
| linked_wiki_ids | TEXT | JSON array, NOT NULL DEFAULT `'[]'`; legacy — see note below |
| is_bannung | INTEGER | boolean 0/1; legacy — see note below |
| bannung_type_wiki_id | TEXT | wiki article id, no FK; legacy — see note below |
| is_meditation | INTEGER | boolean 0/1; legacy — see note below |
| meditation_duration | INTEGER | minutes, nullable; legacy — see note below |
| meditation_type_wiki_id | TEXT | wiki article id, no FK; legacy — see note below |
| tags | TEXT | JSON array of tag **names** |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Both `linked_*_ids` columns were nullable until v33, unlike every other JSON array in the schema; consumers had to special-case `NULL` for exactly those two.

**Legacy since v36.** What an entry links now lives in its `content` as internal-link chips (see [`architecture.md` → Internal Links](architecture.md#internal-links)), read by the right sidebar's "Linked entries" field across all five entry types, not just operations and wiki articles. The two ID columns above are no longer written when a link is created; they remain in the schema only because export, `.emeralddb` backup/restore, and `checkIntegrity` still have to round-trip a backup taken before v36. The UI reads them exactly once, as a read-only bridge for entries a pre-v36 backup restored straight into these columns (`legacyIds` in `LinkedEntriesField`) — a link created from here on is always a content chip.

**Legacy since v37.** `paradigm_id`, `is_bannung`, `bannung_type_wiki_id`, `is_meditation`, `meditation_duration`, and `meditation_type_wiki_id` were three fixed Journal properties — Paradigm, Banishing, and Meditation — each tied to a wiki article. `JournalPropertiesPanel` no longer reads or writes any of the six; a set article is now an ordinary link chip in the entry's `content`, the same as the two columns above. Migration v37 rewrites existing rows once and clears all six columns; they stay in the schema only so export, `.emeralddb` backup/restore, and `checkIntegrity` can still round-trip a backup taken before v37. Unlike `linked_operation_ids`/`linked_wiki_ids`, there is no read-only UI bridge for these six — a restore that repopulates them (from a pre-v37 `.emeralddb` backup, imported without re-running the migration) leaves data sitting in the columns with nothing in the app reading it back out.

### wiki_articles

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Article'` |
| slug | TEXT UNIQUE | URL-friendly title |
| content | TEXT | NOT NULL DEFAULT `''`; HTML produced by TipTap |
| category_id | TEXT | **FK → categories.id**, RESTRICT, default `'other'` |
| entry_number | INTEGER | |
| cover_image / icon | TEXT | data-URL, or emoji for icon — see the Base64 note under [Key Conventions](#key-conventions) |
| tags | TEXT | JSON array of tag names |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

`category_id` was called `category` before v33 — the odd one out among `<thing>_id` columns.

### operations

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Operation'` |
| content | TEXT | NOT NULL DEFAULT `''`; HTML produced by TipTap |
| category_id | TEXT | **FK → categories.id**, RESTRICT, default `'other'` |
| entry_number | INTEGER | |
| description | TEXT | NOT NULL DEFAULT `''` |
| icon / cover_image | TEXT | data-URL, or emoji for icon — see the Base64 note under [Key Conventions](#key-conventions) |
| version / is_active / end_date | TEXT / INTEGER / TEXT | **legacy since v40** — status, end date and version are a block in `content` now (a copy of the user-built block "Status", `core-status`). Migration v40 moved every set value there and reset the columns (`1`, `NULL`, `NULL`); the app neither reads nor writes them. They stay for restoring older backups, whose rows go through the same converter (`convertLegacyStatusRows`) on import |
| description, target_reveal_date, charging_technique_wiki_id, is_loaded, intention_text, letter_bank / implemented_letters, show_intention_in_properties, show_letter_bank_in_properties, show_sigil, drawing_data / thumbnail_data | — | **legacy since v41** — a sigil is blocks in `content` now (see [Sigil Workflow](#sigil-workflow)). Migration v41 moved every set value there and reset the columns (`''`, `NULL`, `0`, `'[]'`, `1`); the app neither reads nor writes them. They stay for restoring older backups, whose rows go through the same converter on import |
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
| category_id | TEXT | **FK → categories.id**, RESTRICT, default `'other'` |
| note | TEXT | |
| image_data | TEXT | data-URL, not a path — see the Base64 note under [Key Conventions](#key-conventions) |
| created_at | TEXT | ISO 8601 |

Until v33 this column was called `category` and held the category **name** — the only name-based reference in the schema. That is why migration v23 had to cascade a rename across two tables. It now holds the id, and renaming a category touches nothing else.

### tasks

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | default `'Untitled Task'` |
| description | TEXT | |
| category_id | TEXT | **FK → categories.id**, RESTRICT, default `'other'` |
| parent_task_id | TEXT | **FK → tasks.id**, SET NULL |
| priority | TEXT | `'low'` \| `'medium'` \| `'high'`, default `'medium'` |
| due_date | TEXT | date-only `YYYY-MM-DD` |
| completed | INTEGER | boolean 0/1 |
| completed_at | TEXT | ISO 8601 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| tags | TEXT | JSON array of tag names |
| created_at / updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | NULL = active |

Tasks have no `entry_number`; migration v9 only added that column to journal entries, wiki articles, and operations.

The self-reference makes insert order matter: a child inserted before its parent violates the foreign key. `insertTasks` in `dbBackup.ts` inserts with `parent_task_id` NULL and fills it in afterwards.

Since v38 all four categorized tables (`wiki_articles`, `operations`, `tasks`, `altar_items`) default `category_id` to `'other'` at the SQL level, so a call site that omits it no longer has to pass the fallback explicitly. Before v38, `tasks.category_id` and `operations.category_id` had no SQL-level default and every creation call site had to pass the fallback id by hand — passing `''` matched no row and failed the foreign key silently.

### altar_placements

One placed object on one altar.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| altar_id | TEXT | **FK → altars.id**, CASCADE, NOT NULL |
| item_id | TEXT | **FK → altar_items.id**, CASCADE, NOT NULL |
| x / y | REAL | NOT NULL DEFAULT 50; percent of canvas, 0–100 |
| z_index | INTEGER | stacking order |
| width / height | REAL | NOT NULL DEFAULT 8 |
| rotation / opacity | REAL | degrees / 0–1 |
| locked / hidden | INTEGER | boolean 0/1 |

The obsolete `scale` column, from which older versions derived a fallback size, was removed in v33.

`AltarPlacement` in `src/types` also carries `name`, `emoji`, `category_id`, and `image_data`. Those are **not** columns — they are joined in from `altar_items` when placements are loaded.

### task_links

Links a task to a journal entry, wiki article, operation, another task, or an altar. `target_id` is polymorphic — no foreign key possible.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| task_id | TEXT | **FK → tasks.id**, CASCADE |
| target_id | TEXT | polymorphic |
| target_type | TEXT | `'journal'` \| `'wiki'` \| `'operation'` \| `'task'` \| `'altar'` |

`UNIQUE (task_id, target_id, target_type)` — the table previously allowed duplicate rows for the same link.

## Indexes

Declared in `INDEX_DDL` in `schema.ts`: one on every foreign-key column, one on each side of both link tables, and one on every `deleted_at` column.

The `deleted_at` indexes matter because `runPeriodicCleanup` runs a range scan across every soft-delete table each time a vault is opened. Before v33 the entire schema had three indexes.

## Key Conventions

**Reading and writing rows.** `src/lib/row.ts` is the only place that converts between SQLite rows and the types in `src/types`. Read with `fromRow.*` (including `fromRow.category`, since v38), write with `toInt` and `toJson`. SQLite has neither booleans nor arrays: booleans come back as the numbers `0`/`1`, arrays as JSON text.

**tags field.** `entry.tags` on journal entries, wiki articles, operations, tasks, and routines is a JSON array of tag **name** strings such as `["Ritual", "Moon"]`, not UUIDs. The `tags` table exists for autocomplete and colours.

**entry_number.** A stable, compact, human-readable number, shown in the link picker as `#12`. Migration v9 backfilled it once from `ROWID`. Until v33, no insert ever wrote the column — the stores masked that by selecting `ROWID as entry_number` and overlaying the persisted value, which meant a replace-import that reassigned ROWIDs shifted every displayed number. The alias is gone; `nextEntryNumber(db, table)` in `db.ts` assigns the number at insert time, and v33 backfills the rows that never had one.

**Timestamps.** ISO 8601 text produced by `nowIso()`, sorted and compared lexicographically. `due_date`, the legacy `end_date`, and `target_reveal_date` are the exception: they come from `<input type="date">` and are date-only `YYYY-MM-DD`.

**Base64 in SQLite.** The rule below is to keep image data in files. Nine columns predate it and still hold data-URLs — the `legacy` group of `IMAGE_FIELDS` in `schema.ts`: `wiki_articles.icon` / `cover_image`, `operations.icon` / `cover_image` / `drawing_data` / `thumbnail_data`, `altars.thumbnail_data` / `icon_data`, and `altar_items.image_data` (the last of which this file described as a file path until the code was checked). `Favicon.tsx`, `Banner.tsx`, and `AltarLibraryStrip.tsx` all read the uploaded file with the shared `readFileAsDataUrl` helper (`lib/helpers.ts`); none of the three go through `save_image`. Every consumer tests the value with `startsWith('data:image/')`. Do not add more.

## Sigil Workflow

Since v41 a sigil is not a kind of row but three blocks in an operation's `content` (`src/lib/blocks/sigil.ts`) — in any category; a new operation in `sigils` starts with them (`lib/blocks/layouts.ts`):

1. **Calculator** (`core.sigil.calc`) — the intention, the letter bank (each letter once) and the letters already implemented, as JSON in `data-block-data`.
2. **Drawing** (`core.sigil.canvas`) — the drawing as a stored image file: `<img src="{sha}.png">` in the block, so the image cleanup sees it. No base64 in content; intermediate strokes saved while drawing become unused files that "Delete unused images" removes.
3. **Charge** (`core.sigil.charge`) — `loaded`, `revealDate` and `lock` (`entry` — the whole entry, the former behaviour — or `sigil` — only calculator and drawing) as JSON; the charging technique as a real link chip in the markup, so the links table and backlinks see it.

The entry's state comes from the charge block (`sigilState`): charged and before the reveal date the sigil is *concealed* (calculator and drawing hidden in both modes, left out of search, cards and export; export disabled); charged it is *locked* (`lock: 'entry'` hides Edit and blocks read-mode writes except unloading, `'sigil'` makes the two blocks read-only; date and lock scope are fixed while charged). Migration v41 (`migrateLegacySigils.ts`, after a `VACUUM INTO .pre-v41.bak` when there is anything to convert) turned every row with sigil data — and every operation in `sigils` — into these blocks, with the old notes (`description`) as a text block after them. A drawing is written through `save_image` (only PNG/JPEG/GIF/WebP data URLs up to ~25 MB — anything else is dropped rather than retried forever; letter banks are capped at 500 entries); a hidden drawing (`show_sigil = 0`, not charged) becomes a hidden drawing block; an operation whose content already carries sigil blocks gets no second set. If saving fails the row is left entirely untouched and `getDb` retries it on every vault open (`convertLegacySigils` without the category rule — a sigil whose blocks the user removed must not get them back). Backup imports run the same conversion on the rows they just inserted.

The standalone Creation module that preceded this is gone. Its `creations` table was removed in v33 and its rows were carried over into `operations` under `category_id = 'sigils'`; the backup format never exported that table, so those rows had been silently lost on every restore.

## Image Storage

Handled natively in `src-tauri/src/images.rs`. Images live in `{vaultDir}/images/` and are named after the SHA-256 of their own bytes, so the same image is stored once per vault however many entries reference it.

**The database stores the bare filename** — `{sha256}.{ext}`, no directory and no drive letter. Rendering goes through the `emerald-img` URI scheme rather than through IPC; the details are in [`architecture.md`](architecture.md#image-storage-system).

| Command | Behaviour |
|---|---|
| `save_image(data_url, vault_id)` | Decodes base64, writes into the vault's `images/`, skips if present. Returns the filename |
| `copy_image_file(source, vault_id)` | Copies an existing file in, same dedupe. Returns the filename |
| `read_image_as_base64(filename, vault_id)` | Returns a data-URL — only for the PDF export and the backup writer |
| `adopt_legacy_images` / `list_image_files` / `delete_image_files` | Migration v35 and the *Unused images* cleanup |

## Multi-Vault System

A vault is a **directory** the user picks, holding `emerald.db`, an `images/` folder, and a `backup/` folder. Metadata is stored outside SQLite in `{appDataDir}/vaults.json`:

```json
{
  "version": 2,
  "vaults": [
    { "id": "uuid-1", "name": "My Vault",  "path": "D:/Vaults/My Vault", "createdAt": "...", "icon": "🌿" },
    { "id": "uuid-2", "name": "Work",      "path": "C:/Users/.../Documents/Emerald Vaults/Work", "createdAt": "..." }
  ],
  "activeVaultId": "uuid-1"
}
```

`icon` (a user-chosen emoji) is optional and its absence is what shows the generic vault glyph. `version` is not bumped for it — nothing reads that field, and records are copied through whole (`vaults.push(entry)`, `{ ...v, ...patch }`), so it round-trips through an older build untouched.

- A genuinely first-ever launch starts with an **empty** `vaults` array and `activeVaultId: ""` — there is no guaranteed `default` record. `readVaultsFile()` only invents one (`id: 'default', name: 'Emerald'`) when `vaults.json` is missing *and* the Rust command `legacy_default_db_exists` finds a database from before multi-vault support; a file that already exists with an empty list (a user who removed every vault) is left alone. `AppShell` shows a non-dismissible vault modal instead of mounting the rest of the shell whenever the active id doesn't match any vault in the list.
- Records from before this layout carry `dbName` instead of `path`. `loadVaultsFile()` lifts each one through `migrate_vault_layout`, which moves the flat `.db` into `{appDataDir}/vaults/{id}/`. That happens before any database is opened, so it cannot be a schema migration; the image half is [v35](#rules-for-future-schema-changes) and runs afterwards.
- A first start under the 0.2.x identifier can find `vaults.json` already sitting there, adopted whole from the previous identifier's directory (`adopt_previous_identifier_dirs`, see [`architecture.md`](architecture.md#adopting-a-previous-identifiers-data)) before any of the above ever runs. That copy is a distinct, earlier step from `migrate_vault_layout` above: it moves an entire installation's data across an identifier change, in Rust, before the frontend starts, rather than moving one vault's flat `.db` file within a single identifier's directory. As part of it, any path in the copied `vaults.json` that pointed under the old `{appDataDir}/vaults/{id}/` is rewritten onto the new root, so a pre-0.2.1-migrated vault's `path` keeps resolving after the copy.
- A vault created through the UI — including the `.emeralddb` add-vault import, which shows the same choose-folder row — defaults to `{documentDir}/Emerald Vaults/{name}` (`new_vault_base_dir`, sanitized through `vaultFolderName()`, target computed by `newVaultTarget()` and vetted by `probeNewVaultTarget()` in `vaultManager.ts`), not the app's own directory. That one (`default_vault_dir` / `default_dir_for`, `{appDataDir}/vaults/{id}`) stays reserved for the layout migration above and as the fallback when the documents folder cannot be resolved — there, a uuid-named folder can never collide.
- `getDb()` builds its connection string via `getActiveDbConnectionString()` in `vaultManager.ts`, which percent-encodes the vault path (`?`, `#`, `%` in folder names would otherwise be parsed as URL syntax) around the plain `getActiveDbFile()`. Both throw `NO_ACTIVE_VAULT` instead of falling back to `vaults[0]` when `activeVaultId` doesn't resolve — a silent fallback would open a different vault under the wrong id.
- Every write to `vaults.json` calls `register_vaults`, mirroring `id → path` into Rust. Storage commands resolve a vault *id* against that registry and never accept a path — see [`architecture.md`](architecture.md#vault-layout) and [`security.md`](security.md).
- `resetDbCache()` in `db.ts` must be called before switching vaults; it clears the per-vault `Map<identifier, Database>` cache. It also awaits any load still in flight first: `getDb()` only registers a connection in the cache once `Database.load` resolves, so a reset racing a load could otherwise clear the cache before that connection landed in it — the connection would then leak into the map unclosed, keeping the file locked on Windows. `withDbClosed(fn)` runs `fn` with every connection closed and blocks `getDb()` for its duration (throwing `DB_CLOSED`); vault deletion uses it so a debounced autosave elsewhere in the app can't reopen the very file being removed.
- `runMigrations()` is idempotent — called on every `getDb()` cache miss, safe on both existing and empty DBs. A newly created vault's `.db` file is only written the first time the app switches to it, which is why `newVaultRecord(name)` does not create it up front.
- All vaults share the same schema.
- `newVaultRecord(name, opts?)` in `vaultManager.ts` is the single place that builds a new vault's record (`crypto.randomUUID()` for `id`, `opts.path` or `default_vault_dir(id)` for `path`, `opts.icon`, `createdAt`). It is used by the vault modal (the "New Vault" and "Open vault" rows both call `addVault(await newVaultRecord(...))`, see [`features.md`](features.md#vaults)) and by `.emeralddb` add-vault import. `addVault`/`updateVault`/`removeVault`/`setActiveVaultId`/`relocateVault` all read-modify-write `vaults.json` by copying rather than mutating the cached object before the write lands (`relocateVault(id, path)` repoints a record whose folder was moved on disk); `updateVault(id, patch)` (replacing the old name-only `updateVaultName`) applies `patch` through the shared `applyVaultPatch()`, where `icon: null` deletes the key rather than storing it as `null`. `removeVault(id, deleteFiles, nextActiveId?)` folds handing off the active role into the same write that removes the record, so `vaults.json` is never briefly left naming an active vault that isn't in its own list; it resolves to a boolean — `false` when `delete_vault_files` left the folder standing because something other than the vault's own files was in it, which the vault modal reports as a hint.

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported and imported via Settings → Backup.

**File format** — self-contained JSON:

```json
{
  "version": "6",
  "type": "backup",
  "exportedAt": "2026-04-18T...",
  "filters": { "includeJournal": true, "includeWiki": true, "..." : "..." },
  "data": {
    "journalEntries": [], "wikiArticles": [],
    "operations": [], "tags": [],
    "routines": [],
    "altars": [], "altarItems": [], "altarPlacements": [],
    "tasks": [], "taskLinks": [],
    "categories": [],
    "blockDefinitions": [],
    "links": []
  },
  "images": { "3f2a….png": "data:image/png;base64,..." }
}
```

`version` is `"6"` since v41 moved sigils into content: an older file's operation rows with sigil columns are converted after insertion (`convertLegacySigils`, limited to the inserted ids; empty `sigils` operations get the sigil blocks only from files below `"6"`, since in a newer one the user may have removed them on purpose). It was `"5"` since v39 added `blockDefinitions` — the whole `block_definitions` table including trashed rows, exported whenever Journal, Wiki or Operations is included; a `"4"` file needs no conversion, it simply brings no blocks. It was `"4"` since v38 replaced the four per-module category arrays (`wikiCategories`/`operationCategories`/`taskCategories`/`altarCategories`) with one `categories` array, exported whenever any of Wiki, Operations, Tasks, or Altars is included. `migrateBackupPayload` lifts a `"1"` file on load: `wiki_articles.category` becomes `category_id`, `altar_items.category` is resolved from a category name to an id against the backup's own categories, and null `linked_*_ids` become `'[]'`. A v2 file needs no row changes, because `restoreImages` maps whatever keys the file carries — absolute paths in v1/v2, filenames in v3+ — onto the filenames of the images it just wrote, and `remapPaths` substitutes those throughout. A file below version `"4"` then runs `mergeLegacyCategoryArrays`: the same merge-by-display-name rule as migration v38 (`mergeCategoryRows`, translating built-in names into the app's current language via `legacyDisplayName`), producing the one `categories` array and remapping every content row's `category_id` onto it. Without that step `insertRows` would silently drop the columns it no longer recognises — its `PRAGMA table_info` filter guards against crafted files and cannot tell malicious apart from merely old — and every article from an older backup would land in the default category.

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Routines / Altars / Tasks / Tags`, `dateFrom`, `dateTo`, `includeDeleted`. All content tables (journal, wiki, operations, routines, altars, tasks) are date-filtered on `created_at`; tags, `categories` and `block_definitions` are not (block definitions always travel complete, trashed rows included). `includeDeleted` applies to the soft-deletable content tables — `tags` are always exported with `deleted_at IS NULL`, regardless of the option. `task_links` is scoped to exported task IDs.

`altar_items` (the library) is exported in full whenever `includeAltars` is set — every row, regardless of the altar date filter and even when no altar survives it. It is not an appendage of the altars: a library item can sit unplaced, created and edited entirely from the Altar dashboard's library section, without ever touching a canvas. `altar_placements` is the one still scoped to the exported altars (`altar_id IN (...)`), since a placement is meaningless without the altar it sits on. `doReplace` deletes and re-inserts `altar_items`/`altar_placements` together only when the file actually carries altars (`hasAltars`); when it doesn't — a date-filtered or library-only export — the library is inserted with `INSERT OR IGNORE` instead of being deleted first, so it adds to the existing library rather than emptying it (`altar_placements.item_id` is `ON DELETE CASCADE`, and clearing `altar_items` on every restore would tear placements off altars the file never meant to touch). The cost of `OR IGNORE` in that one case: an item that already exists locally keeps its local version rather than being overwritten by the file's.

**Before anything is written**, `assertPayloadReferencesResolve` checks that every category a payload references exists — in the file itself, or among the rows the import will leave standing (categories are never deleted by an import, so the target vault's own `categories` always counts, in both replace and merge mode). `doReplace` empties the vault before inserting and cannot use a transaction (see the Foreign Keys section), so a payload that fails halfway would leave nothing behind. The check runs for merge too, where a mid-insert failure would leave a half-imported vault.

Categories are exported in full, including soft-deleted ones. Filtering them by `deleted_at IS NULL` while still exporting their articles produced backups that could not be restored at all once the foreign keys were in place.

**Import modes:**

| Mode | Behaviour |
|---|---|
| `replace` | Deletes only tables the backup has data for (partial-backup-safe), then inserts. The global `tags` table is wiped only when the backup contains Journal, Wiki, Operations, Tasks, *or* Routines data. `categories` is never deleted (see below). |
| `merge` | Generates an 8-char base36 timestamp prefix. All entry IDs are prefixed; cross-references and wiki slugs are remapped. `entry_number` is offset past the highest existing one, since it is now a stored value rather than a read-time `ROWID` and would otherwise collide. `categories` is resolved, not merged by `INSERT OR IGNORE`; tags still use `INSERT OR IGNORE` by name. |
| `add-vault` | Creates a new vault DB → `switchVault()` → runs the replace logic on the empty DB. |

**Categories are resolved, never deleted, on either import mode** — `resolveImportedCategories` in `dbBackup.ts`. A category in the payload matches a local one by id (for the two built-ins) or by case-insensitive name (`categoryKey`, same rule as the store and migration v38); a match restores it from the trash if the local row is trashed but the imported one is active. Anything left over is inserted fresh, with a new id if the payload's id is already taken locally. The four content arrays are then remapped onto the resulting local ids before insertion. The rule is deliberate: a category is shared across all four modules since v38, so a partial replace (Wiki only, say) must not delete categories out from under Tasks or Altar items that a full replace would have left alone.

**Block definitions are added, never replaced or deleted**, in both modes — `insertBlockDefinitions`, an `INSERT OR IGNORE` by id without the merge prefix, since the copies in the imported content name their definition by exactly that id. It runs before `doReplace`'s first `DELETE` and normalises every row to the full column set first (ids must pass `isDefinitionId`; rows without one are dropped), so a malformed array in a crafted file can neither abort a replace that has already emptied tables nor slip a partial row past `insertRows`, which takes its column list from the first row. A definition that already exists locally (even in the trash) keeps its local version; the copies render from their own content either way.

**Operation rows from before v40** — any backup version whose operations still carry `is_active = 0`, an `end_date` or a `version` — go through the same converter as migration v40 (`convertLegacyStatusRows`) in both modes, before the first `DELETE`: the Status block is prepended to `content` and the columns are reset. The copies follow the vault's own "Status" definition if there is one (even in the trash), else the one in the file; only if neither exists is a new one added, at the end of the list.

Rows are inserted parents-first; foreign keys are active during import and reject anything else. The concrete order is hard-coded per import path (`doReplace` and `doMerge` each have their own) and does *not* follow the order in `TABLES` — e.g. `links` goes last, not third.

ID lists for `IN (...)` clauses are bound as parameters, never concatenated into the SQL string. The IDs are not necessarily app-generated — an import takes them verbatim from the file — and sqlx splits a statement on `;` and executes each part, so concatenating them let a crafted backup run arbitrary SQL during a later, unrelated export.

Images are restored via `save_image`, which returns the filename they were given in the importing vault. The remap covers journal `content`; wiki `content` / `icon` / `cover_image`; operation `content` / `icon` / `cover_image` / `drawing_data` / `thumbnail_data`; altar `background_image_data` / `thumbnail_data` / `icon_data`; and altar item `image_data`. `IMAGE_FIELDS` in `schema.ts` is the corresponding inventory on the app side, shared by migration v35 and `collectUsedImageFilenames`. It groups the columns by how they must be treated:

| Group | Meaning | v35 rewrites | Cleanup scans |
|---|---|---|---|
| `html` | the reference sits in a `src` attribute | yes | yes |
| `plain` | the column *is* the reference | yes | yes |
| `legacy` | the column holds a data-URL | no | yes |

The `legacy` group is why the list has to be complete rather than only naming the rewritable columns: `collectUsedImageFilenames` decides which file the cleanup action may delete, so a column missing from it would be a reference nobody sees. Rewriting them would break their renderers — `Favicon` and `Banner` write `icon` / `cover_image` via `readFileAsDataUrl` and test them with `isImageIcon`, which only accepts `data:` / `blob:` / `/`.

## Rules for Future Schema Changes

- **Change `schema.ts` and add a migration.** Both, always. The DDL there is what fresh vaults get; the migration is what existing vaults get. Bump `BASELINE_VERSION` to match — `runMigrations` refuses to start otherwise.
- **Run `npm run check:schema`.** It builds a vault each way and compares them column by column (including foreign keys and indexes), then exercises the rebuild against seeded legacy data. It is the only thing standing between a schema edit and two silently divergent databases.
- **Constants mirrored across languages must change together.** The check's last section compares the image-extension list, vault file names, and the `emerald-img` scheme name across `images.rs`, `schema.ts`, `vault.rs`, `vaultManager.ts`, and `tauri.conf.json`. Changing one side alone fails `check:schema`, not the compiler.
- Prefer additive changes. A rename or a type change means another full rebuild in the style of `normalizeSchema.ts`.
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` where the safe default is true). New array fields: `TEXT NOT NULL DEFAULT '[]'`.
- New references: name them `<thing>_id`, store the id and never the name, declare the foreign key, and index the column.
- New image-backed fields: reuse the file pipeline through `src/lib/images.ts` (`saveImage` / `copyImageFile`), store the returned **filename**, and add the column to the `plain` (or `html`) group of `IMAGE_FIELDS` in `schema.ts` so migration and cleanup both see it. Do not store base64 in SQLite, and do not store a path.
- Never use the retired `try { ALTER TABLE … ADD COLUMN … } catch {}` pattern, and never rely on the `legacy` error-swallowing — new migrations must fail loudly.
- **`$N` placeholders must appear in ascending order in the SQL text.** SQLite treats `$N` as a *named* parameter and assigns bind indexes by order of first appearance, not by the digit — `SELECT $21, $23, $22` binds them as 1, 2, 3 (verified against the SQLite C API). `tauri-plugin-sql` binds the values array purely positionally, so a `$23` written before a `$22` silently swaps two values. Every query in this codebase works only because its placeholders ascend; reusing a placeholder (`WHERE id IN ($1, $3)`) is fine, skipping ahead is not.
- If a change alters the shape of exported rows, bump `BACKUP_VERSION` in `dbBackup.ts` and extend `migrateBackupPayload` so older files still import.
