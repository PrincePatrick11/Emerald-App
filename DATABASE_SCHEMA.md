# Emerald Database Schema

Implementation: [src/lib/db.ts](src/lib/db.ts)
Native image persistence: [src-tauri/src/lib.rs](src-tauri/src/lib.rs)

## Database Files

Each vault is a separate SQLite file. Metadata about all vaults lives in `vaults.json` (see Multi-Vault section below).

- Production (default vault): `~/Library/Application Support/com.emerald.magical-journal/emerald.db`
- Dev (default vault): `~/Library/Application Support/com.emerald.magical-journal.dev/emerald.db`
- Additional vaults: `~/Library/Application Support/com.emerald.magical-journal/emerald-{uuid}.db`

## Migration Model

- Migrations run on startup inside `runMigrations()` — idempotent, safe to re-run.
- New tables: `CREATE TABLE IF NOT EXISTS`
- New columns: `ALTER TABLE … ADD COLUMN` wrapped in `try/catch { /* exists */ }`
- Existing user data is preserved and backfilled in-place.
- Some migrations are lazy at the store layer when a pure SQL migration would be awkward (e.g. altar background data-URL → file path migration happens during `fetchAltars`).

## Persistence Conventions

- Booleans: `INTEGER 0/1` in SQLite. Cast on read: `(row.field as unknown as number) !== 0`. After store updates the field may be a real JS boolean — always use `!!value` for display/logic.
- Arrays / objects: stored as JSON strings, parsed on read.
- `entry_number`: derived from `ROWID` via `SELECT *, ROWID as entry_number` — never stored explicitly.
- Soft-delete: `deleted_at TEXT` (ISO timestamp). `NULL` = active.
- Images: SHA-256-deduplicated files in `{appDataDir}/images/`. DB fields store absolute file paths, not blobs.

## Tables

### `journal_entries`
```
id TEXT PRIMARY KEY
title TEXT
content TEXT                          — TipTap JSON as serialized string
created_at TEXT
updated_at TEXT
tags TEXT                             — JSON array of tag names (not IDs)
moon_phase TEXT
mood TEXT
deleted_at TEXT
entry_number INTEGER                  — from ROWID, not stored
paradigm_id TEXT
linked_operation_ids TEXT             — JSON array of operation IDs
linked_wiki_ids TEXT                  — JSON array of wiki article IDs
is_bannung INTEGER                    — 0/1
bannung_type_wiki_id TEXT
is_meditation INTEGER                 — 0/1
meditation_duration TEXT
meditation_type_wiki_id TEXT
```

### `wiki_articles`
```
id TEXT PRIMARY KEY
title TEXT
slug TEXT UNIQUE
content TEXT
category TEXT                         — wiki_categories.id
created_at TEXT
updated_at TEXT
tags TEXT                             — JSON array of tag names
deleted_at TEXT
cover_image TEXT                      — absolute file path or null
icon TEXT                             — data-URL or emoji string
entry_number INTEGER                  — from ROWID
```

### `wiki_categories`
```
id TEXT PRIMARY KEY
name TEXT                             — seed-time English; translate via t('wiki.categories.' + id) for built-ins
emoji TEXT
is_builtin INTEGER                    — 0/1
sort_order INTEGER
deleted_at TEXT
```
12 built-ins (sort_order):
`paradigm`(0) · `bannung`(1) · `meditation`(2) · `sigil_charging`(3) · `ritual`(4) · `deity`(5) · `herb`(6) · `symbol`(7) · `tool`(8) · `concept`(9) · `spell`(10) · `other`(11)

`paradigm`, `bannung`, `meditation` are special — used as journal fixed properties, not shown as generic filter chips.

### `operations`
```
id TEXT PRIMARY KEY
title TEXT
content TEXT
category_id TEXT                      — operation_categories.id
description TEXT
created_at TEXT
updated_at TEXT
tags TEXT                             — JSON array of tag names
deleted_at TEXT
entry_number INTEGER                  — from ROWID
is_active INTEGER                     — 0/1
end_date TEXT
version TEXT
icon TEXT                             — data-URL or emoji string
cover_image TEXT                      — absolute file path or null

— Sigil-specific fields (only meaningful when category_id = 'sigils'):
target_reveal_date TEXT
charging_technique_wiki_id TEXT       — wiki_articles.id of the charging technique
is_loaded INTEGER                     — 0/1; sigil has been charged/loaded
intention_text TEXT
letter_bank TEXT                      — JSON array of uppercase letters
implemented_letters TEXT              — JSON array of letters already drawn into the sigil
show_intention_in_properties INTEGER  — 0/1; sidebar visibility toggle
show_letter_bank_in_properties INTEGER — 0/1; sidebar visibility toggle
show_sigil INTEGER                    — 0/1; canvas visibility (manual override)
drawing_data TEXT                     — canvas PNG as data-URL
thumbnail_data TEXT                   — smaller canvas PNG as data-URL
```

