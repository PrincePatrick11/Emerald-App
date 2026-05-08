import { create } from 'zustand';
import { getTabKey, type OpenTab } from '../lib/tabs';
import type { ActiveView } from '../types';

export type ViewMode = 'list' | 'cards' | 'timeline';
export type SortMode = 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc' | 'category';
export interface ListPrefs { view: ViewMode; sort: SortMode; }

export type HomeSort = 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc';
export type HomeView = 'list' | 'cards';
export interface HomeSectionPrefs { sort: HomeSort; view: HomeView; count: number; } // count 0 = all

export type Theme = 'dark' | 'light';

interface UIState {
  activeView: ActiveView;
  tabs: OpenTab[];
  history: ActiveView[];
  historyIndex: number;
  rightSidebarOpen: boolean;
  rightSidebarTab: 'op-properties' | 'backlinks' | 'wiki' | 'operations' | 'routines';
  operationsSubTab: string | null;
  wikiSubTab: string | null;
  searchQuery: string;
  journalPrefs: ListPrefs;
  wikiPrefs: ListPrefs;
  operationsPrefs: ListPrefs;
  altarPrefs: ListPrefs;
  trashPrefs: ListPrefs;
  homeJournalPrefs: HomeSectionPrefs;
  homeOpsPrefs: HomeSectionPrefs;
  homeWikiPrefs: HomeSectionPrefs;
  theme: Theme;

  setActiveView: (view: ActiveView) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  toggleRightSidebar: () => void;
  setRightSidebarTab: (tab: 'op-properties' | 'backlinks' | 'wiki' | 'operations' | 'routines') => void;
  setOperationsSubTab: (id: string | null) => void;
  setWikiSubTab: (category: string | null) => void;
  setSearchQuery: (q: string) => void;
  setJournalPrefs: (p: Partial<ListPrefs>) => void;
  setWikiPrefs: (p: Partial<ListPrefs>) => void;
  setOperationsPrefs: (p: Partial<ListPrefs>) => void;
  setAltarPrefs: (p: Partial<ListPrefs>) => void;
  setTrashPrefs: (p: Partial<ListPrefs>) => void;
  setHomeJournalPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeOpsPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setHomeWikiPrefs: (p: Partial<HomeSectionPrefs>) => void;
  setTheme: (t: Theme) => void;
}

function loadSavedTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem('open-tabs');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpenTab[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tab) => tab?.key && tab?.view?.type && tab.view.id);
  } catch {
    return [];
  }
}

function saveTabs(tabs: OpenTab[]) {
  localStorage.setItem('open-tabs', JSON.stringify(tabs));
}

export const useUIStore = create<UIState>((set) => ({
  activeView: { type: 'home' },
  tabs: loadSavedTabs(),
  history: [{ type: 'home' }],
  historyIndex: 0,
  rightSidebarOpen: true,
  rightSidebarTab: 'op-properties',
  operationsSubTab: null,
  wikiSubTab: null,
  searchQuery: '',
  theme: (localStorage.getItem('theme') as Theme) ?? 'dark',
  journalPrefs: { view: 'list', sort: 'date_desc' },
  wikiPrefs: { view: 'cards', sort: 'category' },
  operationsPrefs: { view: 'list', sort: 'category' },
  altarPrefs: { view: 'cards', sort: 'date_desc' },
  trashPrefs: { view: 'list', sort: 'date_desc' },
  homeJournalPrefs: { sort: 'date_desc', view: 'list', count: 5 },
  homeOpsPrefs:     { sort: 'date_desc', view: 'list', count: 5 },
  homeWikiPrefs:    { sort: 'alpha_asc', view: 'cards', count: 6 },

  setActiveView: (view) => set((s) => {
    const current = s.history[s.historyIndex];
    // Auto-open right sidebar when entering edit mode
    const usesEditorSidebar =
      view.type === 'journal' || view.type === 'wiki' || view.type === 'operations';
    const openSidebar = view.mode === 'edit' && usesEditorSidebar && !s.rightSidebarOpen
      ? { rightSidebarOpen: true }
      : {};
    // Mode changes (read ↔ edit) don't create a history entry
    const tabKey = getTabKey(view);
    let tabs = s.tabs;
    if (tabKey) {
      const nextTab = { key: tabKey, view };
      const existingIndex = tabs.findIndex((tab) => tab.key === tabKey);
      tabs = existingIndex >= 0
        ? tabs.map((tab, index) => index === existingIndex ? nextTab : tab)
        : [...tabs, nextTab];
      saveTabs(tabs);
    }

    const isNewPage = !current || current.type !== view.type || current.id !== view.id;
    if (!isNewPage) return { activeView: view, tabs, ...openSidebar };
    const newHistory = [...s.history.slice(0, s.historyIndex + 1), view];
    return { activeView: view, tabs, history: newHistory, historyIndex: newHistory.length - 1, ...openSidebar };
  }),

  closeTab: (key) => set((s) => {
    const tabIndex = s.tabs.findIndex((tab) => tab.key === key);
    if (tabIndex < 0) return {};
    const tabs = s.tabs.filter((tab) => tab.key !== key);
    saveTabs(tabs);

    const activeKey = getTabKey(s.activeView);
    if (activeKey !== key) return { tabs };

    const nextTab = tabs[Math.min(tabIndex, tabs.length - 1)] ?? tabs[tabIndex - 1];
    const nextView = nextTab?.view ?? { type: 'home' as const };
    const history = [...s.history.slice(0, s.historyIndex + 1), nextView];
    return { tabs, activeView: nextView, history, historyIndex: history.length - 1 };
  }),

  closeOtherTabs: (key) => set((s) => {
    const tab = s.tabs.find((candidate) => candidate.key === key);
    if (!tab) return {};
    const tabs = [tab];
    saveTabs(tabs);
    return { tabs, activeView: tab.view };
  }),

  navigateBack: () => set((s) => {
    if (s.historyIndex <= 0) return {};
    const newIndex = s.historyIndex - 1;
    return { historyIndex: newIndex, activeView: s.history[newIndex] };
  }),

  navigateForward: () => set((s) => {
    if (s.historyIndex >= s.history.length - 1) return {};
    const newIndex = s.historyIndex + 1;
    return { historyIndex: newIndex, activeView: s.history[newIndex] };
  }),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),
  setOperationsSubTab: (id) => set({ operationsSubTab: id }),
  setWikiSubTab: (category) => set({ wikiSubTab: category }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setJournalPrefs: (p) => set((s) => ({ journalPrefs: { ...s.journalPrefs, ...p } })),
  setWikiPrefs: (p) => set((s) => ({ wikiPrefs: { ...s.wikiPrefs, ...p } })),
  setOperationsPrefs: (p) => set((s) => ({ operationsPrefs: { ...s.operationsPrefs, ...p } })),
  setAltarPrefs: (p) => set((s) => ({ altarPrefs: { ...s.altarPrefs, ...p } })),
  setTrashPrefs: (p) => set((s) => ({ trashPrefs: { ...s.trashPrefs, ...p } })),
  setHomeJournalPrefs: (p) => set((s) => ({ homeJournalPrefs: { ...s.homeJournalPrefs, ...p } })),
  setHomeOpsPrefs:     (p) => set((s) => ({ homeOpsPrefs:     { ...s.homeOpsPrefs,     ...p } })),
  setHomeWikiPrefs:    (p) => set((s) => ({ homeWikiPrefs:    { ...s.homeWikiPrefs,    ...p } })),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
}));
