import {
  ALTAR_LIBRARY_SORTS, GROUPING_MODES, HOME_COUNTS, HOME_VIEWS, SORT_MODES, TAGS_SORTS, VIEW_MODES, useUIStore,
  type AltarLibraryPrefs, type HomeSectionPrefs, type ListPrefs,
} from './uiStore';

/**
 * The preferences of a vault: how each list looks (view, sorting,
 * grouping), the sections of the home page, which groups and sections
 * are collapsed. Permanent and per vault — another vault has different
 * categories and different habits.
 *
 * They live in the `uiStore`, as before; this module loads the fields when
 * a vault is opened (`loadVaultPrefs`) and writes every change back, into
 * localStorage under `vault-prefs:<id>`. Not in `settings.json`: these
 * are not settings, and every click on "Sort" would otherwise be a
 * file access.
 *
 * What does not belong here: the working state — search, filters, selection —,
 * which applies only to the session (`sessionStore`), and the window layout —
 * bar widths, which sidebars are open, the tabs —, which applies to the app
 * regardless of which vault is open.
 */
/** The lists with view, sorting and grouping (`ListPrefs`). */
const LIST_PREF_KEYS = [
  'journalPrefs', 'wikiPrefs', 'operationsPrefs', 'tasksPrefs', 'altarPrefs', 'trashPrefs',
  'templatesPrefs', 'blocksPrefs', 'lexiconPrefs',
] as const;

const PREF_KEYS = [
  ...LIST_PREF_KEYS,
  'homeJournalPrefs', 'homeOpsPrefs', 'homeWikiPrefs',
  'tagsSort', 'altarShowPreview', 'altarLibraryPrefs',
  'collapsedGroups', 'flags',
] as const;

type PrefKey = (typeof PREF_KEYS)[number];
type UIState = ReturnType<typeof useUIStore.getState>;
type Prefs = Pick<UIState, PrefKey>;

const storageKey = (vaultId: string) => `vault-prefs:${vaultId}`;

/** What a vault without saved preferences gets — the initial state of the store. */
const DEFAULTS: Prefs = pick(useUIStore.getState());

/** The vault whose preferences are in the store — `null` while none is loaded. Then nothing is written. */
let prefsVaultId: string | null = null;
/** While `loadVaultPrefs` fills the store: the filling itself writes nothing back. */
let hydrating = false;

