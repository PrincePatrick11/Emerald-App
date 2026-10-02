# Encryption and the SQL Layer

Every vault is encrypted. This file describes how: the key hierarchy, what is sealed and how, the SQL layer that opens the database, the unlock gate in the frontend, re-encryption, and encrypted backups. What the encryption protects against, and what it does not, is in [`security.md`](../security.md#vault-encryption); the user's view is in [`features.md`](../features.md#vault-encryption).

## Keys

A vault has one random 256-bit **vault key**. It is never derived from the password and never leaves Rust: `VaultKeys` (`keys.rs`) holds `vault id → key` for every unlocked vault, commands take a vault id and look the key up, and nothing returns it to the webview. Keys are `Zeroizing`, so they are wiped when dropped.

`vault.key` in the vault folder holds the vault key twice, each copy sealed (see [Sealed files](#sealed-files)) under a different wrapping key:

- **The password wrap.** The wrapping key is derived from the password with Argon2id (64 MiB, three passes, one lane; the parameters are stored in the file, so raising them later leaves existing vaults readable). A file that asks for more than 256 MiB, eight passes or four lanes is refused as damaged — a copied file must not be able to make unlocking take minutes.
- **The recovery wrap.** The wrapping key is 32 random bytes shown to the user once, as 52 base32 characters in groups of four. Parsing forgives case, dashes, spaces and the digits that look like letters (0/O, 1/I, 8/B).

A `check` value — an HMAC of a fixed label under the vault key — lets a key be verified before anything is opened with it: a key from the OS keychain, one held in memory after the vault was relocated, an unwrapped candidate. The minimum password length is eight characters; the frontend asks for the same (`MIN_PASSWORD_LENGTH` mirrors `MIN_PASSWORD_CHARS`).

The vault key is not used by any cipher directly. `crypto::subkey` derives one key per purpose — `Database` (SQLCipher's raw key), `Files` (sealed files) and `ImageNames` (the keyed hash that names images) — so no key ever serves two algorithms.

`vault.key` is written atomically (temp file, `fsync`, rename, and on Unix an `fsync` of the folder): an empty file under the real name after a power loss would mean a lost vault. A link is never read as `vault.key`, and a vault whose `vault.key` is a link still counts as encrypted.

### The OS keychain

"Remember on this device" stores the vault key in the OS keychain (`keyring` crate: Credential Manager, macOS Keychain, Secret Service) under the service `Emerald (<app identifier>)` and the account `vault:<id>`. The identifier is part of the service because the release build, the dev build and every MCP slot are separate apps whose vault ids (`default`) repeat — a shared name would let one overwrite, or wrongly delete, another's entry.

A remembered key is checked against `check` before it is used, and a keychain that does not answer is not an error: the password dialog follows. `vault_key_status` never touches the keychain; `vault_unlock_remembered` does, once, when it matters. The `rememberKey` argument of the unlock and create commands is tri-state — `undefined` leaves the keychain alone, so a keychain that failed to answer once cannot cost a valid entry. Every command that changes a key answers whether the key is remembered afterwards, so the dialog can say when the keychain refused. Deleting a vault's files forgets its key too.

## Sealed files

One format seals everything outside the database: images, `drafts.json`, backups, and the wrapped vault keys.

```text
"EMRC" | version (1 byte) | nonce (24 bytes) | XChaCha20-Poly1305 ciphertext + tag
```

The nonce is random per seal. The header, a **context** (vault key, image, drafts, backup) and — for an image — its file name are bound as associated data. A blob sealed as one thing cannot be passed off as another, and an image cannot be swapped in under a different name: it fails to open. `crypto::is_sealed` tells a sealed file from a plain one by its magic bytes.

- **Images** are sealed and named by a keyed hash (HMAC under the `ImageNames` subkey) instead of the SHA-256 of their bytes: the plain hash would let anyone holding a copy of a known picture confirm it is in the vault. The name stays 64 hex digits plus the extension, so nothing that reads names changes, and identical images still share one file. `images.rs` has two functions that touch image bytes, `store` and `load`. `load` returns an unsealed file as it is: the legacy shared pool the image handler falls back to is plain (see [Image Storage System](storage.md#image-storage-system)).
- **`drafts.json`** is sealed under the `Files` subkey; a plain one written before the vault was encrypted is still read.
- **`settings.json` stays plaintext.** It holds appearance and limits, no content, and the boot path reads it before any vault is unlocked.

## The SQL layer

`db.rs` is an own SQL layer rather than `tauri-plugin-sql`, which would open any path the webview named and offers no hook to key a connection. A database is named by **vault id plus a `DbFile`** — `main` (`emerald.db`) or `importStaging` (`emerald.db.import`) — and Rust resolves the path through the vault registry; the webview never names a path. `src/lib/sqlite.ts` keeps the plugin's interface (`load`, `execute`, `select`, `close`), so call sites are plain `execute`/`select` calls: `execute` returns `rowsAffected` and `lastInsertId`, `select` returns rows as objects in column order, and values bind and decode the way the plugin did. Like the plugin, each pool hands every statement to whichever connection is free, so a transaction holds only inside a single `execute` string (see [Foreign Keys](../database.md#foreign-keys)).

- **`db_load(vaultId, file)`** returns the handle (`{vaultId}/{file}`) the other three commands take. It refuses a vault without `vault.key`, and an encrypted database is created only for an encrypted vault: a plain database would have to exist already, and none does after the encryption step.
- **The key** is applied as SQLCipher's raw key (`PRAGMA key = "x'…'"`, from the `Database` subkey) on every connection of the pool before anything else, so SQLCipher skips its own key derivation.
- **An authorizer** (`sqlite3_set_authorizer`) runs on every connection, because the webview executes arbitrary SQL here. It refuses the key pragmas (`key`, `rekey` and their `hex`/`text` variants, `kdf_iter`, `hmac_*`), every `cipher_*` pragma but `cipher_version`, and `sqlcipher_export` — those would let SQL re-key the vault out from under `vault.key`, or write a plaintext copy anywhere. `ATTACH` is allowed only for the vault's own `emerald.db.import` and `emerald.db.pre-vNN.bak` (and the empty name `VACUUM` uses); `VACUUM INTO` attaches its target internally, so a migration backup passes. An attached file without a `KEY` inherits the main key, so these copies stay encrypted.
- **Locking** closes every pool of the vault (`close_vault`).
- **Dev builds only**: `reencrypt::dev_seed` encrypts, and afterwards unlocks, the MCP slot's seed vault with a test password named by `EMERALD_DEV_SEED_VAULT` and `EMERALD_DEV_SEED_PASSWORD` (set by the Emerald-Devtools launcher). It is compiled out of release builds, and any other folder goes through the normal dialog.

`libsqlite3-sys` is a direct dependency only for its `bundled-sqlcipher-vendored-openssl` feature: feature unification swaps the bundled SQLite under sqlx for SQLCipher with OpenSSL built from source (native build requirements: [`build.md`](../build.md#native-build-requirements)).

## The unlock gate

`ensureVaultReady` (`store/vaultKeyStore.ts`) is the one gate in front of every database. Every path that opens a vault — start, switching, creating, opening an existing folder, importing a backup as a new vault — runs through `openActiveVault` in `vaultStore.ts` or the start in `AppShell`, and so through the gate. Rust enforces the same on its side: `db_load` opens nothing without a key.

It asks `vault_key_status` (`hasDatabase`, `encrypted`, `unlocked`) and then:

- **encrypted and unlocked** — done;
- **encrypted, locked** — tries the remembered key (`vault_unlock_remembered`), then asks for the password;
- **plain, with a database** — asks for a password and encrypts the vault (`encrypt`, mandatory: a plain vault is never opened);
- **no database** — a new vault: asks for a password and creates the key (`create`).

`VaultKeyDialog` renders the question and has a fourth form, `recover` ("forgot password": recovery key plus a new password, which re-encrypts like a password change and returns a new recovery key). It sits above everything, the vault modal included, and it calls `hideSplash` on mount so the loading screen's fallback timer does not cover it. Cancelling rejects with `VAULT_KEY_CANCELLED`; `switchVault` goes back to the previous vault, and when a vault's successor cannot be unlocked the app falls back to vault setup (`closeToSetup`). The question is a promise held in module state, so the boot effect that React StrictMode starts twice waits on one dialog instead of cancelling the first.

Every question that creates a key ends on the new **recovery key** (`RecoveryKeyBox`, shown with Copy until the user confirms it is stored), and the recovery key comes back from a command exactly when it is created — after a commit it is always returned, even if reloading fails afterwards.

Leaving a vault locks it (`vault_lock`): its key does not stay in memory while another is open. `vaultStore.locked` is true while a lock-and-ask is in progress; `AppShell` then renders only the frame, so no content stands behind the password question.

`Modal` keeps a stack of open modals and gives Escape to the topmost only, since the unlock dialog opens over the vault modal and one key press must not close both; a non-dismissible modal on top swallows Escape for those below.

## Re-encrypting a vault

`reencrypt.rs` puts a vault under a new key. Two things need it: encrypting a vault from before encryption, and changing the password — which replaces the vault key as well, so that an old copy of `vault.key` (cloud version history) plus the old password opens nothing written since. Rewrapping alone would not give that.

Nothing in the vault is touched until a complete, checked copy under the new key sits next to it:

1. **Prepare.** `vault.key.pending`; the database exported into `emerald.db.reencrypting` with `sqlcipher_export`; every image sealed under its new keyed name into `images.reencrypting/`; every image name inside the copy rewritten; `drafts.json.reencrypting`. Image names are rewritten in every text column of every table — a name is 64 hex digits plus an image extension, unique enough that no schema knowledge is needed. The copy is then verified: `integrity_check` and the same row count in every table as the original.
2. **Commit.** The marker `vault.reencrypting` is written, naming the new key by its `check` value and the images to keep. Then database, `vault.key`, drafts and images are swapped in.
3. **Clean up.** The old database, its `.pre-vNN.bak` copies, the import staging copy, plain images and every image not named in the marker are deleted, then the marker. Encrypting a plain vault also seals the plain `.emeralddb` files in `<vault>/backup/` and clears the WebView's HTTP cache, where decrypted images could linger.

`recover_interrupted` makes a crash anywhere safe: without the marker the original is untouched and the half-made copy is thrown away; with it, the swap is finished, every step of it being repeatable. It runs from `vault_key_status` — the first call on every open — and is skipped while a run is in progress.

Before the commit the frontend closes the vault's connections (`withDbClosed`) and settles open edits and drafts (`resolveOpenEdits`, `detachDrafts`); afterwards it reloads everything, because image names changed. A change that fails before the commit leaves the vault as it was.

Images adopted from the legacy shared pool (migration v35) into an encrypted vault are sealed under their old SHA-256 names, since the content refers to those. They get a keyed name at the next password change.

## Encrypted backups

`backup.rs` writes and reads `.emeralddb` files; `write_file` and `read_file` refuse that extension, so no backup can be written in the clear by accident.

```text
"EMRB" | version (1 byte) | header length (u32 LE) | header JSON {keyFile} | sealed JSON
```

The payload is the JSON of [DB Backup / Restore](../database.md#db-backup--restore-emeralddb), sealed under the vault key's `Files` subkey with the `Backup` context. The header carries the vault's `vault.key` as it was at export time, so the backup opens with the password (or recovery key) the vault had **then** — after a later password change, which replaces the vault key, and on another machine.

Opening a backup (`read_backup_file`) tries the keys of the vaults that are unlocked right now first and opens without asking when one fits. Otherwise it answers `BACKUP_LOCKED`, and the frontend (`readBackupText` in `dbBackup.ts`) asks through `BackupUnlockDialog` — password or recovery key — repeating on a wrong answer until the backup opens or the user cancels. A file without the magic bytes is read as plain JSON, so backups from before encryption (format 12 and below) still import.

## Leftovers outside the vault

The PDF export writes the entry as an HTML file in the OS temp folder (see [PDF Export](shell.md#pdf-export)). `TempHtml` owns that file: created readable by its user only (mode `0600` on Unix), never logged by path, and deleted when it is dropped, however the export ends. `sweep_leftovers` runs at startup and removes `emerald-export-*.html` older than an hour — a second Emerald, such as the dev build beside the release, may be exporting right now.
