import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { isWindows } from './platform';

export interface Vault {
  id: string;        // UUID; only a pre-`vaults.json` install still carries 'default'
  name: string;      // user-editable display name
  path: string;      // absolute directory holding emerald.db and images/
  createdAt: string; // ISO timestamp
  /** User-chosen emoji. Absent means the generic vault glyph. */
  icon?: string;
}

/**
 * `version` is not read anywhere, and records travel through this module whole
 * (`vaults.push(entry)`, `{ ...v, ...patch }`), so a field a newer build wrote —
 * `icon`, say — survives an older build round-tripping the file. It is bumped
 * only when the shape changes in a way that needs handling, not per field.
 */
interface VaultsFile {
  version: 2;
  vaults: Vault[];
  activeVaultId: string;
}

/** Pre-0.2.1 shape: every database sat flat in the app directory. */
interface LegacyVault {
  id: string;
  name: string;
  dbName: string;
  createdAt: string;
}

/** Mirrors `DB_FILE` in `src-tauri/src/vault.rs`. */
export const DB_FILE = 'emerald.db';
/** Mirrors `IMPORT_STAGING_FILE` in `src-tauri/src/vault.rs`. */
export const IMPORT_STAGING_FILE = 'emerald.db.import';

export interface VaultProbe {
  exists: boolean;
  /** The folder is there, but Emerald may not look inside — on macOS the
   *  normal answer for `~/Documents`, `~/Desktop` and iCloud as long as the
   *  user has not allowed access. */
  denied: boolean;
  has_db: boolean;
  is_empty: boolean;
}

let _cached: VaultsFile | null = null;
/**
 * The first call runs, the others wait for it.
 *
 * `loadVaultsFile` now triggers `migrate_vault_layout` and writes
 * `vaults.json`. Without this serialization two simultaneous first
 * callers would do both twice — `db.ts` solves the same problem with
 * `_initPromises`.
 */
let _loading: Promise<VaultsFile> | null = null;
let _vaultsPath: string | null = null;

/**
 * The active vault id, readable without awaiting.
 *
 * `imageSrc()` builds an `<img src>` during render and cannot await anything.
 * Nothing renders stored content before `loadVaultsFile()` has run — the
 * database cannot even be opened before it — so by the time any image needs a
 * URL this is populated.
 *
 * Not derivable from `_cached`: `invalidateVaultCache()` nulls that while the
 * active vault is unchanged, and an image rendering in that window would lose
 * its URL.
 */
let _activeVaultIdSync = '';

/**
 * Joins path segments with the platform's separator.
 *
 * The separator comes from the platform, not from the path. A POSIX folder
 * may carry a backslash in its name; whoever concludes Windows from that builds
 * a path under which SQLite creates a new empty database — while the
 * image commands keep resolving the folder correctly from the registry and show images.
 * That then looks like data loss.
 */
export function joinPath(dir: string, ...segments: string[]): string {
  const sep = isWindows ? '\\' : '/';
  // Check only for `sep`, not for both separators: a POSIX folder whose
  // name ends in a backslash would otherwise get no separator appended.
  return segments.reduce(
    (base, segment) => (base.endsWith(sep) ? `${base}${segment}` : `${base}${sep}${segment}`),
    dir,
  );
}

/**
 * Index of the last separator, by the same rule as {@link joinPath}: on POSIX a
 * backslash is an ordinary character in a folder name, so only `/` divides.
 */
function lastSeparator(path: string): number {
  return isWindows
    ? Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    : path.lastIndexOf('/');
}

/** A path split into its parent (separator included) and its last segment. */
export function splitPath(path: string): { parent: string; leaf: string } {
  const cut = lastSeparator(path);
  return cut < 0
    ? { parent: '', leaf: path }
    : { parent: path.slice(0, cut + 1), leaf: path.slice(cut + 1) };
}

/**
 * The folder's own name — the default vault name when opening one.
 *
 * Not {@link splitPath}: a path with a trailing separator has no last segment,
 * and the folder it names is the one before it.
 */