function pick(s: UIState): Prefs {
  return Object.fromEntries(PREF_KEYS.map((key) => [key, s[key]])) as Prefs;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `saved` if it is one of the allowed values, otherwise `fallback`. */
function oneOf<T>(saved: unknown, allowed: readonly string[], fallback: T): T {
  return typeof saved === 'string' && allowed.includes(saved) ? (saved as T) : fallback;
}

function listPrefs(saved: unknown, fallback: ListPrefs): ListPrefs {
  if (!isRecord(saved)) return fallback;
  return {
    view: oneOf(saved.view, VIEW_MODES, fallback.view),
    sort: oneOf(saved.sort, SORT_MODES, fallback.sort),
    grouping: oneOf(saved.grouping, GROUPING_MODES, fallback.grouping),
  };
}

function homePrefs(saved: unknown, fallback: HomeSectionPrefs): HomeSectionPrefs {
  if (!isRecord(saved)) return fallback;
  return {
    view: oneOf(saved.view, HOME_VIEWS, fallback.view),
    sort: oneOf(saved.sort, SORT_MODES.filter((s) => s !== 'count_desc'), fallback.sort),
    // Only what the menu offers — an older vault may still carry the old wiki default 6.
    count: (HOME_COUNTS as readonly unknown[]).includes(saved.count) ? (saved.count as number) : fallback.count,
  };
}

function libraryPrefs(saved: unknown, fallback: AltarLibraryPrefs): AltarLibraryPrefs {
  if (!isRecord(saved)) return fallback;
  return {
    sort: oneOf(saved.sort, ALTAR_LIBRARY_SORTS, fallback.sort),
    grouping: oneOf(saved.grouping, GROUPING_MODES, fallback.grouping),
  };
}

/**
 * The preferences that were app-wide before there were per-vault preferences. A vault without
 * its own starts with them, so that nothing jumps back after the update.
 */
function legacyPrefs(): Partial<Prefs> {
  try {
    const preview = localStorage.getItem('altar-show-preview');
    return {
      ...(preview !== null ? { altarShowPreview: preview !== '0' } : {}),
      altarLibraryPrefs: libraryPrefs({
        sort: localStorage.getItem('altar-library-sort'),
        grouping: localStorage.getItem('altar-library-grouping'),
      }, DEFAULTS.altarLibraryPrefs),
    };
  } catch {
    return {};
  }
}

/**
 * The saved preferences, checked rather than trusted: only fields that exist
 * and are valid — a key survives versions in which there were other
 * values. Everything else falls back to the default.
 */
function parse(raw: string | null): Prefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Broken means: like a vault without preferences.
  }
  const lists = Object.fromEntries(
    LIST_PREF_KEYS.map((key) => [key, listPrefs(saved[key], DEFAULTS[key])]),
  ) as Pick<Prefs, (typeof LIST_PREF_KEYS)[number]>;
  const collapsedGroups: Record<string, ReadonlySet<string>> = {};
  if (isRecord(saved.collapsedGroups)) {
    for (const [scope, ids] of Object.entries(saved.collapsedGroups)) {
      if (Array.isArray(ids)) collapsedGroups[scope] = new Set(ids.filter((id): id is string => typeof id === 'string'));
    }
  }
  const flags: Record<string, boolean> = {};
  if (isRecord(saved.flags)) {
    for (const [key, value] of Object.entries(saved.flags)) if (typeof value === 'boolean') flags[key] = value;
  }
  return {
    ...DEFAULTS,
    ...lists,
    homeJournalPrefs: homePrefs(saved.homeJournalPrefs, DEFAULTS.homeJournalPrefs),
    homeOpsPrefs: homePrefs(saved.homeOpsPrefs, DEFAULTS.homeOpsPrefs),
    homeWikiPrefs: homePrefs(saved.homeWikiPrefs, DEFAULTS.homeWikiPrefs),
    tagsSort: oneOf(saved.tagsSort, TAGS_SORTS, DEFAULTS.tagsSort),
    altarShowPreview: typeof saved.altarShowPreview === 'boolean' ? saved.altarShowPreview : DEFAULTS.altarShowPreview,
    altarLibraryPrefs: libraryPrefs(saved.altarLibraryPrefs, DEFAULTS.altarLibraryPrefs),
    collapsedGroups,
    flags,
  };
}

function serialize(prefs: Prefs): string {
  return JSON.stringify({
    ...prefs,
    collapsedGroups: Object.fromEntries(
      Object.entries(prefs.collapsedGroups).map(([scope, ids]) => [scope, [...ids]]),
    ),
  });
}

/** Loads the preferences of `vaultId` into the store — at startup and after every vault switch. */
export function loadVaultPrefs(vaultId: string): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(vaultId));
  } catch {
    // Without storage the defaults apply.
  }
  const prefs = raw === null ? { ...parse(null), ...legacyPrefs() } : parse(raw);
  hydrating = true;
  try {
    useUIStore.setState(prefs);
  } finally {
    hydrating = false;
  }
  prefsVaultId = vaultId || null;
}

/** No vault open any more (a failed first switch): from now on nothing is written. */
export function detachVaultPrefs(): void {
  prefsVaultId = null;
}

/** A vault is removed: its preferences go with it. */
export function forgetVaultPrefs(vaultId: string): void {
  if (prefsVaultId === vaultId) prefsVaultId = null;
  try {
    localStorage.removeItem(storageKey(vaultId));
  } catch {
    // Nothing to do.
  }
}

useUIStore.subscribe((s, prev) => {
  if (hydrating || !prefsVaultId) return;
  if (!PREF_KEYS.some((key) => s[key] !== prev[key])) return;
  try {
    localStorage.setItem(storageKey(prefsVaultId), serialize(pick(s)));
  } catch (err) {
    console.warn('[prefs] could not save view preferences', err);
  }
});
