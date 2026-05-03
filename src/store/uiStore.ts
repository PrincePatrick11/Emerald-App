import { create } from 'zustand';
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

export const useUIStore = create<UIState>((set) => ({
  activeView: { type: 'home' },
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
    const isNewPage = !current || current.type !== view.type || current.id !== view.id;
    if (!isNewPage) return { activeView: view, ...openSidebar };
    const newHistory = [...s.history.slice(0, s.historyIndex + 1), view];
    return { activeView: view, history: newHistory, historyIndex: newHistory.length - 1, ...openSidebar };
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
