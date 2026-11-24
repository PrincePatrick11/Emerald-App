/**
 * The export menu's rules, without React: what it remembers, which entries a
 * collective export takes, and in which order. The selection by categories
 * and tags is the dashboards' own (`matchesFilter`); the period counts from
 * the day an entry was created.
 *
 * "Normal" fixes what "Advanced" lets one choose (`effectiveSettings`):
 * pictures balanced, linked entries only direct, oldest first, custom blocks
 * along, the collective export by a dashboard, PDF and HTML in the app's
 * editor font and text size — the choices made under "Advanced" stay
 * remembered for the next time.
 */
import { format, isValid, parseISO, startOfDay, startOfMonth, subDays } from 'date-fns';
import { matchesFilter, type LiveIds } from './dashboards';
import { asRecord, oneOf } from './helpers';
import { FULL_BACKUP_OPTIONS, type BackupOptions } from './dbBackup';
import { IMAGE_MODES, type ImageMode } from './emerald/manifest';
import { EXPORT_FONT_IDS, EXPORT_FONT_SIZES, type ExportFontId, type ExportTypography } from './exportFonts';
import type { DashboardFilter, Entry } from '../types';

export type ExportScope = 'entry' | 'bulk' | 'vault';
export type ExportLevel = 'normal' | 'advanced';
/** The formats of one entry or a collective export; a whole vault is always a `.vault.emerald`. */
export type ExportFormat = 'pdf' | 'html' | 'markdown' | 'emerald';
export type ExportPeriod = 'last7' | 'last30' | 'thisMonth' | 'all' | 'custom';
export type ExportOrder = 'asc' | 'desc';
/** Where a collective export's entries come from: what a dashboard shows, or a filter of its own (Advanced). */
export type BulkSource = 'dashboard' | 'filter';
export type ProtectionChoice = 'vaultKey' | 'password' | 'none';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['pdf', 'html', 'markdown', 'emerald'];
/** The formats set in a font and size of their own. */
export const TYPESET_FORMATS: readonly ExportFormat[] = ['pdf', 'html'];
/** The periods Normal offers; Advanced adds `custom`. */
export const PRESET_PERIODS: readonly ExportPeriod[] = ['last7', 'last30', 'thisMonth', 'all'];
const PERIODS: readonly ExportPeriod[] = [...PRESET_PERIODS, 'custom'];
const PROTECTIONS: readonly ProtectionChoice[] = ['vaultKey', 'password', 'none'];

/** The database export's default: everything but the trash. */
export const DEFAULT_VAULT_OPTIONS: BackupOptions = { ...FULL_BACKUP_OPTIONS, includeDeleted: false };

export interface ExportPrefs {
  level: ExportLevel;
  scope: ExportScope;
  format: ExportFormat;
  includeLinked: boolean;
  protection: ProtectionChoice;
  dashboardId: string;
  period: ExportPeriod;
  /** The custom period, as yyyy-MM-dd; empty is open. */
  from: string;
  to: string;
  // ── Advanced only ──
  source: BulkSource;
  filter: { categories: string[]; tags: string[] };
  recursive: boolean;
  order: ExportOrder;
  images: ImageMode;
  /** Linked entries get pictures of their own setting. */
  linkedImagesOwn: boolean;
  linkedImages: ImageMode;
  blockDefinitions: boolean;
  /** PDF and HTML; `null` is the app's own until one is chosen. */
  font: ExportFontId | null;
  fontSize: ExportTypography['size'] | null;
  vault: BackupOptions;
}

/** The choices any vault shares; those naming a vault's dashboards, categories and tags are kept per vault. */
const PREFS_KEY = 'export-menu-prefs';
const vaultPrefsKey = (vaultId: string) => `${PREFS_KEY}:${vaultId}`;
/** The fields that hold IDs of one vault — stored under `vaultPrefsKey`. */
const VAULT_FIELDS = ['dashboardId', 'filter', 'vault'] as const;

/** What Normal fixes; also what Advanced starts with. */
const NORMAL_FIXED = {
  source: 'dashboard', recursive: false, order: 'asc',
  images: 'balanced', linkedImagesOwn: false, linkedImages: 'balanced', blockDefinitions: true,
  vault: DEFAULT_VAULT_OPTIONS,
} as const satisfies Partial<ExportPrefs>;

