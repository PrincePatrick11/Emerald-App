import { create } from 'zustand';
import {
  createTabId, freshHistory, isContentView, normalizeSavedHistory, pushHistory, stripSessionFlags,
  type NavHistory, type OpenTab,
} from '../lib/tabs';
import { isLibraryView, isViewId, moduleMeta, type EntryModuleId, type LeftListTabId } from '../lib/modules';
import type { ActiveView } from '../types';

export type ViewMode = 'list' | 'cards' | 'cards_wide' | 'timeline';
/** `count_desc` = „am häufigsten zuerst" — nur das Tags-Dashboard bietet ihn
 *  an (`sortModes`), die übrigen Listen haben nichts zu zählen. */
export type SortMode = 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc' | 'count_desc';
/** Gruppierung als eigene Achse neben Ansicht und Sortierung. Früher war
 *  „Kategorie" ein SortMode — was zwei Entscheidungen in einen Knopf legte:
 *  wer nach Kategorien gruppieren wollte, verlor damit seine Sortierung. */
export type GroupingMode = 'grouped' | 'flat';
export interface ListPrefs { view: ViewMode; sort: SortMode; grouping: GroupingMode; }

/** Die Regler der Altar-Bibliothek. Ein Ausschnitt der SortMode — Elemente
 *  haben kein „zuletzt bearbeitet", und die Kategorie ist dort die
 *  Gruppierung, keine Sortierung. Im Store, weil die Regler in der rechten
 *  Seitenleiste sitzen (AltarView) und der Abschnitt darunter sie liest
 *  (AltarLibrarySection). */
export type AltarLibrarySort = Extract<SortMode, 'alpha_asc' | 'alpha_desc' | 'date_desc'>;
export interface AltarLibraryPrefs { sort: AltarLibrarySort; grouping: GroupingMode; }
export const ALTAR_LIBRARY_SORTS: AltarLibrarySort[] = ['alpha_asc', 'alpha_desc', 'date_desc'];

/** Die Sortierung des Tags-Dashboards: Tags haben kein Datum, dafür eine
 *  Häufigkeit. Wie die übrigen Listen-Prefs nicht persistiert. */
export type TagsSort = Extract<SortMode, 'alpha_asc' | 'alpha_desc' | 'count_desc'>;
export const TAGS_SORTS: TagsSort[] = ['alpha_asc', 'alpha_desc', 'count_desc'];
export const isTagsSort = (s: SortMode): s is TagsSort => (TAGS_SORTS as SortMode[]).includes(s);

/** Die Sortierung der Home-Abschnitte — die Datums- und Alpha-Modi. */
export type HomeSort = Exclude<SortMode, 'count_desc'>;
export type HomeView = 'list' | 'cards';
export interface HomeSectionPrefs { sort: HomeSort; view: HomeView; count: number; } // count 0 = all

export interface EditActions {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** Den aufgeschobenen Autosave sofort schreiben — für Aktionen der
   *  Seitenleiste, die danach den Store-Stand des Eintrags lesen (Typwechsel). */
  flush?: () => Promise<void>;
}

