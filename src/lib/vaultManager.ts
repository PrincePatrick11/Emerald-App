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
let _activeVaultIdSync = '';

/**
 * Joins path segments with the platform's separator.
 *
 * Der Trenner kommt von der Plattform, nicht aus dem Pfad. Ein POSIX-Ordner
 * darf einen Backslash im Namen tragen; wer daraus auf Windows schliesst, baut
 * einen Pfad, unter dem SQLite eine neue leere Datenbank anlegt — waehrend die
 * Bild-Commands den Ordner weiter korrekt aus der Registry aufloesen und Bilder
 * anzeigen. Das sieht dann aus wie Datenverlust.
 */
export function joinPath(dir: string, ...segments: string[]): string {
  const sep = isWindows ? '\\' : '/';
  // Nur auf `sep` pruefen, nicht auf beide Trenner: ein POSIX-Ordner, dessen
  // Name auf einen Backslash endet, bekaeme sonst keinen Trenner angehaengt.
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
    // Windows legt weder Ordner mit Punkt noch mit Leerzeichen am Ende an.
    .replace(/[\s.]+$/, '')
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return 'vault';
  // Die Geraetenamen gelten unter Windows auch mit Endung — `CON.txt` ist
  // ebenso wenig anlegbar wie `CON`. Geprueft wird deshalb der Stamm vor dem
  // ersten Punkt, samt der beiden Konsolen-Streams.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\.|$)/i.test(cleaned);
  // Eine Pfadkomponente ist auf ext4 und APFS auf 255 *Bytes* begrenzt, unter
  // NTFS auf 255 UTF-16-Einheiten. Ein Name aus Emoji reisst die Byte-Grenze
  // lange vor der Zeichengrenze — deshalb wird in Bytes gemessen und der
  // Rest so gekuerzt, dass kein Zeichen zerschnitten wird.
  return capBytes(reserved ? `${cleaned}_vault` : cleaned, 200);
}

/** Truncates to at most `max` UTF-8 bytes without splitting a character. */
function capBytes(value: string, max: number): string {
  if (new TextEncoder().encode(value).length <= max) return value;
  let out = '';
  let used = 0;
  // Ueber den String iterieren, nicht ueber seine Code-Units: ein Emoji ist ein
  // Surrogatpaar, und eine Haelfte davon ist kein gueltiger Dateiname.
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

  // Kein `vaults.json` heisst zweierlei: entweder hat diese Installation noch
  // nie eine Datenbank gehabt — dann fuehrt der Erststart durchs Vault-Modal —,
  // oder sie stammt aus der Zeit vor Multi-Vault und ihre `emerald.db` liegt
  // laengst da. Der Unterschied entscheidet zwischen Onboarding und einem
  // Nutzer, der vor seinem eigenen, scheinbar leeren Journal sitzt.
  if (parsed === null && !(await invoke<boolean>('legacy_default_db_exists'))) {
    const data: VaultsFile = { version: 2, vaults: [], activeVaultId: '' };
    _cached = data;
    _activeVaultIdSync = '';
    await syncRegistry(data);
    // Bewusst nicht geschrieben: ein abgebrochener Erststart bleibt einer.
    return data;
  }

  const legacy = parsed?.vaults ?? [];
  // Nur fuer die Legacy-Installation von oben. Eine vorhandene Datei mit leerer
  // Liste ist jemand, der seine Vaults entfernt hat — dem einen `default`
  // unterzuschieben, hiesse ihn samt leerem Ordner wieder auferstehen zu lassen.
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

  // Der Rueckfall geht auf den ersten vorhandenen Vault, nicht auf `default`:
  // seit der Erststart die Liste leer laesst, ist ein `default`-Eintrag nicht
  // mehr garantiert. Eine Id zurueckzugeben, die die Registry nicht kennt,
  // wuerde `getDb()` an `ensure_vault_dirs` scheitern lassen, waehrend
  // `getActiveVaultPath()` munter den Pfad des ersten Vaults liefert.
  const activeVaultId = vaults.some((v) => v.id === parsed?.activeVaultId)
    ? parsed!.activeVaultId!
    : (vaults[0]?.id ?? '');

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
  // Kein Rueckfall auf `vaults[0]`: der wuerde eine fremde Datenbank unter der
  // Id einer anderen oeffnen. Waehrend des Erststarts ist das der normale
  // Zustand — deshalb montiert `AppShell` den Shell-Inhalt dann gar nicht erst.
  if (!active) throw new Error('NO_ACTIVE_VAULT');
  return active.path;
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
  return joinPath(await getActiveVaultPath(), DB_FILE);
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

/** Where a vault with this id would land without a user-chosen location. */
export function defaultVaultDir(vaultId: string): Promise<string> {
  return invoke<string>('default_vault_dir', { vaultId });
}

/**
 * The folder new vaults are offered in — `{documentDir}/Emerald`.
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
 * Without a `path` it falls back to `{appDataDir}/vaults/{id}` — the route the
 * backup import takes, where an id-named folder is what keeps two imports of
 * the same name from landing on top of each other. The vault modal always
 * passes a path, built from the documents folder and the vault's name.
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
    // Bedingt gespreizt, damit `'icon' in vault` dasselbe bedeutet wie nach
    // `applyVaultPatch(..., { icon: null })` — dort verschwindet der Key.
    ...(opts.icon !== undefined && { icon: opts.icon }),
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
  try {
    await invoke('create_vault_dirs', { vaultId: vault.id });
  } catch (err) {
    // Die Registrierung muss zuerst passieren — `create_vault_dirs` loest die
    // Id gegen die Registry auf und kennt einen unregistrierten Vault nicht.
    // Scheitert das Anlegen trotzdem (macOS verweigert den Ordner unter TCC,
    // Windows den Namen, das Ziel ist schreibgeschuetzt), muss der Eintrag
    // wieder weg: sonst stuende ein Vault in der Liste, dessen Ordner nie
    // entstehen kann und an dem jedes `getDb()` scheitert.
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
 */
export async function removeVault(
  id: string,
  deleteFiles = false,
  nextActiveId?: string,
): Promise<void> {
  if (deleteFiles) {
    await invoke('delete_vault_files', { vaultId: id });
  }
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.filter((v) => v.id !== id),
    activeVaultId: nextActiveId ?? data.activeVaultId,
  });
}

/** Invalidate in-memory cache (e.g. after an external write). */
export function invalidateVaultCache(): void {
  _cached = null;
}
