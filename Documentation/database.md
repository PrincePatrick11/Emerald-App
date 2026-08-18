# Database

Emerald uses a single SQLite file, `emerald.db`, located in the OS application data directory. On macOS this is `~/Library/Application Support/com.emerald.magical-journal/` for the production build and a separate directory for the dev build (`com.emerald.magical-journal.dev`).

## Migration Model

`src/lib/db.ts` exports a single `getDb()` function. The first caller triggers `Database.load('sqlite:emerald.db')` followed by `runMigrations(db)`. Subsequent callers receive the cached instance. The database is opened with `PRAGMA journal_mode = DELETE` (not WAL) for simplicity and robustness across unclean shutdowns.

`runMigrations` is a single sequential async function. It:

1. Creates the `schema_version(version PRIMARY KEY, name, applied_at)` tracking table on first run.
2. Reads the highest applied version (0 on a fresh database).
3. Iterates through the ordered `MIGRATIONS` array in `src/lib/db.ts`, running only entries whose version is above the current one. Each entry is an `async (db) => { … }` callback that may contain DDL, data backfills, or seed inserts.
4. After each successful migration, writes a row into `schema_version` with the version, name, and ISO timestamp.
5. Calls the separate `runPeriodicCleanup(db)` function, which auto-purges trashed rows older than 30 days across all soft-delete-aware tables. This is **not** a migration — it is idempotent and time-dependent, so it runs on every vault open.

The current schema version is **32**. New schema changes must be added as a new entry in the `MIGRATIONS` array with a strictly higher version number and a unique `name`.

**Upgrades from older versions.** Vaults that predate the `schema_version` table will see all migrations run on first open. `ALTER TABLE … ADD COLUMN` against an already-present column raises a "duplicate column" error; this is detected by `isAlreadyAppliedError` (matches `duplicate column name`, `already exists`, or a pre-existing table) and the migration is marked applied anyway. The data migrations themselves are idempotent and re-run safely: `entry_number` is only backfilled where `NULL`, and the UUID → fixed-string category ID rewrite is a no-op once the fixed IDs exist.

**Removing a feature does not mean editing its old migrations.** Custom Properties were removed in 0.2.0, but migration 1 still creates the `custom_properties` table and migration 11 (`custom_properties_meta_and_type_rename`) still alters it — both untouched, because they are history that existing vaults already applied. The removal is expressed as a *new* migration, version 32 (`drop_custom_properties`), which drops the table and its index at the end of the run.

This keeps every upgrade path working with one rule instead of several special cases:

| Vault state | What happens |
|---|---|
| Fresh | 1 creates the table, 11 alters it, 32 drops it — net effect: no table |
| Any older version | Remaining migrations run as before, 32 drops the table and its rows |
| Pre-`schema_version` | All migrations replay; the `IF NOT EXISTS` / `isAlreadyAppliedError` machinery absorbs the overlap, then 32 drops the table |

On a fresh vault, migration 11's first statement (`ADD COLUMN meta`) hits a column that migration 1's `CREATE TABLE` already defines. That raises "duplicate column name", `isAlreadyAppliedError` absorbs it, the rest of that migration's body is skipped and it is marked applied — the same path any migration takes once its columns have moved into the initial schema. Nothing is lost, since the table is dropped moments later.

Version 32 deletes any custom-property rows an existing vault still holds. That data is not preserved anywhere — it is not part of backups taken with 0.2.0 either — so the drop is deliberate and irreversible.

Note that **version 24 is genuinely missing**, and predates all of this: no entry with that number has existed in the array for some time. `runMigrations` tolerates it, since it only requires each entry's version to be above the last *applied* version rather than a gapless sequence.

## Tables

### journal_entries

Stores journal entries. Soft-deleted rows have `deleted_at` set.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | Default: `'Untitled Entry'` |
| content | TEXT | HTML produced by TipTap |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| tags | TEXT | JSON array of tag name strings |
| moon_phase | TEXT | One of the eight `MoonPhase` keys, or NULL |
| mood | TEXT | Unused; reserved |
| paradigm_id | TEXT | FK → wiki_articles.id (category = 'paradigm') |
| linked_operation_ids | TEXT | JSON array of operation UUIDs |
| linked_wiki_ids | TEXT | JSON array of wiki article UUIDs |
| is_bannung | INTEGER | Boolean 0/1 |
| bannung_type_wiki_id | TEXT | FK → wiki_articles.id |
| is_meditation | INTEGER | Boolean 0/1 |
| meditation_duration | INTEGER | Minutes, nullable |
| meditation_type_wiki_id | TEXT | FK → wiki_articles.id |
| deleted_at | TEXT | NULL = active; ISO 8601 = trashed |
| entry_number | INTEGER | Backfilled from ROWID; stable per row |

