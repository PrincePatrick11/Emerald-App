# Sync

A vault can sync through a server that only sees ciphertext. This file describes the part inside the app: how changes are captured and how a device merges what others did. Nothing calls it yet: there is no transport, no encryption of changes and no settings page, so no vault is tracked. `npm run check:sync` tests it.

## Capture

`lib/sync/tracking.ts`. Triggers on every table but `schema_version` write to `_sync_log`: table, row id, `I`/`U`/`D`, and for an update the names of the columns that really changed. So none of the SQL in the stores has to know, a whole-row write that changes nothing leaves no trace, and foreign key actions are captured like any other write.

- **Names, not values.** The values are read when pushing. An entry saved a hundred times between two pushes is one change, and the log stays small and holds no content.
- **Only connected vaults carry anything.** `startTracking` creates `_sync_log`, `_sync_ctx`, `_sync_meta` and the triggers; `stopTracking` removes them, apart from SQLite's own `sqlite_sequence`.
- **`pendingRows`** folds the log into one entry per row. Created and deleted between two pushes vanishes. Deleted and written back under the same id (Undo) goes out as the whole row.
- **`collectChanges`** returns the changes and a log position, and `acknowledge` removes the log up to that position once the server has them. Every change carries the whole row and the names of the changed columns: a device holding the row takes those columns, a device that no longer holds it restores it.
- **`_sync_ctx.applying`** silences the triggers. It is set inside the `db.batch` that applies remote changes, so it is only ever visible to that transaction.

## Snapshots

Some changes are not for a log, and `markSnapshotNeeded` empties the log and asks for a snapshot instead:

- **A migration** changes rows on every device on its own. `runMigrations` notes the snapshot before the chain and drops the triggers for it, since `DROP COLUMN` fails while a trigger names the column and a rebuild would drag them along. Every open of a tracked vault rebuilds the triggers from the current columns.
- **A backup import** empties and refills every table (`importViaStaging`).
- **Starting to track.** What the vault already holds is in no log.

A new device always starts from a snapshot, since a fresh vault seeds categories under new ids.

## Merging

The server keeps the order and nothing else: it refuses a push from a device that has not seen everything. A device behind it pulls, resolves in `lib/sync/apply.ts` on top of what it has not pushed, and pushes the result as ordinary changes. So there are no clocks and no per-column versions, and all devices end with the same rows.

| Case | Result |
| --- | --- |
| Different columns of one row | Both stay |
| Both changed `entries.content` to different text | The entry takes the incoming text; a new entry, titled by `conflictTitle`, keeps this device's |
| Both changed any other column | The device pushing later wins |
| Edited here, deleted there | The row stays and goes out whole |
| Deleted here, edited there | The row comes back with the edit |
| Same new tag name | This device's tag merges into the incoming one, tag lists included |
| Same `entry_number` | This device's entry takes the next free number |
| Same task link | This device's row goes |
| A reference left dangling (moved into a deleted category, placed on a deleted altar) | An optional reference is cleared, a row needing its parent goes |

Decisions of this device are written with the triggers on, so they reach the others. Everything runs in one `db.batch`, with `defer_foreign_keys`, so the order inside it does not matter and a failure changes nothing. The caller has to keep writers away between the reads and that batch, with the locks an import uses.

Table and column names in a change come from decrypted data and end up in SQL: `applyRemoteChanges` refuses any it does not know (`SYNC_UNKNOWN_SHAPE`) before writing.

## Tests

`scripts/sync-check.mjs` runs devices against an ordered list standing in for the server, on the real schema and migration runner: one test per rule above, and 300 seeded runs of random work on three devices that must converge with no dangling reference and no duplicate entry number.

It runs on `node:sqlite`, without SQLCipher and without the stores. A tracked vault in the running app, with an editor open while changes arrive, is not tested yet.