`show_sigil` and `is_loaded` are persisted as the source of truth — never reset on load.

### `operation_categories`
```
id TEXT PRIMARY KEY
name TEXT
emoji TEXT
sort_order INTEGER
is_builtin INTEGER                    — 0/1
deleted_at TEXT
```
2 built-ins with fixed string IDs: `sigils` (🔯) · `servitors` (👁️)

Custom categories use UUID ids. Migration auto-upgrades old UUID-based built-ins to fixed IDs on first launch.

### `custom_properties`
```
id TEXT PRIMARY KEY
entry_id TEXT
entry_type TEXT                       — 'journal' | 'wiki' | 'operation'
name TEXT
type TEXT                             — 'text' | 'number' | 'date' | 'toggle' | 'checkbox' (legacy→toggle)
value TEXT
meta TEXT                             — JSON; toggle stores { onLabel, offLabel }
show_in_entry INTEGER                 — 0/1; renders read-only badge in main view
sort_order INTEGER
```
Index: `idx_custom_props_entry ON custom_properties(entry_id, entry_type)`

Old `'checkbox'` type is migrated to `'toggle'` on startup. New code uses `'toggle'` only.

### `routines`
```
id TEXT PRIMARY KEY
name TEXT
emoji TEXT
content TEXT                          — Markdown string
tags TEXT                             — JSON array of tag names
operation_ids TEXT                    — JSON array of operation IDs
wiki_ids TEXT                         — JSON array of wiki article IDs
created_at TEXT
updated_at TEXT
```

### `tags`
```
id TEXT PRIMARY KEY
name TEXT UNIQUE
color TEXT
deleted_at TEXT
affected_ids TEXT
```
Entries store tag **names** directly — not IDs. The `tags` table is for autocomplete and color management only.

### `links`
```
source_id TEXT
source_type TEXT
target_id TEXT
target_type TEXT
```
Index: `idx_links_target ON links(target_id)`

Populated via `syncLinks(sourceId, sourceType, htmlContent)` after every save.

### `altars`
```
id TEXT PRIMARY KEY
title TEXT
intention TEXT
background_preset TEXT                — preset key (e.g. 'midnight')
background_image_data TEXT            — LEGACY NAME: now stores absolute file path, not inline bytes
created_at TEXT
updated_at TEXT
```
Old inline data-URL values are migrated to file-backed paths during `fetchAltars()`.

### `altar_items`
```
id TEXT PRIMARY KEY
name TEXT
emoji TEXT
category TEXT
note TEXT
image_data TEXT                       — absolute file path when custom image is used
created_at TEXT
```

### `altar_placements`
```
id TEXT PRIMARY KEY
item_id TEXT
altar_id TEXT
x REAL                                — percentage of canvas width
y REAL                                — percentage of canvas height
scale REAL
```
Coordinates are percentages for responsive rendering. `altar_id` was added in migration from single-altar to multi-altar model.

### `altar_intentions` (legacy)
```
date TEXT PRIMARY KEY
text TEXT
```
Kept for backward compatibility. New intention data lives on `altars.intention`. Migration copies the latest legacy intention into the first altar on load.

### `creations` (legacy)
```
id TEXT PRIMARY KEY
title TEXT
description TEXT
target_reveal_date TEXT
charging_technique_wiki_id TEXT
is_loaded INTEGER
tool_type TEXT
intention_text TEXT
letter_bank TEXT
implemented_letters TEXT
show_intention_in_properties INTEGER
show_letter_bank_in_properties INTEGER
show_sigil INTEGER
drawing_data TEXT
thumbnail_data TEXT
created_at TEXT
updated_at TEXT
tags TEXT
deleted_at TEXT
entry_number INTEGER
```
**Do not write new data here.** The active sigil workflow lives under `operations` with `category_id='sigils'`. Table is kept for backward compatibility with old user data only.

### task_categories

```
id TEXT PRIMARY KEY
name TEXT NOT NULL
emoji TEXT NOT NULL DEFAULT '📋'
sort_order INTEGER NOT NULL DEFAULT 0
is_builtin INTEGER NOT NULL DEFAULT 0
deleted_at TEXT
```