### wiki_articles

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | |
| slug | TEXT UNIQUE | URL-friendly version of title |
| content | TEXT | HTML produced by TipTap |
| category | TEXT | FK → wiki_categories.id |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| tags | TEXT | JSON array of tag name strings |
| cover_image | TEXT | Absolute path to image file |
| icon | TEXT | Emoji character or base64 data-URL |
| deleted_at | TEXT | |
| entry_number | INTEGER | Backfilled from ROWID |

### wiki_categories

Twelve built-in categories are seeded with fixed string IDs. Custom categories use UUID IDs.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Fixed string for built-ins (e.g. `'ritual'`, `'paradigm'`) |
| name | TEXT | Seed-time English name; do not display directly for built-ins |
| emoji | TEXT | |
| is_builtin | INTEGER | Boolean 0/1 |
| sort_order | INTEGER | |
| deleted_at | TEXT | |

Built-in IDs: `paradigm`, `bannung`, `meditation`, `sigil_charging`, `ritual`, `deity`, `herb`, `symbol`, `tool`, `concept`, `spell`, `other`.

The `paradigm`, `bannung`, and `meditation` categories have special meaning in journal entries and are not shown as generic filter chips.

### operations

Operations cover any planned or active magical working. Sigils are operations with `category_id = 'sigils'`.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | |
| content | TEXT | HTML produced by TipTap |
| category_id | TEXT | FK → operation_categories.id |
| description | TEXT | Short plain-text summary |
| is_active | INTEGER | Boolean 0/1; default 1 |
| end_date | TEXT | ISO 8601 date, nullable |
| version | TEXT | Free-form version string |
| icon | TEXT | Emoji or base64 data-URL |
| cover_image | TEXT | Absolute path to image file |
| tags | TEXT | JSON array of tag name strings |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | |
| entry_number | INTEGER | Backfilled from ROWID |
| target_reveal_date | TEXT | Sigils: date when sigil becomes visible |
| charging_technique_wiki_id | TEXT | Sigils: FK → wiki_articles.id |
| is_loaded | INTEGER | Sigils: boolean 0/1 |
| intention_text | TEXT | Sigils: the magical intention sentence |
| letter_bank | TEXT | Sigils: JSON array of reduced letters |
| implemented_letters | TEXT | Sigils: JSON array of letters drawn into the sigil |
| show_intention_in_properties | INTEGER | Sigils: boolean 0/1 |
| show_letter_bank_in_properties | INTEGER | Sigils: boolean 0/1 |
| show_sigil | INTEGER | Sigils: boolean 0/1; persisted visibility state |
| drawing_data | TEXT | Sigils: serialised canvas drawing |
| thumbnail_data | TEXT | Sigils: serialised canvas thumbnail |

### operation_categories

Two built-in categories are seeded with fixed string IDs. Custom categories use UUIDs.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `'sigils'` or `'servitors'` for built-ins |
| name | TEXT | Seed-time English name |
| emoji | TEXT | |
| sort_order | INTEGER | |
| is_builtin | INTEGER | Boolean 0/1 |
| deleted_at | TEXT | |

A startup migration replaces any UUID-based built-in IDs left over from older versions with the canonical string IDs, and updates all `operations.category_id` references accordingly.

### routines

Reusable content templates that can be dropped into journal entries.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | |
| content | TEXT | Plain text; newlines become paragraphs on drop |
| tags | TEXT | JSON array of tag name strings to merge on drop |
| operation_ids | TEXT | JSON array of operation UUIDs to link on drop |
| wiki_ids | TEXT | JSON array of wiki article UUIDs to link on drop |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### tags

The tags table exists primarily for autocomplete and per-tag colour management. Entries store tag names directly — not IDs. `deleteTag`/`restoreTag` in `src/store/tagStore.ts` sweep the `tags` field of Journal entries, Wiki articles, Operations, and Tasks — deleting a tag removes it from all four; restoring re-adds it to whichever of the four had it at deletion time (recorded in `affected_ids`).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT UNIQUE | The canonical tag name string |
| color | TEXT | Hex colour; default `'#8347ff'` |
| deleted_at | TEXT | |
| affected_ids | TEXT | JSON array of entry IDs that had this tag when it was deleted |

