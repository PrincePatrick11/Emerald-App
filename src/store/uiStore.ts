import { create } from 'zustand';
import { createTabId, isContentView, type OpenTab } from '../lib/tabs';
import { normalizeEditorFontId, normalizeThemeId, normalizeUIFontId } from '../themes/theme';
import type { ActiveView } from '../types';

export type ViewMode = 'list' | 'cards' | 'timeline';
export type SortMode = 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc' | 'category';
export interface ListPrefs { view: ViewMode; sort: SortMode; }

export type HomeSort = 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc';
export type HomeView = 'list' | 'cards';
export interface HomeSectionPrefs { sort: HomeSort; view: HomeView; count: number; } // count 0 = all

export type ThemeId = 'emerald-noctis' | 'emerald-parchment';
export type FontId = 'inter' | 'source-sans-3' | 'nunito' | 'ibm-plex-sans' | 'alegreya' | 'cormorant-garamond' | 'lora' | 'merriweather';

export interface EditActions {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

interface UIState {
  activeView: ActiveView;
  tabs: OpenTab[];
  activeTabId: string | null;
  history: ActiveView[];
  historyIndex: number;
  rightSidebarOpen: boolean;
  editActions: EditActions | null;
  operationsSubTab: string | null;
  wikiSubTab: string | null;
  leftListOpen: boolean;
  leftListTab: 'journal' | 'tasks' | 'operations' | 'wiki' | 'altar';
  searchQuery: string;
  journalPrefs: ListPrefs;
  wikiPrefs: ListPrefs;
  operationsPrefs: ListPrefs;
  tasksPrefs: ListPrefs;
  altarPrefs: ListPrefs;
  trashPrefs: ListPrefs;
  altarWindowFullscreen: boolean;
  homeJournalPrefs: HomeSectionPrefs;
  homeOpsPrefs: HomeSectionPrefs;
  homeWikiPrefs: HomeSectionPrefs;
  theme: ThemeId;
  uiFontId: FontId;
  editorFontId: FontId;

  setActiveView: (view: ActiveView) => void;
  openViewInNewTab: (view: ActiveView) => void;
  addTab: (view?: ActiveView) => void;
  selectTab: (id: string) => void;
  setTabsOrder: (ids: string[]) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  toggleRightSidebar: () => void;
  setEditActions: (actions: EditActions | null) => void;
  setOperationsSubTab: (id: string | null) => void;
  setWikiSubTab: (category: string | null) => void;
  toggleLeftList: () => void;
  setLeftListTab: (tab: 'journal' | 'tasks' | 'operations' | 'wiki' | 'altar') => void;
  setSearchQuery: (q: string) => void;
  setJournalPrefs: (p: Partial<ListPrefs>) => void;
  setWikiPrefs: (p: Partial<ListPrefs>) => void;
  setOperationsPrefs: (p: Partial<ListPrefs>) => void;
  setTasksPrefs: (p: Partial<ListPrefs>) => void;
  setAltarPrefs: (p: Partial<ListPrefs>) => void;
  setTrashPrefs: (p: Partial<ListPrefs>) => void;
  setAltarWindowFullscreen: (enabled: boolean) => void;
  setHomeJournalPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeOpsPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeWikiPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setTheme: (t: ThemeId) => void;
  setUIFontId: (fontId: FontId) => void;
  setEditorFontId: (fontId: FontId) => void;
}

function loadSavedTheme(): ThemeId {
  const rawThemeId = localStorage.getItem('theme-id');
  if (rawThemeId) return normalizeThemeId(rawThemeId);
  return normalizeThemeId(localStorage.getItem('theme'));
}

function loadSavedUIFontId(): FontId {
  return normalizeUIFontId(localStorage.getItem('ui-font-id'));
}

function loadSavedEditorFontId(): FontId {
  return normalizeEditorFontId(localStorage.getItem('editor-font-id'));
}


function normalizeSavedTab(tab: unknown): OpenTab | null {
  if (!tab || typeof tab !== 'object') return null;
  const candidate = tab as { id?: string; key?: string; view?: ActiveView };
  if (!candidate.view?.type) return null;
  return { id: candidate.id ?? candidate.key ?? createTabId(), view: candidate.view };
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

function withNavigationState(s: UIState, view: ActiveView) {
  const current = s.history[s.historyIndex];
  const isNewPage = !current || current.type !== view.type || current.id !== view.id;
  if (!isNewPage) return { activeView: view };
  const history = [...s.history.slice(0, s.historyIndex + 1), view];
  return { activeView: view, history, historyIndex: history.length - 1 };
}

const savedTabs = loadSavedTabs();

export const useUIStore = create<UIState>((set) => ({
  activeView: savedTabs.activeTabId
    ? savedTabs.tabs.find((tab) => tab.id === savedTabs.activeTabId)?.view ?? { type: 'home' }
    : { type: 'home' },
  tabs: savedTabs.tabs,
  activeTabId: savedTabs.activeTabId,
  history: [{ type: 'home' }],
  historyIndex: 0,
  rightSidebarOpen: true,
  editActions: null,
  operationsSubTab: null,
  wikiSubTab: null,
  leftListOpen: true,
  leftListTab: 'journal',
  searchQuery: '',
  theme: loadSavedTheme(),
  uiFontId: loadSavedUIFontId(),
  editorFontId: loadSavedEditorFontId(),
  journalPrefs: { view: 'list', sort: 'date_desc' },
  wikiPrefs: { view: 'cards', sort: 'category' },
  operationsPrefs: { view: 'list', sort: 'category' },
  tasksPrefs: { view: 'list', sort: 'category' },
  altarPrefs: { view: 'cards', sort: 'date_desc' },
  trashPrefs: { view: 'list', sort: 'date_desc' },
  altarWindowFullscreen: false,
  homeJournalPrefs: { sort: 'date_desc', view: 'list', count: 5 },
  homeOpsPrefs:     { sort: 'date_desc', view: 'list', count: 5 },
  homeWikiPrefs:    { sort: 'alpha_asc', view: 'cards', count: 6 },

  setActiveView: (view) => set((s) => {
    // Save/Cancel/Delete live only in the right sidebar, so edit mode must not start with it closed.
    const usesEditorSidebar = view.type === 'journal' || view.type === 'wiki'
      || view.type === 'operations' || view.type === 'altar';
    const openSidebar = view.mode === 'edit' && usesEditorSidebar && !s.rightSidebarOpen
      ? { rightSidebarOpen: true }
      : {};

    let tabs = s.tabs;
    let activeTabId = s.activeTabId;
    if (activeTabId) {
      tabs = tabs.map((tab) => tab.id === activeTabId ? { ...tab, view } : tab);
    } else if (isContentView(view)) {
      activeTabId = createTabId();
      tabs = [{ id: activeTabId, view }];
    }
    saveTabs(tabs, activeTabId);

    return { ...withNavigationState(s, view), tabs, activeTabId, ...openSidebar };
  }),

  openViewInNewTab: (view) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view }];
    saveTabs(tabs, id);
    return { ...withNavigationState(s, view), tabs, activeTabId: id };
  }),