interface UIState {
  activeView: ActiveView;
  tabs: OpenTab[];
  activeTabId: string | null;
  /** Der Verlauf, solange kein Tab offen ist. Mit Tabs führt jeder Tab seinen
   *  eigenen (`OpenTab.history`); `selectActiveHistory` wählt den passenden. */
  tablessHistory: NavHistory;
  /** Wie `railOpen` und `leftListOpen` dauerhaft (localStorage). Gespeichert
   *  wird nur, was der Nutzer selbst umschaltet — das erzwungene Aufklappen in
   *  `setActiveView` nicht. */
  rightSidebarOpen: boolean;
  /** Das Portal-Ziel, das die rechte Seitenleiste in Listenansichten stellt.
   *  Dashboard portalt seinen kompletten Kopf (Titel, Aktionen, Toolbar,
   *  Filter) hinein; `null` heißt Leiste zu oder Detailansicht — dann hat
   *  Dashboard keinen Kopf. Invariante: genau EIN Schreiber (der Host-Div in
   *  RightSidebars Listen-Zweig) und genau ein Leser zur Zeit (`SidebarPortal`
   *  — aus Dashboard oder der Seite eines eigenen Blocks); MainArea rendert
   *  immer nur eine View, also portalt nie mehr als eine.
   *  Bewusst nicht persistiert (DOM-Knoten). */
  listHeaderHost: HTMLElement | null;
  /** Ob gerade ein `Dashboard` gemountet ist — es meldet sich selbst an.
   *  RightSidebar stellt daran das Portal-Ziel, statt aus `activeView.id` zu
   *  raten: Aufgaben zeigen ihre Liste auch mit einer id (Sprungziel, kein
   *  offener Eintrag), und die id eines geloeschten Eintrags laesst Journal,
   *  Wiki und Operationen ebenfalls auf ihr Dashboard zurueckfallen. */
  dashboardMounted: boolean;
  editActions: EditActions | null;
  /** Die Rail ganz links. Dauerhaft (localStorage), wie `leftListOpen`. */
  railOpen: boolean;
  leftListOpen: boolean;
  leftListTab: LeftListTabId;
  searchQuery: string;
  journalPrefs: ListPrefs;
  wikiPrefs: ListPrefs;
  operationsPrefs: ListPrefs;
  tasksPrefs: ListPrefs;
  altarPrefs: ListPrefs;
  trashPrefs: ListPrefs;
  templatesPrefs: ListPrefs;
  tagsSort: TagsSort;
  altarWindowFullscreen: boolean;
  /** Altar-Dashboard: Vorschau der Leinwand auf den Karten und in der Liste.
   *  Aus heißt Flammen-Icon statt Vorschau. Anders als die übrigen
   *  Listen-Prefs dauerhaft (localStorage) — es ist eine Vorliebe, keine
   *  Arbeitsgeste. */
  altarShowPreview: boolean;
  /** Sortierung und Gruppierung der Bibliothek — wie altarShowPreview eine
   *  Vorliebe und darum dauerhaft. */
  altarLibraryPrefs: AltarLibraryPrefs;
  homeJournalPrefs: HomeSectionPrefs;
  homeOpsPrefs: HomeSectionPrefs;
  homeWikiPrefs: HomeSectionPrefs;
  /** Die vom Standard abweichenden Gruppen je Modul (siehe hooks/useCollapsedSet):
   *  zugeklappte — bzw. in Scopes, die zugeklappt starten, aufgeklappte.
   *  Im Store statt View-lokal, weil MainArea die Views beim Modulwechsel
   *  unmountet; bewusst nicht persistiert — zugeklappt ist eine Arbeitsgeste. */
  collapsedGroups: Record<string, ReadonlySet<string>>;

  setActiveView: (view: ActiveView) => void;
  toggleCollapsedGroup: (scope: string, id: string) => void;
  /** Nimmt die ids aus dem Set eines Scopes. */
  removeCollapsedGroups: (scope: string, ids: string[]) => void;
  /** Legt die ids ins Set eines Scopes — das Gegenstück zu removeCollapsedGroups. */
  addCollapsedGroups: (scope: string, ids: string[]) => void;
  closeAllTabs: () => void;
  /** Ein Eintrag hat den Typ gewechselt: jeder Tab und jeder Verlauf, der ihn
   *  unter `from` öffnet, öffnet ihn jetzt unter `to` — dieselbe id. */
  retypeEntryViews: (id: string, from: EntryModuleId, to: EntryModuleId) => void;
  openViewInNewTab: (view: ActiveView) => void;
  addTab: (view?: ActiveView) => void;
  selectTab: (id: string) => void;
  setTabsOrder: (ids: string[]) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  toggleRightSidebar: () => void;
  setListHeaderHost: (el: HTMLElement | null) => void;
  setDashboardMounted: (mounted: boolean) => void;
  setEditActions: (actions: EditActions | null) => void;
  toggleRail: () => void;
  toggleLeftList: () => void;
  setLeftListTab: (tab: LeftListTabId) => void;
  setSearchQuery: (q: string) => void;
  setJournalPrefs: (p: Partial<ListPrefs>) => void;
  setWikiPrefs: (p: Partial<ListPrefs>) => void;
  setOperationsPrefs: (p: Partial<ListPrefs>) => void;
  setTasksPrefs: (p: Partial<ListPrefs>) => void;
  setAltarPrefs: (p: Partial<ListPrefs>) => void;
  setTrashPrefs: (p: Partial<ListPrefs>) => void;
  setTemplatesPrefs: (p: Partial<ListPrefs>) => void;
  setTagsSort: (sort: TagsSort) => void;
  setAltarWindowFullscreen: (enabled: boolean) => void;
  setAltarShowPreview: (enabled: boolean) => void;
  setAltarLibraryPrefs: (p: Partial<AltarLibraryPrefs>) => void;
  setHomeJournalPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeOpsPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeWikiPrefs: (p: Partial<HomeSectionPrefs>) => void;
}