### links

Tracks internal links within entry content (the `[[…]]`-style chips rendered by `InternalLinkExtension`). Updated by `syncLinks()` after every save.

| Column | Type | Notes |
|---|---|---|
| source_id | TEXT | PK part 1 |
| source_type | TEXT | `'journal'`, `'wiki'`, or `'operation'` |
| target_id | TEXT | PK part 2 |
| target_type | TEXT | `'journal'` or `'wiki'` |

Primary key: `(source_id, target_id)`. Index: `idx_links_target` on `(target_id)` for backlink queries.

### altars

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | |
| intention | TEXT | Free-text intention for the altar |
| background_preset | TEXT | One of `'midnight'`, `'ember'`, `'forest'`, `'moon'` |
| background_image_data | TEXT | **Legacy name** — now stores an absolute file path, not inline base64. Old data-URL values are migrated to file-backed paths during `fetchAltars()`. |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| grid_enabled | INTEGER | Boolean `0/1`; default `0`. Whether the grid overlay is shown on this altar. |
| grid_size | REAL | Grid cell size in pixels; default `32`; clamped `8..128`. |
| grid_opacity | REAL | Grid line opacity; default `0.06`; clamped `0.01..0.25`. |
| grid_color | TEXT | Hex colour string; default `'#dce8e2'`. Validated as `#rrggbb` on write. |
| snap_to_grid | INTEGER | Boolean `0/1`; default `0`. Whether placements snap to the grid. |
| rotation_snap_enabled | INTEGER | Boolean `0/1`; default `0`. Whether rotation handle snaps to a fixed angle step. |
| rotation_snap_angle | REAL | Angle step in degrees when `rotation_snap_enabled = 1`; default `15`; clamped `1..180`. |
| snap_scale_to_grid | INTEGER | Boolean `0/1`; default `0`. Whether resizing snaps element size to multiples of `gridSize × 2`. |
| aspect_ratio | TEXT | **Deprecated.** Added in migration v20 but never written or read by the application. The ratio is always derived from `resolution` via `parseResolution`. Kept for backwards compatibility with existing databases. |
| resolution | TEXT | Canvas native size in `WxH` format (e.g. `'1920x1080'`); default `'1920x1080'`; clamped to max 7680×4320. Added in migration v21 (`altar_resolution`). |
| background_overlay | REAL | Opacity of the dark gradient overlay rendered above the background image; `0.0` = none, `1.0` = fully opaque; default `0.2`. Added in migration v25 (`altar_background_overlay`). |
| background_overlay_color | TEXT | Color of the overlay gradient: `'dark'` (black, `rgba(10,10,15,…)`) or `'light'` (white, `rgba(255,255,255,…)`); `NOT NULL DEFAULT 'dark'`. Added in migration v27 (`altar_background_overlay_color`). |
| thumbnail_data | TEXT | JPEG thumbnail of the altar stored as a `data:image/jpeg;base64,…` string; `NULL` until the first save completes. Maximum stored length is 512 KB. Set to `NULL` automatically by `updateAltarResolution` when the canvas ratio is changed. Added in migration v26 (`altar_thumbnail`). |
| icon_data | TEXT | Favicon for the altar. Either a single emoji character (e.g. `'🔮'`) or a base64 data-URL image (e.g. `'data:image/png;base64,…'`). `NULL` = no favicon set; the tab falls back to the flame icon. Added in migration v29 (`altar_icon_data`). |

