import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { closeArchive, EmeraldNotice, openArchiveAsking, type OpenedArchive } from './emerald/file';
import type { EmeraldManifest } from './emerald/manifest';
import type { ImportMode, OpenedVaultFile } from './dbBackup';
import type { ImportTarget, MarkdownFile } from './emeraldFormat';
import { asRecord, oneOf } from './helpers';
import i18n from '../i18n';
import { IMPORT_EXTENSIONS, isImportPath } from './importPaths';

/**
 * The import window's files: which ones it takes, opening one to see what it
 * is, and what the window remembers. The imports themselves are
 * `lib/emeraldFormat.ts` (entries, templates, Markdown) and `lib/dbBackup.ts`
 * (a vault's content, a raw backup).
 */

/** The open dialog with the endings the window takes. `null`: cancelled. */
export async function pickImportFile(filterName: string): Promise<string | null> {
  const picked = await openDialog({
    filters: [{ name: filterName, extensions: [...IMPORT_EXTENSIONS] }],
    multiple: false,
  });
  return (Array.isArray(picked) ? picked[0] : picked) ?? null;
}

/** The file's name, for the window. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * An opened file and what it holds. Entries and templates, a vault's content
 * and a raw backup stay open (their pictures are still in the file) until
 * `closeImportSource`.
 */
export type ImportSource =
  | { kind: 'markdown'; path: string; markdown: MarkdownFile }
  | { kind: 'items'; path: string; opened: OpenedArchive; manifest: EmeraldManifest; existing: Map<string, string> }
  | { kind: 'vault' | 'raw'; path: string; protected: boolean; file: OpenedVaultFile };

/**
 * Opens the file at `path` and finds out what it is — asking for a password
 * only when the file needs one. `null`: cancelled at the question. A file
 * that cannot be read is an `EmeraldNotice`.
 */
export async function openImportFile(path: string): Promise<ImportSource | null> {
  if (!isImportPath(path)) throw new EmeraldNotice(i18n.t('importWindow.notImportable'));
  if (/\.md$/i.test(path)) {
    const { readMarkdownFile } = await import('./emeraldFormat');
    return { kind: 'markdown', path, markdown: await readMarkdownFile(path) };
  }
  const opened = await openArchiveAsking(path);
  if (!opened) return null;
  try {
    if (opened.kind === 'items') {
      const { existingItemsOf, itemsManifestOf } = await import('./emeraldFormat');
      const manifest = itemsManifestOf(opened);
      return { kind: 'items', path, opened, manifest, existing: existingItemsOf(manifest) };
    }
    const { openedVaultFile } = await import('./dbBackup');
    return { kind: opened.kind, path, protected: opened.protected, file: await openedVaultFile(opened) };
  } catch (err) {
    closeArchive(opened.ticket);
    throw err;
  }
}

/** Lets go of an opened file that is done with or will not be imported. */
export function closeImportSource(source: ImportSource): void {
  if (source.kind === 'items') closeArchive(source.opened.ticket);
  else if (source.kind !== 'markdown') closeArchive(source.file.ticket);
}

// ── What the window remembers ────────────────────────────────────────────────

export type ImportLevel = 'normal' | 'advanced';
/** What happens to items of a file this vault already has. */
export type ExistingChoice = 'copy' | 'skip';

export interface ImportPrefs {
  level: ImportLevel;
  /** For a vault's content. Replacing is never remembered: it is chosen anew each time. */
  vaultMode: Exclude<ImportMode, 'replace'>;
  /** Under Advanced; Normal creates them as copies, as an import always did. */
  existing: ExistingChoice;
  /** Where entries without a category go, as `none`, `dashboard:<id>` or `category:<id>` — per vault. */
  target: string;
}

const PREFS_KEY = 'import-window-prefs';
const vaultPrefsKey = (vaultId: string) => `${PREFS_KEY}:${vaultId}`;

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    return asRecord(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function loadImportPrefs(vaultId: string): ImportPrefs {
  const shared = readJson(PREFS_KEY);
  const own = vaultId ? readJson(vaultPrefsKey(vaultId)) : {};
  return {
    level: oneOf(shared.level, ['normal', 'advanced'] as const, 'normal'),
    vaultMode: oneOf(shared.vaultMode, ['add-vault', 'merge'] as const, 'add-vault'),
    existing: oneOf(shared.existing, ['copy', 'skip'] as const, 'copy'),
    target: typeof own.target === 'string' ? own.target : 'none',
  };
}

export function saveImportPrefs(prefs: ImportPrefs, vaultId: string): void {
  const { target, ...shared } = prefs;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(shared));
    if (vaultId) localStorage.setItem(vaultPrefsKey(vaultId), JSON.stringify({ target }));
  } catch { /* not remembered, no harm */ }
}

/**
 * A remembered target as a target — one whose dashboard or category is gone
 * since becomes no target. `live`: the dashboards and categories there are.
 */
export function targetOf(value: string, live: { dashboards: ReadonlySet<string>; categories: ReadonlySet<string> }): ImportTarget {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'dashboard' && live.dashboards.has(id)) return { kind: 'dashboard', id };
  if (kind === 'category' && live.categories.has(id)) return { kind: 'category', id };
  return { kind: 'none' };
}

export function targetValue(target: ImportTarget): string {
  return target.kind === 'none' ? 'none' : `${target.kind}:${target.id}`;
}
