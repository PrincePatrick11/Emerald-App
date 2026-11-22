import { create } from 'zustand';
import {
  createTabId, freshHistory, isContentView, normalizeSavedHistory, pushHistory, stripSessionFlags,
  type NavHistory, type OpenTab,
} from '../lib/tabs';
import {
  confirmLeave, guardKey, guardRegistered, holdsOpenEdit, leaveNeedsConfirm, useLeaveGuardStore,
} from './leaveGuardStore';
import { isLibraryView, isViewId, type CollectionId } from '../lib/modules';
import type { ActiveView } from '../types';
import { clearSessionState } from './sessionStore';

export const VIEW_MODES = ['list', 'cards', 'cards_wide', 'timeline'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
/** `count_desc` = "most frequent first" — only collections with something to
 *  count offer it (`CollectionDashboard`'s `itemCount`). `manual` = the
 *  hand-dragged order of the categories. */
export const SORT_MODES = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc', 'count_desc', 'manual'] as const;
export type SortMode = (typeof SORT_MODES)[number];
/** Grouping as its own axis beside view and sorting. Formerly
 *  "Category" was a SortMode — which put two decisions into one button:
 *  anyone who wanted to group by category lost their sorting in the process. */
export const GROUPING_MODES = ['grouped', 'flat'] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];
export interface ListPrefs { view: ViewMode; sort: SortMode; grouping: GroupingMode; }


/** What a vault without saved preferences shows — and what an invalid saved value falls back to. */
const DEFAULT_COLLECTION_PREFS: Record<CollectionId, ListPrefs> = {
  tags: { view: 'list', sort: 'alpha_asc', grouping: 'flat' },
  categories: { view: 'list', sort: 'manual', grouping: 'flat' },
  images: { view: 'cards', sort: 'alpha_asc', grouping: 'flat' },
  templates: { view: 'list', sort: 'alpha_asc', grouping: 'flat' },
  blocks: { view: 'list', sort: 'alpha_asc', grouping: 'flat' },
  lexicon: { view: 'list', sort: 'alpha_asc', grouping: 'flat' },
  symbols: { view: 'cards', sort: 'date_desc', grouping: 'flat' },
};

export interface EditActions {
  onSave: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

interface UIState {
  activeView: ActiveView;
  tabs: OpenTab[];
  activeTabId: string | null;
  /** The history while no tab is open. With tabs, each tab keeps its
   *  own (`OpenTab.history`); `selectActiveHistory` picks the right one. */
  tablessHistory: NavHistory;
  /** Persistent like `railOpen` and `leftListOpen` (localStorage). Only what
   *  the user toggles themself is saved — the forced expansion in
   *  `setActiveView` is not. */
  rightSidebarOpen: boolean;
  /** The portal target that the right sidebar provides in list views.
   *  Dashboard portals its complete header (title, actions, toolbar,
   *  filters) into it; `null` means sidebar closed or detail view — then
   *  Dashboard has no header. Invariant: exactly ONE writer (the host div in
   *  RightSidebar's list branch) and exactly one reader at a time (`SidebarPortal`
   *  — from Dashboard or the page of a custom block); MainArea renders
   *  only one view at a time, so never more than one portals.
   *  Deliberately not persisted (DOM node). */
  listHeaderHost: HTMLElement | null;
  /** Whether a `Dashboard` is currently mounted — it registers itself.
   *  RightSidebar provides the portal target based on this, instead of
   *  guessing from `activeView.id`: tasks show their list even with an id (jump target, no
   *  open entry), and the id of a deleted entry makes the entry page
   *  fall back to its dashboard's list. */
  dashboardMounted: boolean;
  editActions: EditActions | null;
  /** A Cancel is writing the entry back right now (`withEditLock`): Done,
   *  Delete and Cancel are locked, and the page cannot be left — a click in between would hit the
   *  view that is being torn down, and the confirmation would apply to it. */
  editLocked: boolean;
  /** The rail on the far left. Persistent (localStorage), like `leftListOpen`. */
  railOpen: boolean;
  leftListOpen: boolean;
  /** "Lock view": the sidebar widths can no longer be
   *  dragged. Persistent (localStorage), like the widths themselves. */
  viewLocked: boolean;
  searchQuery: string;
  tasksPrefs: ListPrefs;
  trashPrefs: ListPrefs;
  /** The order of the entries under each tag in "Tags" (only `sort` is used). */
  tagEntriesPrefs: ListPrefs;
  /** View and sorting of each collection (`grouping` is unused there, kept
   *  for the shared `ListPrefs`). */
  collectionPrefs: Record<CollectionId, ListPrefs>;
  /** The groups per module that deviate from the default (see hooks/useCollapsedSet):
   *  collapsed ones — or, in scopes that start collapsed, expanded ones.
   *  In the store rather than view-local, because MainArea unmounts the views
   *  on module switch. */
  collapsedGroups: Record<string, ReadonlySet<string>>;
  /** Which sections are expanded or collapsed (`usePersistedFlag`), per key. */
  flags: Record<string, boolean>;