Grid columns were added in migration v18 (`altar_grid_options_per_altar`). Rotation snap and scale-to-grid columns were added in migration v19 (`altar_rotation_snap_and_scale_to_grid`). The `resolution` column was added in migration v21 (`altar_resolution`). Default values in the migrations must stay in sync with the constants `DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`, `DEFAULT_ALTAR_RESOLUTION`, and `DEFAULT_BACKGROUND_OVERLAY` in `src/lib/altarConstants.ts`. Grid writes go exclusively through `altarStore.updateAltarGrid(id, patch)`. Resolution writes go exclusively through `altarStore.updateAltarResolution(id, resolution)`, which validates the format with a regex, clamps both dimensions via `parseResolution`, and updates `updated_at`. The `altar_categories` table was introduced in migration v22 and its default rows were capitalized and emoji-corrected in migration v23. Migration v24 is not used (reserved/skipped). The `background_overlay` column was added in migration v25 (`altar_background_overlay`). The `thumbnail_data` column was added in migration v26 (`altar_thumbnail`). Thumbnail writes go through `altarStore.updateAltar(id, { thumbnail_data })` after the canvas renderer resolves; the value must start with `data:image/` and must not exceed 512 KB before being passed to that action. Resolution changes clear the column via `updateAltarResolution`. The `background_overlay_color` column was added in migration v27 (`altar_background_overlay_color`); valid values are `'dark'` and `'light'`. All altar writes that include overlay settings go through `altarStore.updateAltar(id, patch)`, which now includes `background_overlay_color` in the `UPDATE` statement. The constant `DEFAULT_OVERLAY_COLOR` (`'dark'`) in `src/lib/altarConstants.ts` is the fallback used by `normalizeAltar`, `createAltar`, and `duplicateAltar`. Migration v28 (`altar_categories_sort_order`) added `sort_order INTEGER NOT NULL DEFAULT 0` to `altar_categories` and backfilled existing rows; see the `altar_categories` table section for details. Migration v29 (`altar_icon_data`) added `icon_data TEXT DEFAULT NULL` to `altars`; valid values are either a single emoji character or a `data:image/…` base64 string. Icon writes go through `altarStore.updateAltar(id, { icon_data })`. The `AltarTabIcon` component in `TabBar.tsx` reads this field and distinguishes between emoji (no leading `/` or `data:` prefix) and image values for rendering. Migrations v30 (`altar_placements_column_guard`) and v31 (`altar_placements_column_guard_v2`) are both guard/repair migrations, not feature additions: they re-add any of the `scale` / `z_index` / `width` / `height` / `rotation` / `opacity` / `locked` / `hidden` / `altar_id` columns that are missing on `altar_placements` for databases where an earlier migration (v3/v4) was recorded as applied without actually having created all of those columns. v30 checks via `PRAGMA table_info`; v31 is a belt-and-suspenders follow-up that instead tries each `ALTER TABLE … ADD COLUMN` individually inside a `try/catch`, in case the PRAGMA-based check itself proves unreliable in some environment.

### altar_items

The item library — reusable items that can be placed onto any altar.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | |
| category | TEXT | Name of a category from `altar_categories` (e.g. `'Candle'`, `'Crystal'`). Stored by name, not by ID. Updated automatically when a category is renamed or deleted. |
| note | TEXT | |
| image_data | TEXT | Optional image as base64 data-URL |
| created_at | TEXT | ISO 8601 |

### altar_categories

Defines the item categories available in the altar library. Categories are user-managed: they can be created, renamed, and deleted. Renaming a category cascades to all `altar_items` rows that reference the old name. Deleting a category does **not** reassign items — their `category` string is left unchanged. Items whose category no longer matches any row in this table surface under the "Uncategorized" pseudo-tab in the library strip.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID for user-created rows; fixed strings (`'candle'`, `'crystal'`, etc.) for the 8 default rows |
| name | TEXT | Display name; stored by name on `altar_items.category` |
| emoji | TEXT | Representative emoji shown on the category tab |
| created_at | TEXT | ISO 8601 |
| sort_order | INTEGER | Display position in the category tab row (0 = leftmost); set automatically to MAX+1 on insert; updated by `reorderCategories` when the user drags tabs |

Eight default rows are seeded by migration v22 (`altar_categories_table`): Candle `🕯️`, Crystal `🔮`, Herb `🌿`, Deity `✨`, Symbol `🌙`, Tool `🔔`, Table `🪵`, Other `📦`. Migration v23 (`altar_categories_capitalize_and_fix_emojis`) capitalizes any lowercase names left by earlier builds and corrects the Symbol emoji from `☽` to `🌙`. Migration v28 (`altar_categories_sort_order`) adds the `sort_order` column and backfills existing rows ordered by `created_at ASC, name ASC`.

### altar_placements