Seed: `INSERT OR IGNORE` a default `general` / `Allgemein` / 📋 category on first run.

### tasks

```
id TEXT PRIMARY KEY
title TEXT NOT NULL DEFAULT 'Untitled Task'
description TEXT NOT NULL DEFAULT ''
category_id TEXT NOT NULL
priority TEXT NOT NULL DEFAULT 'medium'   -- 'low' | 'medium' | 'high'
due_date TEXT
completed INTEGER NOT NULL DEFAULT 0
completed_at TEXT
parent_task_id TEXT                       -- self-reference for subtask nesting
sort_order INTEGER NOT NULL DEFAULT 0
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
tags TEXT NOT NULL DEFAULT '[]'
deleted_at TEXT
```

### task_links

```
id TEXT PRIMARY KEY
task_id TEXT NOT NULL
target_id TEXT NOT NULL
target_type TEXT NOT NULL                 -- 'journal' | 'wiki' | 'operation'
```

Indexes: `idx_task_links_task` on `task_id`, `idx_task_links_target` on `target_id`.

## Image Storage

Handled natively in `src-tauri/src/lib.rs`:

- `save_image(data_url)` — decodes base64, writes `{appDataDir}/images/{sha256}.{ext}`, skips if already exists
- `copy_image_file(source)` — copies existing file into storage with same dedupe logic
- `read_image_as_base64(path)` — reads stored file, returns data-URL for rendering
- `cleanup_unused_images(used_paths, min_age_secs?)` — deletes unreferenced files older than N seconds (default 300s)

Identical images are stored only once. UI may hold a data-URL for display, but persistence always uses file paths.

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

- `id='default'` / `dbName='emerald.db'` is bootstrapped on first run for backward compatibility
- `getActiveDbName()` in `vaultManager.ts` is called by `getDb()` to resolve the correct DB file
- `resetDbCache()` in `db.ts` must be called before switching vaults; clears the per-vault `Map<identifier, Database>` cache
- `runMigrations()` is idempotent — called on every `getDb()` cache miss, safe on both existing and empty DBs
- All tables in all vaults share the same schema

## DB Backup / Restore (`.emeralddb`)

Full vault snapshots are exported/imported via Settings → Backup.

**File format** — self-contained JSON with extension `.emeralddb`:
```json
{
  "version": "1",
  "type": "backup",
  "exportedAt": "2026-04-18T...",
  "filters": { "includeJournal": true, "includeWiki": true, ... },
  "data": {
    "journalEntries": [...],
    "wikiArticles": [...],
    "wikiCategories": [...],
    "operations": [...],
    "operationCategories": [...],
    "tags": [...],
    "customProperties": [...],
    "routines": [...],
    "altars": [...],
    "altarItems": [...],
    "altarPlacements": [...],
    "links": [...]
  },
  "images": { "/abs/path/img.png": "data:image/png;base64,..." }
}
```

**Export filters (`BackupOptions`):** `includeJournal / Wiki / Operations / Routines / Altars / Tags`, `dateFrom`, `dateTo`, `includeDeleted`. Altars and routines are date-filtered on `created_at`. altar_items/placements are scoped to exported altars.

**Import modes:**

| Mode | Behaviour |
|------|-----------|
| `replace` | Deletes only tables for which backup contains data (partial-backup-safe), then inserts all rows. |
| `merge` | Generates `prefix = Date.now().toString(36).slice(-8)` (8-char base36 timestamp, unique per import). All entry IDs are prefixed; all cross-references (linked_operation_ids, paradigm_id, altar_id, …) and wiki slugs are remapped. Categories and tags are `INSERT OR IGNORE` by original ID/name. |
| `add-vault` | Creates a new vault DB → `switchVault()` → runs replace logic on the empty DB. User ends up in the new vault. |

**Images:** restored via `save_image` (SHA-256 dedup — identical image written to disk only once regardless of how many entries reference it).

## Rules for Future Schema Changes

- Prefer additive migrations (new columns, new tables) over destructive changes.
- Never rename a column that's already in production without a lazy migration strategy.
- New boolean fields: `INTEGER NOT NULL DEFAULT 0` (or `1` if the safe default is true).
- New array/object fields: `TEXT` stored as JSON string.
- New image-backed fields: reuse the file-based pipeline (`save_image` / `copy_image_file`) — never store base64 blobs in SQLite.
- When adding a column to a table that may already exist: wrap in `try { ALTER TABLE … ADD COLUMN … } catch { /* exists */ }`.