  setActiveView: (view: ActiveView) => void;
  toggleCollapsedGroup: (scope: string, id: string) => void;
  /** Removes the ids from the set of a scope. */
  removeCollapsedGroups: (scope: string, ids: string[]) => void;
  /** Puts the ids into the set of a scope — the counterpart to removeCollapsedGroups. */
  addCollapsedGroups: (scope: string, ids: string[]) => void;
  setFlag: (key: string, value: boolean) => void;
  closeAllTabs: () => void;
  openViewInNewTab: (view: ActiveView) => void;
  addTab: (view?: ActiveView) => void;
  selectTab: (id: string) => void;
  setTabsOrder: (ids: string[]) => void;
  /** Asks first if the tab is still being edited (`leaveGuardStore`). */
  closeTab: (id: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  toggleRightSidebar: () => void;
  setListHeaderHost: (el: HTMLElement | null) => void;
  setDashboardMounted: (mounted: boolean) => void;
  setEditActions: (actions: EditActions | null) => void;
  /** Ends the editing of entry `id` in exactly this tab (`null` = the
   *  view without a tab) — for a cancel whose tab is no longer the open one
   *  when writing back. Not a step in the history. */
  endEditInTab: (tabId: string | null, id: string) => void;
  toggleRail: () => void;
  toggleLeftList: () => void;
  toggleViewLock: () => void;
  /** Shows rail, left list and right sidebar again — part of "Reset view". */
  showAllPanels: () => void;
  setSearchQuery: (q: string) => void;
  setTasksPrefs: (p: Partial<ListPrefs>) => void;
  setTrashPrefs: (p: Partial<ListPrefs>) => void;
  setTagEntriesPrefs: (p: Partial<ListPrefs>) => void;
  setCollectionPrefs: (id: CollectionId, p: Partial<ListPrefs>) => void;
}

/** Where the app starts, and where it lands without a tab: the dashboard "All entries". */
export const ALL_ENTRIES_VIEW: ActiveView = { type: 'dashboard', id: 'all' };

const RAIL_OPEN_KEY = 'rail-open';
const LEFT_LIST_OPEN_KEY = 'left-list-open';
const RIGHT_SIDEBAR_OPEN_KEY = 'right-sidebar-open';
const VIEW_LOCKED_KEY = 'view-locked';

/** The three sidebars start open as long as nothing else is saved. */
function loadOpenFlag(key: string): boolean {
  return localStorage.getItem(key) !== '0';
}

function saveOpenFlag(key: string, open: boolean) {
  localStorage.setItem(key, open ? '1' : '0');
}


function normalizeSavedTab(tab: unknown): OpenTab | null {
  if (!tab || typeof tab !== 'object') return null;
  const candidate = tab as { id?: string; key?: string; view?: ActiveView; history?: unknown };
  // isViewId: localStorage may carry tab types from older versions —
  // they are dropped cleanly here instead of rendering as a ghost view.
  if (!candidate.view?.type || !isViewId(candidate.view.type)) return null;
  // isNew is a session flag, not tab state: if it survived a restart,
  // Cancel would permanently delete an entry that was long since autosaved.
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

/** Save/Cancel/Delete live only in the right sidebar, so edit mode must not start with it closed.
 *  A user-built block's or template's page is always editing and keeps its Save there too. */
function viewNeedsSidebar(view: ActiveView): boolean {
  return (view.mode === 'edit' && view.type === 'entry') || (isLibraryView(view.type) && !!view.id);
}

/** The history that Back and Forward currently walk through: that of the active tab, otherwise the tabless one. */
export function selectActiveHistory(s: Pick<UIState, 'tabs' | 'activeTabId' | 'tablessHistory'>): NavHistory {
  if (!s.activeTabId) return s.tablessHistory;
  return s.tabs.find((tab) => tab.id === s.activeTabId)?.history ?? s.tablessHistory;
}

/** One step through the active history; `{}` if it cannot go further in that direction. */
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

/**
 * Runs `run` — immediately, or only after the question if the open page
 * carries unsaved changes and `leaves` leaves it. On "Keep
 * editing", `run` is dropped.
 *
 * If editing is currently locked (`editLocked`), a step that would
 * leave the page is dropped entirely — without a question, like a click on a locked
 * button.
 */
function whenLeaveConfirmed(leaves: boolean, run: () => void): void {
  // The question would go to a view that is being torn down.
  if (leaves && useUIStore.getState().editLocked) return;
  if (!leaves || !leaveNeedsConfirm()) {
    run();
    return;
  }
  void confirmLeave().then((ok) => { if (ok) run(); });
}

/** Does any tab — or the view without a tab — show `type`/`id` in edit mode? */
export function isInEdit(s: Pick<UIState, 'activeView' | 'tabs'>, type: string, id: string): boolean {
  return [s.activeView, ...s.tabs.map((tab) => tab.view)]
    .some((view) => view.type === type && view.id === id && view.mode === 'edit');
}

/**
 * Asks about the edit in tab `tabId` if it carries changes: first
 * look — switch there and wait until the page has registered its guard
 * (it only mounts after the switch) —, then ask.
 * `true`: the tab may go. `false`: keep editing, or one is
 * somewhere else by now and the question would concern another page.
 */
export async function askInTab(tabId: string): Promise<boolean> {
  const { tabs, activeTabId, selectTab } = useUIStore.getState();
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab || !holdsOpenEdit(tab.view)) return true;
  const key = guardKey(tab.view.type, tab.view.id);
  if (activeTabId !== tabId) selectTab(tabId);
  const registered = await guardRegistered(key);
  if (useUIStore.getState().activeTabId !== tabId) return false;
  // If the page does not register, there is nobody to ask — its work
  // is saved (autosave) or persisted along (draft).
  if (!registered) return true;
  if (useLeaveGuardStore.getState().guard?.key !== key) return false;
  // Locked (`editLocked`): the question would go to a page that is being torn down.
  if (useUIStore.getState().editLocked) return false;
  return confirmLeave();
}

/** The same page in the same mode is not leaving. */
function leavesPage(current: ActiveView, next: ActiveView): boolean {
  return !(current.type === next.type && current.id === next.id && current.mode === next.mode);
}

/** `s` with `history` as the active history — that of the active tab, otherwise the tabless one. */
function withActiveHistory(s: UIState, history: NavHistory): UIState {
  if (!s.activeTabId) return { ...s, tablessHistory: history };
  return { ...s, tabs: s.tabs.map((tab) => (tab.id === s.activeTabId ? { ...tab, history } : tab)) };
}

/**
 * The history from which a Back/Forward proceeds (`stepGuarded`) while its
 * confirmation is open. On "Keep editing" — and for a step that fell into
 * the lock — it stays until the next step replaces it — it is read only by whoever set it.
 */
let heldHistory: NavHistory | null = null;

/**
 * Back or Forward. The step proceeds from the history as it was before the question:
 * "Save" and "Discard" switch the page themselves (back to the list)
 * and would otherwise have shifted it by exactly that step — one would be back
 * on the page one wanted to leave.
 */
function stepGuarded(delta: -1 | 1): void {
  // A step into the void does not ask about unsaved changes: the
  // arrows are greyed out there, but the mouse buttons arrive anyway.
  const { views, index } = selectActiveHistory(useUIStore.getState());
  if (index + delta < 0 || index + delta >= views.length) return;
  const tabId = useUIStore.getState().activeTabId;
  heldHistory = selectActiveHistory(useUIStore.getState());
  whenLeaveConfirmed(true, () => {
    const before = heldHistory;
    heldHistory = null;
    useUIStore.setState((s) => (s.activeTabId === tabId && before ? stepHistory(withActiveHistory(s, before), delta) : {}));
  });
}

/** Closes the tab without asking — `closeTab` handles the asking. */
function closeTabNow(id: string): void {
  useUIStore.setState((s) => {
    const tabIndex = s.tabs.findIndex((tab) => tab.id === id);
    if (tabIndex < 0) return {};
    const tabs = s.tabs.filter((tab) => tab.id !== id);
    if (s.activeTabId !== id) {
      saveTabs(tabs, s.activeTabId);
      return { tabs };
    }

    const nextTab = tabs[Math.min(tabIndex, tabs.length - 1)] ?? tabs[tabIndex - 1];
    saveTabs(tabs, nextTab?.id ?? null);
    // The closed tab's history goes with it; without a tab the tabless one starts fresh.
    if (!nextTab) {
      return { tabs, activeTabId: null, activeView: ALL_ENTRIES_VIEW, tablessHistory: freshHistory(ALL_ENTRIES_VIEW) };
    }
    return { tabs, activeTabId: nextTab.id, activeView: nextTab.view };
  });
}

const savedTabs = loadSavedTabs();
const initialView: ActiveView = savedTabs.activeTabId
  ? savedTabs.tabs.find((tab) => tab.id === savedTabs.activeTabId)?.view ?? ALL_ENTRIES_VIEW
  : ALL_ENTRIES_VIEW;

export const useUIStore = create<UIState>((set, get) => ({
  activeView: initialView,
  tabs: savedTabs.tabs,
  activeTabId: savedTabs.activeTabId,
  tablessHistory: freshHistory(ALL_ENTRIES_VIEW),
  // A restored tab in edit mode needs the sidebar, even
  // if it was last collapsed — the same rule as in `setActiveView`.
  rightSidebarOpen: loadOpenFlag(RIGHT_SIDEBAR_OPEN_KEY) || viewNeedsSidebar(initialView),
  listHeaderHost: null,
  dashboardMounted: false,
  editActions: null,
  editLocked: false,
  railOpen: loadOpenFlag(RAIL_OPEN_KEY),
  leftListOpen: loadOpenFlag(LEFT_LIST_OPEN_KEY),
  // Unlike the sidebars: off as long as nothing is saved.
  viewLocked: localStorage.getItem(VIEW_LOCKED_KEY) === '1',
  searchQuery: '',
  // Dashboards keep view, sorting and grouping in their
  // dashboard's row (`useDashboardPrefs`), not here.
  tasksPrefs: { view: 'list', sort: 'date_desc', grouping: 'grouped' },
  trashPrefs: { view: 'list', sort: 'date_desc', grouping: 'flat' },
  tagEntriesPrefs: { view: 'list', sort: 'date_desc', grouping: 'flat' },
  collectionPrefs: DEFAULT_COLLECTION_PREFS,
  collapsedGroups: {},
  flags: {},

  setFlag: (key, value) => set((s) => (s.flags[key] === value ? s : { flags: { ...s.flags, [key]: value } })),

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

  setActiveView: (view) => whenLeaveConfirmed(leavesPage(get().activeView, view), () => set((s) => {
    const openSidebar = viewNeedsSidebar(view) && !s.rightSidebarOpen
      ? { rightSidebarOpen: true }
      : {};

    let tabs = s.tabs;
    let activeTabId = s.activeTabId;
    let tablessHistory = s.tablessHistory;
    if (activeTabId) {
      tabs = tabs.map((tab) => tab.id === activeTabId ? { ...tab, view, history: pushHistory(tab.history, view) } : tab);
    } else if (isContentView(view)) {
      // The automatically opened tab continues the path before it: Back leads
      // to where the entry was opened from.
      activeTabId = createTabId();
      tabs = [{ id: activeTabId, view, history: pushHistory(s.tablessHistory, view) }];
      tablessHistory = freshHistory(ALL_ENTRIES_VIEW);
    } else {
      tablessHistory = pushHistory(s.tablessHistory, view);
    }
    saveTabs(tabs, activeTabId);

    return { activeView: view, tabs, activeTabId, tablessHistory, ...openSidebar };
  })),

  // For vault switch and replace import: tabs and history carry entry IDs
  // that do not exist in the new database — both fall back to the fresh
  // start state (no tabs, "All entries"), as on the very first start. The
  // working state of the lists goes with them; the preferences (including the collapse states)
  // belong to the vault and come with `loadVaultPrefs`.
  closeAllTabs: () => {
    clearSessionState();
    saveTabs([], null);
    set({
      tabs: [],
      activeTabId: null,
      activeView: ALL_ENTRIES_VIEW,
      tablessHistory: freshHistory(ALL_ENTRIES_VIEW),
    });
  },

  // A new tab starts with a fresh history.
  openViewInNewTab: (view) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view, history: freshHistory(view) }];
    saveTabs(tabs, id);
    return { activeView: view, tabs, activeTabId: id };
  }),