function defaultPrefs(): ExportPrefs {
  return {
    level: 'normal', scope: 'entry', format: 'pdf', includeLinked: false, protection: 'vaultKey',
    dashboardId: 'all', period: 'last30', from: '', to: '',
    filter: { categories: [], tags: [] },
    font: null, fontSize: null,
    ...NORMAL_FIXED,
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const isDay = (value: unknown): value is string => typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value));

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return asRecord(value);
  } catch {
    return {};
  }
}

/**
 * What the menu remembers from last time; whatever does not fit falls back to
 * the default. "No protection" is not carried over: it has to be chosen again
 * each time, so an unprotected copy of a vault is never written by habit.
 */
export function loadExportPrefs(vaultId: string): ExportPrefs {
  const base = defaultPrefs();
  const stored = { ...readJson(PREFS_KEY), ...readJson(vaultPrefsKey(vaultId)) };
  const filter = asRecord(stored.filter);
  const vault = asRecord(stored.vault) as Partial<Record<keyof BackupOptions, unknown>>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const protection = oneOf(stored.protection, PROTECTIONS, base.protection);
  return {
    level: oneOf(stored.level, ['normal', 'advanced'] as const, base.level),
    scope: oneOf(stored.scope, ['entry', 'bulk', 'vault'] as const, base.scope),
    format: oneOf(stored.format, EXPORT_FORMATS, base.format),
    includeLinked: bool(stored.includeLinked, base.includeLinked),
    protection: protection === 'none' ? 'vaultKey' : protection,
    dashboardId: typeof stored.dashboardId === 'string' ? stored.dashboardId : base.dashboardId,
    period: oneOf(stored.period, PERIODS, base.period),
    from: isDay(stored.from) ? stored.from : '',
    to: isDay(stored.to) ? stored.to : '',
    source: oneOf(stored.source, ['dashboard', 'filter'] as const, base.source),
    filter: { categories: strings(filter.categories), tags: strings(filter.tags) },
    recursive: bool(stored.recursive, base.recursive),
    order: oneOf(stored.order, ['asc', 'desc'] as const, base.order),
    images: oneOf(stored.images, IMAGE_MODES, base.images),
    linkedImagesOwn: bool(stored.linkedImagesOwn, base.linkedImagesOwn),
    linkedImages: oneOf(stored.linkedImages, IMAGE_MODES, base.linkedImages),
    blockDefinitions: bool(stored.blockDefinitions, base.blockDefinitions),
    font: oneOf<ExportFontId | null>(stored.font, EXPORT_FONT_IDS, null),
    fontSize: oneOf<ExportTypography['size'] | null>(stored.fontSize, EXPORT_FONT_SIZES, null),
    vault: {
      categoryIds: vault.categoryIds === null || vault.categoryIds === undefined ? null : strings(vault.categoryIds),
      includeUncategorized: bool(vault.includeUncategorized, DEFAULT_VAULT_OPTIONS.includeUncategorized),
      includeTasks: bool(vault.includeTasks, DEFAULT_VAULT_OPTIONS.includeTasks),
      includeTags: bool(vault.includeTags, DEFAULT_VAULT_OPTIONS.includeTags),
      includeLexicon: bool(vault.includeLexicon, DEFAULT_VAULT_OPTIONS.includeLexicon),
      includeDeleted: bool(vault.includeDeleted, DEFAULT_VAULT_OPTIONS.includeDeleted),
      includeSettings: bool(vault.includeSettings, !!DEFAULT_VAULT_OPTIONS.includeSettings),
      dateFrom: isDay(vault.dateFrom) ? vault.dateFrom : '',
      dateTo: isDay(vault.dateTo) ? vault.dateTo : '',
    },
  };
}

export function saveExportPrefs(prefs: ExportPrefs, vaultId: string): void {
  const shared: Record<string, unknown> = { ...prefs };
  const own: Record<string, unknown> = {};
  for (const key of VAULT_FIELDS) {
    own[key] = prefs[key];
    delete shared[key];
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(shared));
    if (vaultId) localStorage.setItem(vaultPrefsKey(vaultId), JSON.stringify(own));
  } catch { /* not remembered, no harm */ }
}

