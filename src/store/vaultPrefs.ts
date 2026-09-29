import {
  ALTAR_LIBRARY_SORTS, GROUPING_MODES, HOME_VIEWS, SORT_MODES, TAGS_SORTS, VIEW_MODES, useUIStore,
  type AltarLibraryPrefs, type HomeSectionPrefs, type ListPrefs,
} from './uiStore';

/**
 * Die Vorlieben eines Vaults: wie jede Liste aussieht (Ansicht, Sortierung,
 * Gruppierung), die Abschnitte der Startseite, welche Gruppen und Abschnitte
 * zugeklappt sind. Dauerhaft und je Vault — ein anderer Vault hat andere
 * Kategorien und andere Gewohnheiten.
 *
 * Gelebt wird im `uiStore`, wie bisher; dieses Modul lädt die Felder beim
 * Öffnen eines Vaults (`loadVaultPrefs`) und schreibt jede Änderung zurück, in
 * den localStorage unter `vault-prefs:<id>`. Nicht in `settings.json`: das
 * sind keine Einstellungen, und jeder Klick auf „Sortieren" wäre sonst ein
 * Dateizugriff.
 *
 * Was nicht dazugehört: der Arbeitszustand — Suche, Filter, Auswahl —, der
 * nur für die Sitzung gilt (`sessionStore`), und das Fenster-Layout —
 * Leistenbreiten, welche Seitenleisten offen sind, die Tabs —, das für die App
 * gilt, gleich welcher Vault offen ist.
 */
/** Die Listen mit Ansicht, Sortierung und Gruppierung (`ListPrefs`). */
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

/** Was ein Vault ohne gespeicherte Vorlieben bekommt — der Anfangszustand des Stores. */
const DEFAULTS: Prefs = pick(useUIStore.getState());

/** Der Vault, dessen Vorlieben im Store stehen — `null`, solange keiner geladen ist. Dann wird nichts geschrieben. */
let prefsVaultId: string | null = null;
/** Während `loadVaultPrefs` den Store füllt: das Füllen selbst schreibt nichts zurück. */
let hydrating = false;

function pick(s: UIState): Prefs {
  return Object.fromEntries(PREF_KEYS.map((key) => [key, s[key]])) as Prefs;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `saved`, wenn es einer der erlaubten Werte ist, sonst `fallback`. */
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
    count: typeof saved.count === 'number' && Number.isInteger(saved.count) && saved.count >= 0 ? saved.count : fallback.count,
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
 * Die Vorlieben, die vor den Vorlieben je Vault app-weit lagen. Ein Vault ohne
 * eigene fängt mit ihnen an, damit nach dem Update nichts zurückspringt.
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
 * Die gespeicherten Vorlieben, geprüft statt geglaubt: nur Felder, die es gibt
 * und die gültig sind — ein Schlüssel überlebt Versionen, in denen es andere
 * Werte gab. Alles andere fällt auf den Standard.
 */
function parse(raw: string | null): Prefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Kaputt heißt: wie ein Vault ohne Vorlieben.
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

/** Lädt die Vorlieben von `vaultId` in den Store — beim Start und nach jedem Vault-Wechsel. */
export function loadVaultPrefs(vaultId: string): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(vaultId));
  } catch {
    // Ohne Speicher gelten die Standards.
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

/** Kein Vault mehr offen (ein gescheiterter erster Wechsel): ab jetzt wird nichts geschrieben. */
export function detachVaultPrefs(): void {
  prefsVaultId = null;
}

/** Ein Vault wird entfernt: seine Vorlieben gehen mit. */
export function forgetVaultPrefs(vaultId: string): void {
  if (prefsVaultId === vaultId) prefsVaultId = null;
  try {
    localStorage.removeItem(storageKey(vaultId));
  } catch {
    // Nichts zu tun.
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