export function folderName(path: string): string {
  const parts = isWindows ? path.split(/[\\/]/) : path.split('/');
  return parts.filter(Boolean).pop() ?? path;
}

/** The directory holding a file. */
export function parentDir(filePath: string): string {
  const cut = lastSeparator(filePath);
  if (cut < 0) return filePath;
  const parent = filePath.slice(0, cut);
  // A bare root (`/x`) or drive letter (`C:\x`) keeps its separator — without
  // it neither is a directory any more.
  return parent === '' || /^[A-Za-z]:$/.test(parent) ? parent + filePath[cut] : parent;
}

/**
 * A vault's display name turned into a folder name.
 *
 * Not the export sanitizer from `export.ts`: that one builds a *filename* and
 * turns spaces into underscores, which would make "Mein Vault" the folder
 * `Mein_Vault`. A folder should read like the vault it holds.
 *
 * What has to go is what the filesystem refuses or what could leave the folder
 * it was joined onto — separators, `..`, the Windows-reserved characters, and
 * the device names that are not filenames on Windows no matter the extension.
 */
export function vaultFolderName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    // Windows creates neither folders ending in a dot nor in a space.
    .replace(/[\s.]+$/, '')
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return 'vault';
  // The device names apply on Windows even with an extension — `CON.txt` can
  // no more be created than `CON`. So the stem before the
  // first dot is checked, along with the two console streams.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\.|$)/i.test(cleaned);
  // A path component is limited to 255 *bytes* on ext4 and APFS, to
  // 255 UTF-16 units on NTFS. A name made of emoji breaks the byte limit
  // long before the character limit — so it is measured in bytes and the
  // rest is shortened such that no character is cut apart.
  return capBytes(reserved ? `${cleaned}_vault` : cleaned, 200);
}

/** Truncates to at most `max` UTF-8 bytes without splitting a character. */
function capBytes(value: string, max: number): string {
  if (new TextEncoder().encode(value).length <= max) return value;
  let out = '';
  let used = 0;
  // Iterate over the string, not over its code units: an emoji is a
  // surrogate pair, and half of it is not a valid file name.
  for (const char of value) {
    const size = new TextEncoder().encode(char).length;
    if (used + size > max) break;
    out += char;
    used += size;
  }
  return out.replace(/[\s.]+$/, '') || 'vault';
}

async function getVaultsPath(): Promise<string> {
  if (_vaultsPath) return _vaultsPath;
  _vaultsPath = joinPath(await appDataDir(), 'vaults.json');
  return _vaultsPath;
}

/**
 * Mirrors the vault list into the Rust registry.
 *
 * Every storage command resolves a vault *id* against that registry rather
 * than accepting a path, so this has to run before anything touches vault
 * storage, and again after every write.
 *
 * It deliberately does *not* feed `resolve_allowed_roots` — see the trust
 * boundary in `Documentation/security.md`.
 */
async function syncRegistry(data: VaultsFile): Promise<void> {
  await invoke('register_vaults', {
    vaults: data.vaults.map((v) => ({ id: v.id, path: v.path })),
  });
}

/**
 * Moves a vault into its own directory and returns the record in the new shape.
 *
 * This is not a database migration — the `.db` file itself moves, before
 * anything opens it. See `migrate_vault_layout` in `src-tauri/src/vault.rs`.
 */
async function adoptLayout(vault: LegacyVault): Promise<Vault> {
  const path = await invoke<string>('migrate_vault_layout', {
    vaultId: vault.id,
    legacyDbName: vault.dbName,
  });
  return { id: vault.id, name: vault.name, path, createdAt: vault.createdAt };
}

export async function loadVaultsFile(): Promise<VaultsFile> {
  if (_cached) return _cached;
  if (_loading) return _loading;
  _loading = readVaultsFile().finally(() => { _loading = null; });
  return _loading;
}