const ALTAR_SHOW_PREVIEW_KEY = 'altar-show-preview';
const ALTAR_LIBRARY_SORT_KEY = 'altar-library-sort';
const ALTAR_LIBRARY_GROUPING_KEY = 'altar-library-grouping';
const RAIL_OPEN_KEY = 'rail-open';
const LEFT_LIST_OPEN_KEY = 'left-list-open';
const RIGHT_SIDEBAR_OPEN_KEY = 'right-sidebar-open';

/** Die drei Seitenleisten starten offen, solange nichts anderes gespeichert ist. */
function loadOpenFlag(key: string): boolean {
  return localStorage.getItem(key) !== '0';
}

function saveOpenFlag(key: string, open: boolean) {
  localStorage.setItem(key, open ? '1' : '0');
}

function loadAltarLibraryPrefs(): AltarLibraryPrefs {
  // Gespeicherte Werte werden geprüft, nicht geglaubt: der Schlüssel überlebt
  // eine Version, in der die Auswahl anders hieß.
  const savedSort = localStorage.getItem(ALTAR_LIBRARY_SORT_KEY);
  return {
    sort: ALTAR_LIBRARY_SORTS.includes(savedSort as AltarLibrarySort)
      ? (savedSort as AltarLibrarySort)
      : 'alpha_asc',
    grouping: localStorage.getItem(ALTAR_LIBRARY_GROUPING_KEY) === 'flat' ? 'flat' : 'grouped',
  };
}


function normalizeSavedTab(tab: unknown): OpenTab | null {
  if (!tab || typeof tab !== 'object') return null;
  const candidate = tab as { id?: string; key?: string; view?: ActiveView; history?: unknown };
  // isViewId: localStorage kann Tab-Typen aus älteren Versionen tragen —
  // die fallen hier sauber weg, statt als Geister-View zu rendern.
  if (!candidate.view?.type || !isViewId(candidate.view.type)) return null;
  // isNew ist ein Sitzungs-Flag, kein Tab-Zustand: überlebte es den Neustart,
  // würde Cancel einen längst autogespeicherten Eintrag endgültig löschen.
  const view = stripSessionFlags(candidate.view);
  return {
    id: candidate.id ?? candidate.key ?? createTabId(),
    view,
    history: normalizeSavedHistory(candidate.history, view),
  };
}

