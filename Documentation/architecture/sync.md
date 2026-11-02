# Sync

A vault can sync through a server that only sees ciphertext ([Emerald Server](https://github.com/PrincePatrick11/Emerald-Server)). This file describes the part inside the app. `npm run check:sync` tests the capture and the merging.

A server has one sync key, and an installation talks to one server. Users connect it once, with its address and key, under Settings → Sync (`SyncPage`); the device trades the key for a token and does not keep it. Nothing goes to the server until a vault is put there, one by one. The same page lists the vaults on this device with their state, the other vaults on the server (`RemoteVaultList`), which can be fetched or deleted, and the connected devices.

Disconnecting a vault keeps its place on the server and goes on noting changes, so connecting it again brings them along. Deleting it from the server leaves the copies on the devices as local vaults; a device notices on its next sync. Disconnecting the server leaves vaults and links as they are, and connecting the same server again resumes them.

## The way to the server

`src-tauri/src/sync.rs` holds the network and the sealing, so the vault key and the token stay out of the webview and the CSP stays closed. `{appDataDir}/sync.json` holds the server with its token, and each vault's place there. Like `update.json` it belongs to the installation rather than a vault, so a vault's backup cannot bring a server along. It holds no secret: the token and the names key go to the OS keychain, since no vault is unlocked when the list is read. Without a keychain they stay in memory, and the sync key is asked for again after a restart. Vault names on the server are sealed under a key derived from the sync key: devices can read them without any vault's password, the server, which only has the key's hash, cannot. Changes and snapshots are compressed, then sealed with the `Sync` context under the `Files` subkey, since sealed data no longer compresses. A snapshot is a file of length-prefixed frames of about 8 MB of JSON, written and read one frame at a time, so a vault never has to fit in one string or in memory. Images travel as the sealed files they are. A vault's `vault.key` goes to the server too, still wrapped by the password: that is how another device unlocks the vault. Plain `http` is accepted only on this machine, a private address or a tailnet (`clean_url`). Requests time out per read, since a server that went away does not always say so.

`lib/sync/engine.ts` decides when: within two seconds if the log or the settings hold something new, at once when the server's event stream reports news from another device (`sync_watch`, which reconnects by itself), every minute in case that line is down, and at once on opening a vault that is being fetched. It does nothing while a vault waits for its password, since `getDb()` would fail on it and that failure sticks to the opening under way. It stands back while any page is in edit mode, changed or not: an editor holds its text from when it opened, and its next save would write that over a merge.

**Before a vault is replaced** by what another device published (a new epoch, a password change), this device writes an automatic backup of what it has, and nothing is replaced without it. There is one such file per day and vault. Replacing a vault that syncs by importing a backup says so first, since it replaces it everywhere.

**A password change** puts the vault under a new key with new image names, so a log cannot carry it. The device changing it syncs first, then publishes its vault as a new epoch with the new `vault.key` and asks the server to drop the images under old names (`rekeyed` in `sync.json` survives a crash until that is done). What another device pushed in between is lost. The other device notices that the snapshot does not open under its key (`SYNC_PASSWORD_CHANGED`), and asks for the new password under Settings → Sync. It proves that password against the server's `vault.key` and snapshot, removes its local copy and fetches anew. What it had not pushed goes back on top, except images saved since its last push, whose names no longer exist. A device that missed a change cannot put the old key back: publishing compares the key files first.

**Under load.** A push carries about 16 MB of JSON at most, so a long time offline becomes several pushes (`collectChanges`). Parents go first and deletes last, because a device applying the first part repairs any reference it cannot resolve; tasks stay together, since they point at each other. Once the log on the server holds more than 2000 changes, a device publishes a snapshot that replaces them; a device behind that fetches the snapshot and puts what it had not pushed back on top. A restore empties the vault and fills it frame by frame, so `_sync_meta.restoring` marks it until done, and a crash starts it over. What the device had not pushed is lost in that case.

**Settings** (`lib/sync/settings.ts`) travel key by key next to the changes, so a theme picked on one device and a trash retention picked on another both stay. The last synced values are in `_sync_meta.settings_base`; a key this device changed since then stands against an incoming one. The interface scale, editor font size, left list and the `backup` group stay on the device: sizes and lists depend on the screen, and whether a device backs up is that device's business.

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

It runs on `node:sqlite`, without SQLCipher and without the stores. Two running instances against a real server were driven by hand through the dev bridge, on macOS only: connecting, fetching, images, a conflict, editing while changes arrive, the server going away. That script is not in this repository.