async function readVaultsFile(): Promise<VaultsFile> {
  await invoke('ensure_app_storage_dirs');
  const path = await getVaultsPath();

  let parsed: { vaults?: (Vault | LegacyVault)[]; activeVaultId?: string } | null = null;
  try {
    parsed = JSON.parse(await invoke<string>('read_file', { path }));
  } catch {
    // No file yet — first run, or an installation that predates multi-vault.
  }

  // No `vaults.json` means one of two things: either this installation has never
  // had a database — then the first start leads through the vault picker —,
  // or it dates from the time before multi-vault and its `emerald.db` has
  // long been there. The difference decides between onboarding and a
  // user sitting in front of their own, apparently empty journal.
  if (parsed === null && !(await invoke<boolean>('legacy_default_db_exists'))) {
    const data: VaultsFile = { version: 2, vaults: [], activeVaultId: '' };
    _cached = data;
    _activeVaultIdSync = '';
    await syncRegistry(data);
    // Deliberately not written: an aborted first start stays a first start.
    return data;
  }

  const legacy = parsed?.vaults ?? [];
  // Only for the legacy installation from above. An existing file with an empty
  // list is someone who removed their vaults — slipping a `default` in
  // would mean resurrecting it along with an empty folder.
  if (parsed === null && !legacy.some((v) => v.id === 'default')) {
    legacy.unshift({ id: 'default', name: 'Emerald', dbName: 'emerald.db', createdAt: new Date(0).toISOString() });
  }

  // A record already carrying `path` has been through this; one still carrying
  // `dbName` has not. Both shapes can coexist if a previous run was cut short.
  const vaults: Vault[] = [];
  let migrated = false;
  for (const entry of legacy) {
    if ('path' in entry && entry.path) {
      vaults.push(entry);
      continue;
    }
    vaults.push(await adoptLayout(entry as LegacyVault));
    migrated = true;
  }

  // The fallback goes to the first existing vault, not to `default`:
  // since the first start leaves the list empty, a `default` entry is no
  // longer guaranteed. Returning an id the registry does not know
  // would make `getDb()` fail at `ensure_vault_dirs`, while
  // `getActiveVaultPath()` cheerfully delivers the first vault's path.
  const activeVaultId = vaults.some((v) => v.id === parsed?.activeVaultId)
    ? parsed!.activeVaultId!
    : (vaults[0]?.id ?? '');

  const data: VaultsFile = { version: 2, vaults, activeVaultId };
  _cached = data;
  _activeVaultIdSync = activeVaultId;

  // Only write if something has really changed — a start on an
  // already migrated installation then does not touch the file at all.
  if (migrated || parsed === null || parsed.activeVaultId !== activeVaultId) {
    await saveVaultsFile(data);
  } else {
    await syncRegistry(data);
  }

  return data;
}

export async function saveVaultsFile(data: VaultsFile): Promise<void> {
  const path = await getVaultsPath();
  await invoke('write_file', { path, content: JSON.stringify(data, null, 2) });
  _cached = data;
  _activeVaultIdSync = data.activeVaultId;
  await syncRegistry(data);
}

/** The active vault's directory. */
export async function getActiveVaultPath(): Promise<string> {
  const data = await loadVaultsFile();
  const active = data.vaults.find((v) => v.id === data.activeVaultId);
  // No fallback to `vaults[0]`: that would open someone else's database under the
  // id of another. During the first start this is the normal
  // state — which is why `AppShell` then does not even mount the shell content.
  if (!active) throw new Error('NO_ACTIVE_VAULT');
  return active.path;
}

/**
 * The active vault's database file, as an absolute path — for SQL that names a
 * file (`VACUUM INTO`, `ATTACH`). Opening the database goes by vault id
 * (`Database.load`).
 */
export async function getActiveDbFile(): Promise<string> {
  return joinPath(await getActiveVaultPath(), DB_FILE);
}

/** The working copy of a backup import in the active vault (`importStaging.ts`). */
export async function getActiveImportStagingFile(): Promise<string> {
  return joinPath(await getActiveVaultPath(), IMPORT_STAGING_FILE);
}