/** The settings that apply: under Normal the fixed ones in place of the remembered Advanced choices. */
export function effectiveSettings(prefs: ExportPrefs): ExportPrefs {
  return prefs.level === 'advanced' ? prefs : { ...prefs, ...NORMAL_FIXED };
}

/** The font and size of a PDF or HTML: the app's under Normal, and under Advanced until another is chosen. */
export function exportTypography(prefs: ExportPrefs, app: ExportTypography): ExportTypography {
  if (prefs.level !== 'advanced') return app;
  return { font: prefs.font ?? app.font, size: prefs.fontSize ?? app.size };
}

/** The picture level of linked entries. */
export function linkedImageMode(settings: ExportPrefs): ImageMode {
  return settings.linkedImagesOwn ? settings.linkedImages : settings.images;
}

/**
 * The first and last day a period covers; `null` is open. `invalid` when a
 * custom date cannot be read (half typed, or a webview without a date
 * picker). A custom range given backwards is turned round.
 */
export function periodRange(period: ExportPeriod, from: string, to: string, today = new Date()): { from: Date | null; to: Date | null; invalid: boolean } {
  switch (period) {
    case 'last7': return { from: startOfDay(subDays(today, 6)), to: null, invalid: false };
    case 'last30': return { from: startOfDay(subDays(today, 29)), to: null, invalid: false };
    case 'thisMonth': return { from: startOfMonth(today), to: null, invalid: false };
    case 'all': return { from: null, to: null, invalid: false };
    case 'custom': {
      const parse = (s: string): Date | null | undefined => {
        if (!s) return null;
        const d = parseISO(s);
        return isValid(d) && d.getFullYear() >= 1000 ? d : undefined;
      };
      const a = parse(from), b = parse(to);
      if (a === undefined || b === undefined) return { from: null, to: null, invalid: true };
      if (a && b && a > b) return { from: b, to: a, invalid: false };
      return { from: a, to: b, invalid: false };
    }
  }
}

/** Was the entry created within the range? Days count whole, in local time. */
function createdWithin(entry: Pick<Entry, 'created_at'>, range: { from: Date | null; to: Date | null }): boolean {
  const day = format(new Date(entry.created_at), 'yyyy-MM-dd');
  if (range.from && day < format(range.from, 'yyyy-MM-dd')) return false;
  if (range.to && day > format(range.to, 'yyyy-MM-dd')) return false;
  return true;
}

/** Entries by creation date, oldest first or newest first; ties by number, so the order is stable. */
export function byCreated<T extends Pick<Entry, 'created_at' | 'entry_number'>>(entries: readonly T[], order: ExportOrder): T[] {
  const sign = order === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => sign * (a.created_at.localeCompare(b.created_at) || (a.entry_number ?? 0) - (b.entry_number ?? 0)));
}

/**
 * A collective export's entries: those the filter lets through, created within
 * the range, in the chosen order. `live` is the IDs of the categories and tags
 * that exist, as for a dashboard's list (`dashboardEntries`). For the own filter
 * `liveFilter` has already dropped deleted categories and tags, so one with none left
 * does not narrow.
 */
export function bulkEntries(
  entries: readonly Entry[],
  filter: DashboardFilter,
  range: { from: Date | null; to: Date | null },
  order: ExportOrder,
  live: LiveIds,
): Entry[] {
  return byCreated(entries.filter((e) => matchesFilter(e, filter, live) && createdWithin(e, range)), order);
}

/** A free filter as a dashboard filter: an empty list is no rule. */
export function freeFilter(filter: ExportPrefs['filter']): DashboardFilter {
  return {
    categories: filter.categories.length ? filter.categories : undefined,
    tags: filter.tags.length ? filter.tags : undefined,
  };
}

/** A free filter without the categories and tags that no longer exist — a deleted one would let nothing through, unseen. */
export function liveFilter(
  filter: ExportPrefs['filter'],
  categories: ReadonlySet<string>,
  tags: ReadonlySet<string>,
): ExportPrefs['filter'] {
  return { categories: filter.categories.filter((id) => categories.has(id)), tags: filter.tags.filter((id) => tags.has(id)) };
}