function loadSavedTabs(): { tabs: OpenTab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem('open-tabs');
    const activeTabId = localStorage.getItem('active-tab-id');
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return { tabs: [], activeTabId: null };
    const tabs = parsed.map(normalizeSavedTab).filter((tab): tab is OpenTab => !!tab);
    return { tabs, activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? null };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function saveTabs(tabs: OpenTab[], activeTabId: string | null) {
  localStorage.setItem('open-tabs', JSON.stringify(tabs));
  if (activeTabId) localStorage.setItem('active-tab-id', activeTabId);
  else localStorage.removeItem('active-tab-id');
}

/**
 * The Altar's distraction-free mode, which hides the sidebars and the tab bar.
 * Shared by `AppShell` and `TitleBar` so the two cannot drift apart.
 */
export function isAltarFullscreen(s: Pick<UIState, 'activeView' | 'altarWindowFullscreen'>): boolean {
  return s.activeView.type === 'altar' && s.activeView.mode !== 'edit' && s.altarWindowFullscreen;
}

/** Save/Cancel/Delete live only in the right sidebar, so edit mode must not start with it closed.
 *  A user-built block's or template's page is always editing and keeps its Save there too. */
function viewNeedsSidebar(view: ActiveView): boolean {
  const usesEditorSidebar = moduleMeta(view.type)?.usesEditorSidebar ?? false;
  return (view.mode === 'edit' && usesEditorSidebar) || (isLibraryView(view.type) && !!view.id);
}

/** Der Verlauf, durch den Zurück und Vor gerade gehen: der des aktiven Tabs, sonst der tablose. */
export function selectActiveHistory(s: Pick<UIState, 'tabs' | 'activeTabId' | 'tablessHistory'>): NavHistory {
  if (!s.activeTabId) return s.tablessHistory;
  return s.tabs.find((tab) => tab.id === s.activeTabId)?.history ?? s.tablessHistory;
}

/** Ein Schritt durch den aktiven Verlauf; `{}`, wenn es in die Richtung nicht weitergeht. */
function stepHistory(s: UIState, delta: -1 | 1): Partial<UIState> {
  const history = selectActiveHistory(s);
  const index = history.index + delta;
  if (index < 0 || index >= history.views.length) return {};
  const activeView = history.views[index];
  const next = { ...history, index };
  if (!s.activeTabId) return { activeView, tablessHistory: next };
  const tabs = s.tabs.map((tab) => tab.id === s.activeTabId ? { ...tab, view: activeView, history: next } : tab);
  saveTabs(tabs, s.activeTabId);
  return { activeView, tabs };
}

const savedTabs = loadSavedTabs();
const initialView: ActiveView = savedTabs.activeTabId
  ? savedTabs.tabs.find((tab) => tab.id === savedTabs.activeTabId)?.view ?? { type: 'home' }
  : { type: 'home' };

export const useUIStore = create<UIState>((set) => ({
  activeView: initialView,
  tabs: savedTabs.tabs,
  activeTabId: savedTabs.activeTabId,
  tablessHistory: freshHistory({ type: 'home' }),
  // Ein wiederhergestellter Tab im Bearbeitungsmodus braucht die Leiste, auch
  // wenn sie zuletzt zugeklappt war — dieselbe Regel wie in `setActiveView`.
  rightSidebarOpen: loadOpenFlag(RIGHT_SIDEBAR_OPEN_KEY) || viewNeedsSidebar(initialView),
  listHeaderHost: null,
  dashboardMounted: false,
  editActions: null,
  railOpen: loadOpenFlag(RAIL_OPEN_KEY),
  leftListOpen: loadOpenFlag(LEFT_LIST_OPEN_KEY),
  leftListTab: 'journal',
  searchQuery: '',
  // Wo „Kategorie" bisher der Sortiermodus war (Wiki, Operationen,
  // Aufgaben), steht jetzt `grouping: 'grouped'` — dieselbe Ansicht wie
  // vorher. Innerhalb einer Gruppe verglich der alte Modus nur den
  // Gruppennamen, war also für jede sichtbare Zeile gleich; die Reihenfolge
  // kam faktisch aus dem Store. Der neue Sortierwert bildet genau die nach:
  // Wiki lädt `ORDER BY title` (alpha_asc), Operationen `updated_at DESC`
  // und Aufgaben `created_at DESC` (date_desc). Journal, Altar und
  // Papierkorb waren nie gruppiert und bleiben 'flat'.
  journalPrefs: { view: 'list', sort: 'date_desc', grouping: 'flat' },
  wikiPrefs: { view: 'cards', sort: 'alpha_asc', grouping: 'grouped' },
  operationsPrefs: { view: 'list', sort: 'date_desc', grouping: 'grouped' },
  tasksPrefs: { view: 'list', sort: 'date_desc', grouping: 'grouped' },
  // `grouping` bleibt beim Altar ungenutzt: Altäre tragen keine Kategorien,
  // das Dashboard reicht die Achse deshalb nicht an die Toolbar durch. Das
  // Feld steht nur da, weil alle Module dieselbe ListPrefs teilen.
  altarPrefs: { view: 'cards', sort: 'date_desc', grouping: 'flat' },
  trashPrefs: { view: 'list', sort: 'date_desc', grouping: 'flat' },
  // Vorlagen haben nichts zu gruppieren — wie beim Altar steht das Feld nur für die gemeinsame ListPrefs da.
  templatesPrefs: { view: 'list', sort: 'alpha_asc', grouping: 'flat' },
  tagsSort: 'alpha_asc',
  altarWindowFullscreen: false,
  altarShowPreview: localStorage.getItem(ALTAR_SHOW_PREVIEW_KEY) !== '0',
  altarLibraryPrefs: loadAltarLibraryPrefs(),
  homeJournalPrefs: { sort: 'date_desc', view: 'list', count: 5 },
  homeOpsPrefs:     { sort: 'date_desc', view: 'list', count: 5 },
  homeWikiPrefs:    { sort: 'alpha_asc', view: 'cards', count: 6 },
  collapsedGroups: {},

  toggleCollapsedGroup: (scope, id) => set((s) => {
    const next = new Set(s.collapsedGroups[scope] ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { collapsedGroups: { ...s.collapsedGroups, [scope]: next } };
  }),

  removeCollapsedGroups: (scope, ids) => set((s) => {
    const prev = s.collapsedGroups[scope];
    if (!prev || !ids.some((id) => prev.has(id))) return s;
    const next = new Set(prev);
    for (const id of ids) next.delete(id);
    return { collapsedGroups: { ...s.collapsedGroups, [scope]: next } };
  }),

  addCollapsedGroups: (scope, ids) => set((s) => {
    const prev = s.collapsedGroups[scope];
    if (prev && ids.every((id) => prev.has(id))) return s;
    const next = new Set(prev ?? []);
    for (const id of ids) next.add(id);
    return { collapsedGroups: { ...s.collapsedGroups, [scope]: next } };
  }),

  setActiveView: (view) => set((s) => {
    const openSidebar = viewNeedsSidebar(view) && !s.rightSidebarOpen
      ? { rightSidebarOpen: true }
      : {};

    let tabs = s.tabs;
    let activeTabId = s.activeTabId;
    let tablessHistory = s.tablessHistory;
    if (activeTabId) {
      tabs = tabs.map((tab) => tab.id === activeTabId ? { ...tab, view, history: pushHistory(tab.history, view) } : tab);
    } else if (isContentView(view)) {
      // Der automatisch geöffnete Tab setzt den Weg davor fort: Zurück führt
      // dorthin, von wo aus der Eintrag geöffnet wurde.
      activeTabId = createTabId();
      tabs = [{ id: activeTabId, view, history: pushHistory(s.tablessHistory, view) }];
      tablessHistory = freshHistory({ type: 'home' });
    } else {
      tablessHistory = pushHistory(s.tablessHistory, view);
    }
    saveTabs(tabs, activeTabId);

    return { activeView: view, tabs, activeTabId, tablessHistory, ...openSidebar };
  }),

  // Fuer Vault-Wechsel und Replace-Import: Tabs und History tragen Eintrags-IDs,
  // die es in der neuen Datenbank nicht gibt — beides faellt auf den frischen
  // Startzustand zurueck (keine Tabs, Home), wie beim allerersten Start.
  closeAllTabs: () => set(() => {
    saveTabs([], null);
    return {
      tabs: [],
      activeTabId: null,
      activeView: { type: 'home' },
      tablessHistory: freshHistory({ type: 'home' }),
      // Die Klapp-Zustände zeigen per Kategorie-id in den alten Vault.
      collapsedGroups: {},
    };
  }),

  retypeEntryViews: (id, from, to) => set((s) => {
    const retype = (view: ActiveView): ActiveView => (view.type === from && view.id === id ? { ...view, type: to } : view);
    const retypeHistory = (history: NavHistory): NavHistory => ({ ...history, views: history.views.map(retype) });
    const tabs = s.tabs.map((tab) => ({ ...tab, view: retype(tab.view), history: retypeHistory(tab.history) }));
    saveTabs(tabs, s.activeTabId);
    return { tabs, activeView: retype(s.activeView), tablessHistory: retypeHistory(s.tablessHistory) };
  }),

  // Ein neuer Tab beginnt mit einem frischen Verlauf.
  openViewInNewTab: (view) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view, history: freshHistory(view) }];
    saveTabs(tabs, id);
    return { activeView: view, tabs, activeTabId: id };
  }),

  addTab: (view = { type: 'home' }) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view, history: freshHistory(view) }];
    saveTabs(tabs, id);
    return { activeView: view, tabs, activeTabId: id };
  }),

  // Der Tabwechsel ist kein Schritt im Verlauf — er wechselt nur, welcher Verlauf gilt.
  selectTab: (id) => set((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === id);
    if (!tab) return {};
    saveTabs(s.tabs, id);
    return { activeView: tab.view, activeTabId: id };
  }),

  setTabsOrder: (ids) => set((s) => {
    if (ids.length !== s.tabs.length) {
      if (import.meta.env.DEV) console.warn('setTabsOrder: length mismatch');
      return {};
    }
    const tabMap = new Map(s.tabs.map((tab) => [tab.id, tab]));
    const tabs = ids.map((id) => tabMap.get(id)).filter((tab): tab is OpenTab => !!tab);
    if (tabs.length !== s.tabs.length || new Set(ids).size !== ids.length) {
      if (import.meta.env.DEV) console.warn('setTabsOrder: invalid reorder payload');
      return {};
    }
    saveTabs(tabs, s.activeTabId);
    return { tabs };
  }),

  closeTab: (id) => set((s) => {
    const tabIndex = s.tabs.findIndex((tab) => tab.id === id);
    if (tabIndex < 0) return {};
    const tabs = s.tabs.filter((tab) => tab.id !== id);
    if (s.activeTabId !== id) {
      saveTabs(tabs, s.activeTabId);
      return { tabs };
    }

    const nextTab = tabs[Math.min(tabIndex, tabs.length - 1)] ?? tabs[tabIndex - 1];
    saveTabs(tabs, nextTab?.id ?? null);
    // Der Verlauf des geschlossenen Tabs geht mit ihm; ohne Tab beginnt der tablose frisch.
    if (!nextTab) {
      return { tabs, activeTabId: null, activeView: { type: 'home' }, tablessHistory: freshHistory({ type: 'home' }) };
    }
    return { tabs, activeTabId: nextTab.id, activeView: nextTab.view };
  }),

  closeOtherTabs: (id) => set((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === id);
    if (!tab) return {};
    const tabs = [tab];
    saveTabs(tabs, tab.id);
    return { activeView: tab.view, tabs, activeTabId: tab.id };
  }),

  navigateBack: () => set((s) => stepHistory(s, -1)),
  navigateForward: () => set((s) => stepHistory(s, 1)),
  toggleRightSidebar: () => set((s) => {
    const rightSidebarOpen = !s.rightSidebarOpen;
    saveOpenFlag(RIGHT_SIDEBAR_OPEN_KEY, rightSidebarOpen);
    return { rightSidebarOpen };
  }),

  // Als Ref-Callback gedacht: React ruft ihn beim Unmount mit `null` auf,
  // womit der Dashboard-Kopf mit der Leiste verschwindet.
  setListHeaderHost: (el) => set((s) => (s.listHeaderHost === el ? s : { listHeaderHost: el })),
  setDashboardMounted: (mounted) => set((s) => (s.dashboardMounted === mounted ? s : { dashboardMounted: mounted })),
  setEditActions: (actions) => set({ editActions: actions }),
  toggleRail: () => set((s) => {
    const railOpen = !s.railOpen;
    saveOpenFlag(RAIL_OPEN_KEY, railOpen);
    return { railOpen };
  }),
  toggleLeftList: () => set((s) => {
    const leftListOpen = !s.leftListOpen;
    saveOpenFlag(LEFT_LIST_OPEN_KEY, leftListOpen);
    return { leftListOpen };
  }),
  setLeftListTab: (tab) => set({ leftListTab: tab }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setJournalPrefs: (p) => set((s) => ({ journalPrefs: { ...s.journalPrefs, ...p } })),
  setWikiPrefs: (p) => set((s) => ({ wikiPrefs: { ...s.wikiPrefs, ...p } })),
  setOperationsPrefs: (p) => set((s) => ({ operationsPrefs: { ...s.operationsPrefs, ...p } })),
  setTasksPrefs: (p) => set((s) => ({ tasksPrefs: { ...s.tasksPrefs, ...p } })),
  setAltarPrefs: (p) => set((s) => ({ altarPrefs: { ...s.altarPrefs, ...p } })),
  setTrashPrefs: (p) => set((s) => ({ trashPrefs: { ...s.trashPrefs, ...p } })),
  setTemplatesPrefs: (p) => set((s) => ({ templatesPrefs: { ...s.templatesPrefs, ...p } })),
  setTagsSort: (sort) => set({ tagsSort: sort }),
  setAltarWindowFullscreen: (enabled) => set({ altarWindowFullscreen: enabled }),
  setAltarShowPreview: (enabled) => {
    localStorage.setItem(ALTAR_SHOW_PREVIEW_KEY, enabled ? '1' : '0');
    set({ altarShowPreview: enabled });
  },
  setAltarLibraryPrefs: (p) => set((s) => {
    const next = { ...s.altarLibraryPrefs, ...p };
    localStorage.setItem(ALTAR_LIBRARY_SORT_KEY, next.sort);
    localStorage.setItem(ALTAR_LIBRARY_GROUPING_KEY, next.grouping);
    return { altarLibraryPrefs: next };
  }),
  setHomeJournalPrefs: (p) => set((s) => ({ homeJournalPrefs: { ...s.homeJournalPrefs, ...p } })),
  setHomeOpsPrefs:     (p) => set((s) => ({ homeOpsPrefs:     { ...s.homeOpsPrefs,     ...p } })),
  setHomeWikiPrefs:    (p) => set((s) => ({ homeWikiPrefs:    { ...s.homeWikiPrefs,    ...p } })),
}));