export async function getActiveVaultId(): Promise<string> {
  const data = await loadVaultsFile();
  return data.activeVaultId;
}

/** See `_activeVaultIdSync`. Only for render paths that cannot await. */
export function getActiveVaultIdSync(): string {
  return _activeVaultIdSync;
}

export async function setActiveVaultId(id: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, activeVaultId: id });
}

/** What a directory picked in the folder dialog already contains. */
export function probeVaultDir(path: string): Promise<VaultProbe> {
  return invoke<VaultProbe>('probe_vault_dir', { path });
}

/**
 * Where a vault that is about to be created will land. A self-picked folder
 * beats the offered base folder out of the running; under that the name becomes
 * the folder name. Without a name there is no folder yet — the appended separator
 * shows that one is about to go there. Nothing can be committed in that state
 * anyway.
 */
export function newVaultTarget(
  baseDir: string | null,
  customPath: string | null,
  name: string,
): string | null {
  if (customPath) return customPath;
  if (!baseDir) return null;
  return name.trim() ? joinPath(baseDir, vaultFolderName(name)) : joinPath(baseDir, '');
}

/** Why a folder cannot take a *new* vault — or `null` when it can. */
export type NewVaultTargetProblem = 'alreadyOpen' | 'denied' | 'hasVault' | 'notEmpty';

/**
 * The message each problem gets. Lives beside {@link probeNewVaultTarget} so
 * the vault picker and the backup import cannot drift apart in what they tell
 * the user about the same folder.
 */
export const NEW_VAULT_TARGET_ERROR_KEY: Record<NewVaultTargetProblem, string> = {
  alreadyOpen: 'vault.alreadyOpen',
  denied: 'vault.accessDenied',
  hasVault: 'vault.folderHasVault',
  notEmpty: 'vault.folderNotEmpty',
};

/**
 * Checks a folder a new vault is meant to be created in.
 *
 * `denied` first: a denied probe reports `has_db=false` and
 * `is_empty=false` and would otherwise pass as "no vault"/"not empty". A
 * new vault belongs in an empty folder — otherwise its files mix
 * with foreign ones, and "Delete files" would later have to decide which
 * of them belong to it. A folder that does not exist at all is the
 * normal case; `create_vault_dirs` creates it.
 *
 * `alreadyOpen` catches the case that the file probe does not see: the folder
 * is already *registered* as a vault but is currently not on the disk
 * (deleted, drive unplugged — "Folder not found" in the vault picker).
 * Without the check it would pass here as empty, `create_vault_dirs`
 * would create it anew, and two vault ids would share one folder — whereupon
 * "Delete files" on one would pull the rug out from under the other.
 */
export async function probeNewVaultTarget(path: string): Promise<NewVaultTargetProblem | null> {
  const { vaults } = await loadVaultsFile();
  if (vaults.some((v) => v.path === path)) return 'alreadyOpen';
  const probe = await probeVaultDir(path);
  if (probe.denied) return 'denied';
  if (probe.has_db) return 'hasVault';
  if (probe.exists && !probe.is_empty) return 'notEmpty';
  return null;
}

/** Where a vault with this id would land without a user-chosen location. */
export function defaultVaultDir(vaultId: string): Promise<string> {
  return invoke<string>('default_vault_dir', { vaultId });
}

/**
 * The folder new vaults are offered in — `{documentDir}/Emerald Vaults`.
 *
 * The vault's own folder is that plus {@link vaultFolderName}, so the path can
 * be shown while the name is still being typed.
 */
export function newVaultBaseDir(): Promise<string> {
  return invoke<string>('new_vault_base_dir');
}

/**
 * Builds the record for a new vault.
 *
 * Without a `path` it falls back to `{appDataDir}/vaults/{id}` — the reserve
 * for the case that the documents folder cannot be resolved: an id-named
 * folder there can never collide. The vault picker and the backup import
 * normally pass a path, built from the documents folder and the vault's name
 * or picked by the user (see {@link newVaultTarget}).
 */