Positions an item on a specific altar. Multiple placements of the same item (on the same or different altars) are allowed.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| altar_id | TEXT | FK → altars.id |
| item_id | TEXT | FK → altar_items.id |
| x | REAL | Percentage position (0–100) |
| y | REAL | Percentage position (0–100) |
| scale | REAL | Legacy scalar (retained for compatibility) |
| z_index | INTEGER | Render order (higher value renders above lower value) |
| width | REAL | Placement width (schema default `8`; store default `40`; clamped: `2..500`) |
| height | REAL | Placement height (schema default `8`; store default `40`; clamped: `2..500`) |
| rotation | REAL | Rotation in degrees (clamped: `-360..360`) |
| opacity | REAL | Opacity (clamped: `0.05..1`) |
| locked | INTEGER | `0/1`; locked items are non-interactive on canvas |
| hidden | INTEGER | `0/1`; hidden items stay persisted but not rendered |

Altar placement coordinates remain percentage-based for responsive rendering. `altar_id` was added via migration to support the multi-altar model — the initial `CREATE TABLE` only included `id`, `item_id`, `x`, and `y`; all other columns were added in subsequent migrations.

### altar_intentions (legacy)

| Column | Type | Notes |
|---|---|---|
| date | TEXT PK | ISO date string |
| text | TEXT | Intention text |

Kept for backward compatibility. New intention data lives on `altars.intention`. Migration copies the latest legacy row into the first altar on load.

## Legacy Tables

### creations

This table is kept for backwards compatibility and to support trash recovery of items deleted before the Operations consolidation. It is read-only from the application's perspective — no new rows are written to it.

The old standalone Creation module has been removed. All sigil functionality now lives under Operations with `category_id = 'sigils'`. The `creations` table retains the same schema as `operations` for the sigil-specific columns.

## Key Conventions

**SQLite booleans.** SQLite stores booleans as `INTEGER 0` or `1`. Rows returned from `db.select` deliver these as the JavaScript number `0` or `1`, not `true`/`false`. Cast on read using `(row.field as unknown as number) !== 0`. After a store action updates a value in memory, it may be a real boolean — always use `!!value` for display logic, never the cast.

**tags field.** `entry.tags` (on journal entries, wiki articles, and operations) is a JSON array of tag name strings such as `["Ritual", "Moon"]`. It does not contain UUIDs. The `tags` table exists for autocomplete and colours; entries reference tag names directly.

**entry_number.** Not stored as an explicit sequence. Each table's `entry_number` column is backfilled on first migration from `ROWID` using `UPDATE … SET entry_number = ROWID WHERE entry_number IS NULL`. New rows set `entry_number` explicitly to the `last_insert_rowid` value at insert time. This gives every entry a stable, compact human-readable number without AUTOINCREMENT.

**JSON fields.** `tags`, `letter_bank`, `implemented_letters`, `linked_operation_ids`, `linked_wiki_ids`, `operation_ids`, `wiki_ids`, and `affected_ids` are stored as JSON text. Stores parse them with a `safeParseArray` helper that handles both already-parsed arrays (after an in-memory update) and JSON strings (from the database).

## Sigil Workflow

A sigil is an operation row with `category_id = 'sigils'`. The workflow proceeds through these states:

1. **Intention**: the practitioner writes their magical intention in `intention_text`.
2. **Letter reduction**: unique letters are extracted into `letter_bank` (JSON array). The practitioner marks which letters to use in `implemented_letters`.
3. **Drawing**: the canvas drawing is serialised to `drawing_data`. A thumbnail is stored separately in `thumbnail_data` for list views.
4. **Visibility**: `show_sigil` controls whether the sigil image is displayed. `target_reveal_date` can set a future date; the UI makes the sigil visible automatically when that date passes.
5. **Loading**: `is_loaded` marks that the sigil has been "charged" or activated. `charging_technique_wiki_id` links to a wiki article describing the technique.

Sidebar visibility of the intention and letter bank sections is controlled by `show_intention_in_properties` and `show_letter_bank_in_properties`. These are persisted on the row and must be respected as-is on load — never reset them.

### task_categories

Stores task categories. Soft-deleted rows have `deleted_at` set. A default "Allgemein" category (`id='general'`) is seeded on first run.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID or fixed string (`'general'`) |
| name | TEXT | Display name |
| emoji | TEXT | Default `'📋'` |
| sort_order | INTEGER | Default `0` |
| is_builtin | INTEGER | Reserved (currently `0`) |
| deleted_at | TEXT | Soft-delete timestamp (ISO) |

