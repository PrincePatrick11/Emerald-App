import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { isWindows } from './platform';

export interface Vault {
  id: string;        // 'default' for the original vault, UUID for others
  name: string;      // user-editable display name
  path: string;      // absolute directory holding emerald.db and images/
  createdAt: string; // ISO timestamp
}

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
const DB_FILE = 'emerald.db';

export interface VaultProbe {
  exists: boolean;
  /** Der Ordner ist da, aber Emerald darf nicht hineinsehen — auf macOS die
   *  normale Antwort fuer `~/Documents`, `~/Desktop` und iCloud, solange der
   *  Nutzer den Zugriff nicht erlaubt hat. */
  denied: boolean;
  has_db: boolean;
  is_empty: boolean;
}

let _cached: VaultsFile | null = null;
/**
 * Der erste Aufruf laeuft, die uebrigen warten darauf.
 *
 * `loadVaultsFile` stoesst inzwischen `migrate_vault_layout` an und schreibt
 * `vaults.json`. Ohne diese Serialisierung wuerden zwei gleichzeitige erste
 * Aufrufer beides doppelt tun — `db.ts` loest dasselbe Problem mit
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
let _activeVaultIdSync = 'default';

async function getVaultsPath(): Promise<string> {
  if (_vaultsPath) return _vaultsPath;
  const dir = await appDataDir();
  // Normalize trailing separator
  _vaultsPath = dir.endsWith('/') || dir.endsWith('\\')
    ? `${dir}vaults.json`
    : `${dir}/vaults.json`;
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

  const legacy = parsed?.vaults ?? [];
  if (!legacy.some((v) => v.id === 'default')) {
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

  const activeVaultId = vaults.some((v) => v.id === parsed?.activeVaultId)
    ? parsed!.activeVaultId!
    : 'default';

  const data: VaultsFile = { version: 2, vaults, activeVaultId };
  _cached = data;
  _activeVaultIdSync = activeVaultId;

  // Nur schreiben, wenn sich wirklich etwas geaendert hat — ein Start auf einer
  // bereits migrierten Installation fasst die Datei dann gar nicht an.
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
  return active?.path ?? data.vaults[0].path;
}

/**
 * The active vault's database file, as an absolute path.
 *
 * `tauri-plugin-sql` joins its connection string onto the app directory with
 * `PathBuf::push`, which an absolute path replaces outright — so a full path
 * here lands exactly where it says (`path_mapper` in the plugin's
 * `wrapper.rs`).
 */
export async function getActiveDbFile(): Promise<string> {
  const dir = await getActiveVaultPath();
  // Der Trenner kommt von der Plattform, nicht aus dem Pfad. Ein POSIX-Ordner
  // darf einen Backslash im Namen tragen; wer daraus auf Windows schliesst,
  // baut einen Pfad, unter dem SQLite eine neue leere Datenbank anlegt —
  // waehrend die Bild-Commands den Ordner weiter korrekt aus der Registry
  // aufloesen und Bilder anzeigen. Das sieht dann aus wie Datenverlust.
  const sep = isWindows ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${DB_FILE}` : `${dir}${sep}${DB_FILE}`;
}

/**
 * Derselbe Pfad, aber als `sqlite:`-Connection-String.
 *
 * `tauri-plugin-sql` reicht den String an sqlx weiter, und sqlx liest ihn als
 * URL: `?` beginnt die Query, `#` das Fragment, und `%XY` wird dekodiert
 * (`sqlx-sqlite/src/options/parse.rs`: „% decode to allow for `?` or `#` in
 * the filename"). Ein Ordner namens `50%` wuerde sonst als `P` geoeffnet.
 * Kodiert wird deshalb hier, dekodiert von sqlx.
 */
export async function getActiveDbConnectionString(): Promise<string> {
  const file = await getActiveDbFile();
  // `%` zuerst, sonst kodiert der naechste Schritt die eigene Kodierung mit.
  const encoded = file.replace(/%/g, '%25').replace(/\?/g, '%3F').replace(/#/g, '%23');
  return `sqlite:${encoded}`;
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
 * Builds the record for a new vault. Without a path it lands in the app's own
 * vaults directory; with one, wherever the user pointed the folder dialog.
 */
export async function newVaultRecord(name: string, path?: string): Promise<Vault> {
  const id = crypto.randomUUID();
  return {
    id,
    name,
    path: path ?? (await invoke<string>('default_vault_dir', { vaultId: id })),
    createdAt: new Date().toISOString(),
  };
}

/**
 * The single funnel through which a vault enters the list — the vault modal,
 * and the `add-vault` backup import. Creating the directory here means
 * `getDb()` never has to, which is what lets it treat a missing directory as
 * the error it is instead of silently starting an empty vault.
 */
export async function addVault(vault: Vault): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, vaults: [...data.vaults, vault] });
  await invoke('create_vault_dirs', { vaultId: vault.id });
}

export async function updateVaultName(id: string, name: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.map((v) => (v.id === id ? { ...v, name } : v)),
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
 */
export async function removeVault(id: string, deleteFiles = false): Promise<void> {
  if (deleteFiles) {
    await invoke('delete_vault_files', { vaultId: id });
  }
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, vaults: data.vaults.filter((v) => v.id !== id) });
}

/** Invalidate in-memory cache (e.g. after an external write). */
export function invalidateVaultCache(): void {
  _cached = null;
}
