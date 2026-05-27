# Database

Emerald uses a single SQLite file, `emerald.db`, located in the OS application data directory. On macOS this is `~/Library/Application Support/com.emerald.magical-journal/` for the production build and a separate directory for the dev build (`com.emerald.magical-journal.dev`).

## Migration Model

`src/lib/db.ts` exports a single `getDb()` function. The first caller triggers `Database.load('sqlite:emerald.db')` followed by `runMigrations(db)`. Subsequent callers receive the cached instance. The database is opened with `PRAGMA journal_mode = DELETE` (not WAL) for simplicity and robustness across unclean shutdowns.

`runMigrations` is a single sequential async function. It:

1. Creates all tables with `CREATE TABLE IF NOT EXISTS` — safe to run on an existing database.
2. Applies each column addition with `ALTER TABLE … ADD COLUMN` wrapped in a try/catch, ignoring the error when the column already exists.
3. Runs data migrations (e.g. backfilling `entry_number`, replacing old UUID-based built-in category IDs with fixed string IDs).
4. Seeds built-in records (wiki categories, operation categories) only when the count is zero.
5. Auto-purges trash items older than 30 days at startup.

There is no version table or migration counter. Each migration is idempotent by design.

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

### custom_properties

User-defined properties attached to individual journal entries, wiki articles, or operations.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| entry_id | TEXT | FK to the owning row in its table |
| entry_type | TEXT | `'journal'`, `'wiki'`, or `'operation'` |
| name | TEXT | Display label |
| type | TEXT | `'text'`, `'number'`, `'date'`, `'toggle'`, `'checkbox'` |
| value | TEXT | Stored as string; NULL if unset |
| meta | TEXT | JSON; type-specific config (e.g. `{"trueLabel":"Yes","falseLabel":"No"}` for toggle) |
| show_in_entry | INTEGER | Boolean 0/1; shows as a badge in the read view when true |
| sort_order | INTEGER | |

Index: `idx_custom_props_entry` on `(entry_id, entry_type)`.

Note: the `checkbox` type was renamed to `toggle` in a data migration. The migration updates any existing rows.

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

The tags table exists primarily for autocomplete and per-tag colour management. Entries store tag names directly — not IDs.

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
| background_image_data | TEXT | Custom background as base64 data-URL, nullable |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### altar_items

The item library — reusable items that can be placed onto any altar.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| emoji | TEXT | |
| category | TEXT | One of: `'candle'`, `'crystal'`, `'herb'`, `'deity'`, `'symbol'`, `'tool'`, `'table'`, `'other'` |
| note | TEXT | |
| image_data | TEXT | Optional image as base64 data-URL |
| created_at | TEXT | ISO 8601 |

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
| width | REAL | Placement width (clamped in store: `2..500`) |
| height | REAL | Placement height (clamped in store: `2..500`) |
| rotation | REAL | Rotation in degrees (clamped: `-360..360`) |
| opacity | REAL | Opacity (clamped: `0.05..1`) |
| locked | INTEGER | `0/1`; locked items are non-interactive on canvas |
| hidden | INTEGER | `0/1`; hidden items stay persisted but not rendered |

Altar placement coordinates remain percentage-based for responsive rendering. `altar_id` scopes each placement to a specific altar in the multi-altar model.

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
