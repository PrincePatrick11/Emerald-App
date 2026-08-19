import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { isAltarFullscreen, useUIStore } from '../../store/uiStore';
import { useTagStore } from '../../store/tagStore';
import { useOperationStore } from '../../store/operationStore';
import { useAltarStore } from '../../store/altarStore';
import { useTaskStore } from '../../store/taskStore';
import { useRoutineStore } from '../../store/routineStore';
import { useVaultStore } from '../../store/vaultStore';
import { invoke } from '@tauri-apps/api/core';
import { computeMenuEnabledState, runMenuAction, SELF_CONTAINED_MENU_ACTIONS } from '../../lib/menuActions';
import TitleBar from './titlebar/TitleBar';
import LeftSidebarRail from './LeftSidebarRail';
import LeftSidebarEntryList from './LeftSidebarEntryList';
import RightSidebar from './RightSidebar';
import MainArea from './MainArea';
import TabBar from './TabBar';
import UndoToast from '../ui/UndoToast';
import ImportDestinationModal from '../ui/ImportDestinationModal';

const RAIL_WIDTH = 56;
const ENTRY_LIST_MIN = 180;
const ENTRY_LIST_DEFAULT = 220;
const RIGHT_MIN = 180;
const RIGHT_DEFAULT = 300;

function loadSavedWidth(key: string, min: number, fallback: number): number {
  const saved = localStorage.getItem(key);
  return saved ? Math.max(min, Number(saved)) : fallback;
}