  addTab: (view = ALL_ENTRIES_VIEW) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view, history: freshHistory(view) }];
    saveTabs(tabs, id);
    return { activeView: view, tabs, activeTabId: id };
  }),

  // Switching tabs is not a step in the history — it only changes which history applies.
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

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (activeTabId === id) {
      whenLeaveConfirmed(true, () => closeTabNow(id));
      return;
    }
    if (!holdsOpenEdit(tab.view)) {
      closeTabNow(id);
      return;
    }
    // A background tab with unsaved changes: ask — and afterwards
    // return to the tab from which it was closed.
    void askInTab(id).then((leave) => {
      if (!leave) return;
      closeTabNow(id);
      if (activeTabId && get().tabs.some((candidate) => candidate.id === activeTabId)) get().selectTab(activeTabId);
    });
  },

  navigateBack: () => stepGuarded(-1),
  navigateForward: () => stepGuarded(1),
  toggleRightSidebar: () => set((s) => {
    const rightSidebarOpen = !s.rightSidebarOpen;
    saveOpenFlag(RIGHT_SIDEBAR_OPEN_KEY, rightSidebarOpen);
    return { rightSidebarOpen };
  }),

  // Meant as a ref callback: React calls it with `null` on unmount,
  // whereby the dashboard header disappears with the sidebar.
  setListHeaderHost: (el) => set((s) => (s.listHeaderHost === el ? s : { listHeaderHost: el })),
  setDashboardMounted: (mounted) => set((s) => (s.dashboardMounted === mounted ? s : { dashboardMounted: mounted })),
  setEditActions: (actions) => set({ editActions: actions }),
  endEditInTab: (tabId, id) => set((s) => {
    const end = (view: ActiveView): ActiveView => (
      view.id === id && view.mode === 'edit' ? stripSessionFlags({ ...view, mode: 'view' }) : view
    );
    const tabs = s.tabs.map((tab) => (tab.id === tabId ? { ...tab, view: end(tab.view) } : tab));
    saveTabs(tabs, s.activeTabId);
    return { tabs, activeView: s.activeTabId === tabId ? end(s.activeView) : s.activeView };
  }),
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
  toggleViewLock: () => set((s) => {
    const viewLocked = !s.viewLocked;
    localStorage.setItem(VIEW_LOCKED_KEY, viewLocked ? '1' : '0');
    return { viewLocked };
  }),
  showAllPanels: () => {
    saveOpenFlag(RAIL_OPEN_KEY, true);
    saveOpenFlag(LEFT_LIST_OPEN_KEY, true);
    saveOpenFlag(RIGHT_SIDEBAR_OPEN_KEY, true);
    set({ railOpen: true, leftListOpen: true, rightSidebarOpen: true });
  },
  setSearchQuery: (q) => set({ searchQuery: q }),
  setTasksPrefs: (p) => set((s) => ({ tasksPrefs: { ...s.tasksPrefs, ...p } })),
  setTrashPrefs: (p) => set((s) => ({ trashPrefs: { ...s.trashPrefs, ...p } })),
  setTagEntriesPrefs: (p) => set((s) => ({ tagEntriesPrefs: { ...s.tagEntriesPrefs, ...p } })),
  setCollectionPrefs: (id, p) => set((s) => ({
    collectionPrefs: { ...s.collectionPrefs, [id]: { ...s.collectionPrefs[id], ...p } },
  })),
}));

/** How many `withEditLock` calls are running right now. */
let editLocks = 0;
/** How many have ever begun. */
let editLocksStarted = 0;

/**
 * Counts every lock that has begun. Anyone reading across several awaits (the
 * automatic backup) can tell from it that a Cancel has written in
 * between — even if `editLocked` is off again at the end.
 */
export function editLockEpoch(): number {
  return editLocksStarted;
}

/**
 * Locks editing while `run` writes (`editLocked`): the sidebar's buttons
 * and leaving the page. Counted, not toggled: Cancels in two tabs can
 * overlap — whichever finishes first does not release the other's lock.
 */
export async function withEditLock<T>(run: () => Promise<T>): Promise<T> {
  editLocksStarted++;
  if (++editLocks === 1) useUIStore.setState({ editLocked: true });
  try {
    return await run();
  } finally {
    if (--editLocks === 0) useUIStore.setState({ editLocked: false });
  }
}