### tasks

Stores individual tasks. Supports hierarchical nesting via `parent_task_id`. Completed state is stored as integer (`0`/`1`) and normalized to boolean in the store.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | Default `'Untitled Task'` |
| description | TEXT | Reserved (not rendered in UI) |
| category_id | TEXT | References `task_categories.id`; becomes `''` when category deleted |
| priority | TEXT | `'low'`, `'medium'`, `'high'` (default `'medium'`) |
| due_date | TEXT | Reserved (not used in UI) |
| completed | INTEGER | `0` or `1` |
| completed_at | TEXT | ISO timestamp on completion |
| parent_task_id | TEXT | Self-reference for subtasks |
| sort_order | INTEGER | Default `0` |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601, updated on edit |
| tags | TEXT | JSON array (default `'[]'`) |
| deleted_at | TEXT | Soft-delete timestamp (ISO) |

### task_links

Links tasks to Journal entries, Wiki articles, or Operations.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| task_id | TEXT | References `tasks.id` |
| target_id | TEXT | ID of the linked entry |
| target_type | TEXT | `'journal'`, `'wiki'`, or `'operation'` |

Indexes: `idx_task_links_task` on `task_id`, `idx_task_links_target` on `target_id`.

## Image Storage

Handled natively in `src-tauri/src/lib.rs`. Images are SHA-256-deduplicated — identical images are stored only once regardless of how many entries reference them. The UI may hold a data-URL for display, but persistence always uses file paths.

| Command | Behaviour |
|---|---|
| `save_image(data_url)` | Decodes base64, writes `{appDataDir}/images/{sha256}.{ext}`, skips if already exists |
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
- `resetDbCache()` in `db.ts` must be called before switching vaults; clears the per-vault `Map<identifier, Database>` cache.
- `runMigrations()` is idempotent — called on every `getDb()` cache miss, safe on both existing and empty DBs.
- All tables in all vaults share the same schema.

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported and imported via Settings → Backup.

**File format** — self-contained JSON with extension `.emeralddb`:

```json
{
  "version": "1",
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

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Routines / Altars / Tasks / Tags`, `dateFrom`, `dateTo`, `includeDeleted`. Altars, routines, and tasks are date-filtered on `created_at`. `altar_items` and `altar_placements` are scoped to exported altars; `task_links` is scoped to exported task IDs. Soft-deleted rows in `task_categories` and `tasks` are excluded; `altar_categories` has no soft-delete column and is exported in full.

**Import modes:**

| Mode | Behaviour |
|---|---|
| `replace` | Deletes only tables for which the backup contains data (partial-backup-safe), then inserts all rows. The global `tags` table is wiped only when the backup contains Journal, Wiki, Operations, Tasks, *or* Routines data — a Tasks-or-Routines-only backup still clears it, so a Replace import doesn't leave unrelated stale tags behind. |
| `merge` | Generates an 8-char base36 timestamp prefix (`Date.now().toString(36).slice(-8)`). All entry IDs are prefixed; all cross-references and wiki slugs are remapped. Categories and tags use `INSERT OR IGNORE` by original ID/name. |
| `add-vault` | Creates a new vault DB → `switchVault()` → runs replace logic on the empty DB. User ends up in the new vault. |

Images are restored via `save_image` (SHA-256 dedup — identical images are written to disk only once). The path-remap covers all image-bearing columns: journal `content`; wiki `content` / `icon` / `cover_image`; operation `content` / `icon` / `cover_image` / `drawing_data` / `thumbnail_data`; altar `background_image_data` / `thumbnail_data` / `icon_data`; altar library item `image_data`. Absolute paths from the backup are rewritten to point at the local image directory.

## Rules for Future Schema Changes

- Prefer additive migrations (new columns, new tables) over destructive changes.
- Never rename a column already in production without a lazy migration strategy.
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` if the safe default is true).
- New array/object fields: `TEXT` stored as a JSON string.
- New image-backed fields: reuse the file-based pipeline (`save_image` / `copy_image_file`) — never store base64 blobs in SQLite.
- New columns: add a new entry to the `MIGRATIONS` array in `src/lib/db.ts` with the next sequential version number, a unique `name`, and an `up(db)` callback. Do **not** use the legacy `try { ALTER TABLE … ADD COLUMN … } catch { /* exists */ }` pattern — that was retired when the versioned migration system was introduced.