export async function newVaultRecord(
  name: string,
  opts: { path?: string; icon?: string } = {},
): Promise<Vault> {
  const id = crypto.randomUUID();
  return {
    id,
    name,
    path: opts.path ?? (await defaultVaultDir(id)),
    createdAt: new Date().toISOString(),
    // Conditionally spread, so that `'icon' in vault` means the same as after
    // `applyVaultPatch(..., { icon: null })` — there the key disappears.
    ...(opts.icon !== undefined && { icon: opts.icon }),
  };
}

/**
 * The single funnel through which a vault enters the list — the vault picker,
 * and the `add-vault` backup import. Creating the directory here means
 * `getDb()` never has to, which is what lets it treat a missing directory as
 * the error it is instead of silently starting an empty vault.
 */
export async function addVault(vault: Vault): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, vaults: [...data.vaults, vault] });
  try {
    await invoke('create_vault_dirs', { vaultId: vault.id });
  } catch (err) {
    // Registration has to happen first — `create_vault_dirs` resolves the
    // id against the registry and does not know an unregistered vault.
    // If creation fails anyway (macOS denies the folder under TCC,
    // Windows the name, the target is write-protected), the entry has to
    // go again: otherwise a vault would stand in the list whose folder can never
    // come into being and on which every `getDb()` fails.
    await saveVaultsFile(data);
    throw err;
  }
}

export interface VaultPatch {
  name?: string;
  /** `null` resets to the generic glyph; `undefined` leaves the icon alone. */
  icon?: string | null;
}

/**
 * Applies a patch to one record. Exported because the store mirrors the same
 * change into its own list and both have to agree on what `icon: null` means —
 * the key is removed, not written as `null`.
 */
export function applyVaultPatch(vault: Vault, patch: VaultPatch): Vault {
  const next: Vault = { ...vault };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.icon === null) delete next.icon;
  else if (patch.icon !== undefined) next.icon = patch.icon;
  return next;
}

/**
 * Edits a vault's display fields. Name and icon go in one write, because the
 * modal edits them in one step and a cancel has to leave both untouched.
 */
export async function updateVault(id: string, patch: VaultPatch): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.map((v) => (v.id === id ? applyVaultPatch(v, patch) : v)),
  });
}

/** Points an existing vault at a different directory — used to repair a vault
 *  whose folder was moved or renamed. */
export async function relocateVault(id: string, path: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.map((v) => (v.id === id ? { ...v, path } : v)),
  });
}

/**
 * Removes a vault from the list. `deleteFiles` additionally erases its
 * directory — irreversibly, and only if that directory really holds a vault
 * database (see `delete_vault_files`).
 *
 * The files are deleted while the vault is still registered: the command
 * resolves the id against the registry, and an unregistered id has no path.
 *
 * `nextActiveId` exists because removing the *active* vault has to clear the
 * role in the same write. Leaving it for a second write would put
 * `vaults.json` briefly in a state where the active vault is not in its own
 * list — what `getActiveVaultPath()` answers with `NO_ACTIVE_VAULT`. The
 * successor is chosen afterwards and written separately; that write is
 * harmless, because by then the file is consistent either way.
 *
 * Returns whether the vault's *folder* is gone. `delete_vault_files` removes
 * only the vault's own artefacts and leaves the folder standing as soon as
 * anything else lies in it — `false` is that case, and the modal tells it.
 */
export async function removeVault(
  id: string,
  deleteFiles = false,
  nextActiveId?: string,
): Promise<boolean> {
  let dirRemoved = true;
  if (deleteFiles) {
    dirRemoved = await invoke<boolean>('delete_vault_files', { vaultId: id });
  }
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.filter((v) => v.id !== id),
    activeVaultId: nextActiveId ?? data.activeVaultId,
  });
  return dirRemoved;
}

/** Invalidate in-memory cache (e.g. after an external write). */
export function invalidateVaultCache(): void {
  _cached = null;
}