  addTab: (view = { type: 'home' }) => set((s) => {
    const id = createTabId();
    const tabs = [...s.tabs, { id, view }];
    saveTabs(tabs, id);
    return { ...withNavigationState(s, view), tabs, activeTabId: id };
  }),

  selectTab: (id) => set((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === id);
    if (!tab) return {};
    saveTabs(s.tabs, id);
    return { ...withNavigationState(s, tab.view), activeTabId: id };
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
    const activeTabId = nextTab?.id ?? null;
    const nextView = nextTab?.view ?? { type: 'home' as const };
    saveTabs(tabs, activeTabId);
    return { ...withNavigationState(s, nextView), tabs, activeTabId };
  }),

  closeOtherTabs: (id) => set((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === id);
    if (!tab) return {};
    const tabs = [tab];
    saveTabs(tabs, tab.id);
    return { ...withNavigationState(s, tab.view), tabs, activeTabId: tab.id };
  }),

  navigateBack: () => set((s) => {
    if (s.historyIndex <= 0) return {};
    const historyIndex = s.historyIndex - 1;
    const activeView = s.history[historyIndex];
    const tabs = s.activeTabId ? s.tabs.map((tab) => tab.id === s.activeTabId ? { ...tab, view: activeView } : tab) : s.tabs;
    saveTabs(tabs, s.activeTabId);
    return { historyIndex, activeView, tabs };
  }),

  navigateForward: () => set((s) => {
    if (s.historyIndex >= s.history.length - 1) return {};
    const historyIndex = s.historyIndex + 1;
    const activeView = s.history[historyIndex];
    const tabs = s.activeTabId ? s.tabs.map((tab) => tab.id === s.activeTabId ? { ...tab, view: activeView } : tab) : s.tabs;
    saveTabs(tabs, s.activeTabId);
    return { historyIndex, activeView, tabs };
  }),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setEditActions: (actions) => set({ editActions: actions }),
  setOperationsSubTab: (id) => set({ operationsSubTab: id }),
  setWikiSubTab: (category) => set({ wikiSubTab: category }),
  toggleLeftList: () => set((s) => ({ leftListOpen: !s.leftListOpen })),
  setLeftListTab: (tab) => set({ leftListTab: tab }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setJournalPrefs: (p) => set((s) => ({ journalPrefs: { ...s.journalPrefs, ...p } })),
  setWikiPrefs: (p) => set((s) => ({ wikiPrefs: { ...s.wikiPrefs, ...p } })),
  setOperationsPrefs: (p) => set((s) => ({ operationsPrefs: { ...s.operationsPrefs, ...p } })),
  setTasksPrefs: (p) => set((s) => ({ tasksPrefs: { ...s.tasksPrefs, ...p } })),
  setAltarPrefs: (p) => set((s) => ({ altarPrefs: { ...s.altarPrefs, ...p } })),
  setTrashPrefs: (p) => set((s) => ({ trashPrefs: { ...s.trashPrefs, ...p } })),
  setAltarWindowFullscreen: (enabled) => set({ altarWindowFullscreen: enabled }),
  setHomeJournalPrefs: (p) => set((s) => ({ homeJournalPrefs: { ...s.homeJournalPrefs, ...p } })),
  setHomeOpsPrefs:     (p) => set((s) => ({ homeOpsPrefs:     { ...s.homeOpsPrefs,     ...p } })),
  setHomeWikiPrefs:    (p) => set((s) => ({ homeWikiPrefs:    { ...s.homeWikiPrefs,    ...p } })),
  setTheme: (theme) => {
    localStorage.setItem('theme-id', theme);
    set({ theme });
  },
  setUIFontId: (fontId) => {
    localStorage.setItem('ui-font-id', fontId);
    set({ uiFontId: fontId });
  },
  setEditorFontId: (fontId) => {
    localStorage.setItem('editor-font-id', fontId);
    set({ editorFontId: fontId });
  },
}));