export default function AppShell() {
  const { t, i18n } = useTranslation();
  const fetchEntries = useJournalStore((s) => s.fetchEntries);
  const fetchArticles = useWikiStore((s) => s.fetchArticles);
  const fetchTags = useTagStore((s) => s.fetchTags);
  const fetchAll = useOperationStore((s) => s.fetchAll);
  const fetchAllTasks = useTaskStore((s) => s.fetchAll);
  const fetchRoutines = useRoutineStore((s) => s.fetchRoutines);
  const fetchAltars = useAltarStore((s) => s.fetchAltars);
  const loadVaults = useVaultStore((s) => s.loadVaults);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const activeView = useUIStore((s) => s.activeView);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  const isAltarWindowFullscreen = useUIStore(isAltarFullscreen);

  const [entryListWidth, setEntryListWidth] = useState(() =>
    loadSavedWidth('entry-list-width', ENTRY_LIST_MIN, ENTRY_LIST_DEFAULT)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    loadSavedWidth('sidebar-right-width', RIGHT_MIN, RIGHT_DEFAULT)
  );

  const entryListWidthRef = useRef(entryListWidth);
  const rightWidthRef = useRef(rightWidth);
  useEffect(() => { entryListWidthRef.current = entryListWidth; }, [entryListWidth]);
  useEffect(() => { rightWidthRef.current = rightWidth; }, [rightWidth]);

  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    // Load vault metadata first so getDb() knows which DB file to open
    loadVaults().then(() =>
      Promise.all([fetchEntries(), fetchArticles(), fetchTags(), fetchAll(), fetchAllTasks(), fetchRoutines(), fetchAltars()])
    );
  }, []);

  // Sync menu bar labels with the current language
  useEffect(() => {
    invoke('update_menu_labels', {
      edit:            t('menu.edit'),
      view:            t('menu.view'),
      export:          t('menu.export'),
      import:          t('menu.import'),
      resetView:       t('menu.resetView'),
      exportPdf:       t('menu.exportPdf'),
      exportMarkdown:  t('menu.exportMarkdown'),
      exportEmerald:   t('menu.exportEmerald'),
      exportAltarImage: t('menu.exportAltarImage'),
      exportAltarJpeg: t('menu.exportAltarJpeg'),
      exportAltarPng:  t('menu.exportAltarPng'),
      exportAltarWebp: t('menu.exportAltarWebp'),
      importMarkdown:  t('menu.importMarkdown'),
      importEmerald:   t('menu.importEmerald'),
    }).catch(() => {/* desktop-only, ignore in browser preview */});
  }, [i18n.language, t]);

  // Keeps the native macOS menu's enabled states in sync with the current
  // view. The rules live in `computeMenuEnabledState` so the HTML menu bar
  // greys out exactly the same items. No-ops on Windows/Linux, where no
  // native menu is installed and the Rust commands bail out early.
  useEffect(() => {
    const enabled = computeMenuEnabledState(activeView, useOperationStore.getState().operations);
    invoke('set_export_menu_enabled', {
      entryEnabled: enabled.entryEnabled,
      pdfEnabled: enabled.pdfEnabled,
      emeraldEnabled: enabled.emeraldEnabled,
    }).catch(() => {/* desktop-only, ignore in browser preview */});
    invoke('set_altar_export_menu_enabled', { enabled: enabled.altarImageEnabled })
      .catch(() => {/* desktop-only, ignore in browser preview */});
  }, [activeView.type, activeView.id, activeView.mode]);

  useEffect(() => {
    const unlistenBack = listen('navigate-back', () => navigateBack());
    const unlistenFwd  = listen('navigate-forward', () => navigateForward());
    return () => {
      unlistenBack.then(fn => fn());
      unlistenFwd.then(fn => fn());
    };
  }, [navigateBack, navigateForward]);

  useEffect(() => {
    const unlisten = listen('reset-sidebar-widths', () => {
      setEntryListWidth(ENTRY_LIST_DEFAULT);
      setRightWidth(RIGHT_DEFAULT);
      localStorage.removeItem('entry-list-width');
      localStorage.removeItem('sidebar-right-width');
      setAltarWindowFullscreen(false);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [setAltarWindowFullscreen]);

  // The native macOS menu emits these; the HTML menu bar on Windows/Linux
  // calls `runMenuAction` directly. Both go through the same implementation.
  useEffect(() => {
    const unlisteners = SELF_CONTAINED_MENU_ACTIONS.map((id) =>
      listen(id, () => { void runMenuAction(id); })
    );
    return () => { unlisteners.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const onLeftPointerDown = (e: React.PointerEvent) => {
    draggingLeft.current = true;
    startX.current = e.clientX;
    startWidth.current = entryListWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRightPointerDown = (e: React.PointerEvent) => {
    draggingRight.current = true;
    startX.current = e.clientX;
    startWidth.current = rightWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingLeft.current) {
      const delta = e.clientX - startX.current;
      setEntryListWidth(Math.max(ENTRY_LIST_MIN, startWidth.current + delta));
    }
    if (draggingRight.current) {
      const delta = startX.current - e.clientX;
      setRightWidth(Math.max(RIGHT_MIN, startWidth.current + delta));
    }
  };

  const onPointerUp = () => {
    if (draggingLeft.current) {
      localStorage.setItem('entry-list-width', String(entryListWidthRef.current));
    }
    if (draggingRight.current) {
      localStorage.setItem('sidebar-right-width', String(rightWidthRef.current));
    }
    draggingLeft.current = false;
    draggingRight.current = false;
  };

  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden bg-stone-900 relative">
      {/* Jade accent — magical topline. pointer-events-none so it never
          intercepts a window drag on the title bar underneath it. */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none z-50"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,166,102,0.45) 30%, rgba(0,230,153,0.3) 50%, rgba(0,166,102,0.45) 70%, transparent)' }}
      />

      <TitleBar />

      {/* The sidebar resize handles live in here, so the pointer handlers that
          drive them do too. */}
      <div
        className="flex flex-1 min-h-0 overflow-hidden relative"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!isAltarWindowFullscreen && (
          <aside
            className="app-sidebar app-sidebar-left flex-shrink-0 border-r border-stone-700/60 relative"
            style={{ width: RAIL_WIDTH + (leftListOpen ? entryListWidth : 0) }}
          >
            <div className="flex h-full">
              <LeftSidebarRail />
              {leftListOpen && <LeftSidebarEntryList />}
            </div>
            {leftListOpen && (
              <div
                onPointerDown={onLeftPointerDown}
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-jade-500/20 transition-colors"
              />
            )}
          </aside>
        )}

        {/* Main Content */}
        <main className="app-main flex-1 min-w-0 overflow-hidden flex flex-col">
          {!isAltarWindowFullscreen && <TabBar />}
          <div className="flex-1 min-h-0 overflow-hidden">
            <MainArea />
          </div>
        </main>

        {/* Right Sidebar */}
        {rightSidebarOpen && !isAltarWindowFullscreen && (
          <aside
            className="app-sidebar app-sidebar-right flex-shrink-0 border-l border-stone-700/60 animate-slide-in relative"
            style={{ width: rightWidth }}
          >
            {/* Resize handle */}
            <div
              onPointerDown={onRightPointerDown}
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-jade-500/20 transition-colors"
            />
            <RightSidebar />
          </aside>
        )}
      </div>

      <UndoToast />
      <ImportDestinationModal />
    </div>
  );
}
