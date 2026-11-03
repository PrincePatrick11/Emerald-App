import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useUIStore } from '../../store/uiStore';
import type { ActiveView } from '../../types';
import { useTagStore } from '../../store/tagStore';
import { useOperationStore } from '../../store/operationStore';
import { useAltarStore } from '../../store/altarStore';
import { useRoutineStore } from '../../store/routineStore';
import { useVaultStore } from '../../store/vaultStore';
import { invoke } from '@tauri-apps/api/core';
import { noEntryMessage, exportErrorMessage } from '../../lib/export';
import { activeExportTarget } from '../../lib/exportData';
import { useExportStore, type ExportFormat } from '../../store/exportStore';
import { exportAsEmerald, importFromEmerald, importFromMarkdown } from '../../lib/emeraldFormat';
import { saveAltarImage, saveAltarPDF } from '../../lib/altarExport';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import MainArea from './MainArea';
import TabBar from './TabBar';
import UndoToast from '../ui/UndoToast';
import ImportDestinationModal from '../ui/ImportDestinationModal';
import ExportModal from '../ui/ExportModal';

const LEFT_MIN = 180;
const RIGHT_MIN = 180;
const LEFT_DEFAULT = 220;
const RIGHT_DEFAULT = 300;

/** An Altar open in reading view — where PDF / Emerald export the altar instead of an entry. */
function isAltarReadingView(view: ActiveView): boolean {
  return view.type === 'altar' && !!view.id && view.mode !== 'edit';
}

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
  const fetchRoutines = useRoutineStore((s) => s.fetchRoutines);
  const fetchAltars = useAltarStore((s) => s.fetchAltars);
  const loadVaults = useVaultStore((s) => s.loadVaults);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const activeView = useUIStore((s) => s.activeView);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  const isAltarWindowFullscreen = activeView.type === 'altar' && activeView.mode !== 'edit' && altarWindowFullscreen;

  const [leftWidth, setLeftWidth] = useState(() =>
    loadSavedWidth('sidebar-left-width', LEFT_MIN, LEFT_DEFAULT)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    loadSavedWidth('sidebar-right-width', RIGHT_MIN, RIGHT_DEFAULT)
  );

  const leftWidthRef = useRef(leftWidth);
  const rightWidthRef = useRef(rightWidth);
  useEffect(() => { leftWidthRef.current = leftWidth; }, [leftWidth]);
  useEffect(() => { rightWidthRef.current = rightWidth; }, [rightWidth]);

  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    // Load vault metadata first so getDb() knows which DB file to open
    loadVaults().then(() =>
      Promise.all([fetchEntries(), fetchArticles(), fetchTags(), fetchAll(), fetchRoutines(), fetchAltars()])
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
      exportEntry:     t('menu.exportEntry'),
      exportPdf:       t('menu.exportPdf'),
      exportHtml:      t('menu.exportHtml'),
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

  // Enable "Export to Markdown" only while a journal / wiki / operation entry
  // is actually open. "Export as PDF" and "Export as Emerald" are shared
  // between those entry types and an Altar's reading view (not while
  // editing it — matches where the Save Image UI used to live): for an open
  // Altar, PDF exports the rendered altar image instead of entry content.
  // "Export as Image" is altar-only.
  // Sigil operations are excluded — that category has its own dedicated
  // view (OperationSigilView) and export isn't wired up for it yet, so its
  // menu items stay disabled to avoid a broken action being visible.
  useEffect(() => {
    const isSigilOperation =
      activeView.type === 'operations' && !!activeView.id &&
      useOperationStore.getState().operations.find((o) => o.id === activeView.id)?.category_id === 'sigils';
    const isEntryView =
      (activeView.type === 'journal' ||
       activeView.type === 'wiki' ||
       (activeView.type === 'operations' && !isSigilOperation)) &&
      !!activeView.id;
    const altarReading = isAltarReadingView(activeView);
    invoke('set_export_menu_enabled', {
      entryEnabled: isEntryView,
      pdfEnabled: isEntryView || altarReading,
      emeraldEnabled: isEntryView || altarReading,
    }).catch(() => {/* desktop-only, ignore in browser preview */});
    invoke('set_altar_export_menu_enabled', { enabled: altarReading })
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
      setLeftWidth(LEFT_DEFAULT);
      setRightWidth(RIGHT_DEFAULT);
      localStorage.removeItem('sidebar-left-width');
      localStorage.removeItem('sidebar-right-width');
      setAltarWindowFullscreen(false);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [setAltarWindowFullscreen]);

  useEffect(() => {
    // Journal / wiki / operations entries always go through the export modal
    // (format choice, bundling linked entries); the per-format menu items just
    // preselect their format. Altars keep their direct exports.
    const openEntryExport = (format?: ExportFormat) => {
      const target = activeExportTarget();
      if (!target) { noEntryMessage(); return; }
      useExportStore.getState().openExport(target, format);
    };

    const unlistenEntry = listen('export-entry', () => openEntryExport());

    const unlistenPdf = listen('export-pdf', () => {
      if (isAltarReadingView(useUIStore.getState().activeView)) {
        saveAltarPDF().catch(err => exportErrorMessage(err, 'export'));
        return;
      }
      openEntryExport('pdf');
    });

    const unlistenHtml = listen('export-html', () => openEntryExport('html'));

    const unlistenMd = listen('export-markdown', () => openEntryExport('markdown'));

    const unlistenEmerald = listen('export-emerald', () => {
      if (isAltarReadingView(useUIStore.getState().activeView)) {
        exportAsEmerald().catch(err => exportErrorMessage(err, 'export'));
        return;
      }
      openEntryExport('emerald');
    });

    const unlistenAltarJpeg = listen('export-altar-jpeg', () => {
      saveAltarImage('jpeg').catch(err => exportErrorMessage(err, 'export'));
    });

    const unlistenAltarPng = listen('export-altar-png', () => {
      saveAltarImage('png').catch(err => exportErrorMessage(err, 'export'));
    });

    const unlistenAltarWebp = listen('export-altar-webp', () => {
      saveAltarImage('webp').catch(err => exportErrorMessage(err, 'export'));
    });

    const unlistenImportEmerald = listen('import-emerald', () => {
      importFromEmerald().catch(err => exportErrorMessage(err, 'import'));
    });

    const unlistenImportMd = listen('import-markdown', () => {
      importFromMarkdown().catch(err => exportErrorMessage(err, 'import'));
    });

    return () => {
      unlistenEntry.then(fn => fn());
      unlistenPdf.then(fn => fn());
      unlistenHtml.then(fn => fn());
      unlistenMd.then(fn => fn());
      unlistenEmerald.then(fn => fn());
      unlistenAltarJpeg.then(fn => fn());
      unlistenAltarPng.then(fn => fn());
      unlistenAltarWebp.then(fn => fn());
      unlistenImportEmerald.then(fn => fn());
      unlistenImportMd.then(fn => fn());
    };
  }, []);

  const onLeftPointerDown = (e: React.PointerEvent) => {
    draggingLeft.current = true;
    startX.current = e.clientX;
    startWidth.current = leftWidth;
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
      setLeftWidth(Math.max(LEFT_MIN, startWidth.current + delta));
    }
    if (draggingRight.current) {
      const delta = startX.current - e.clientX;
      setRightWidth(Math.max(RIGHT_MIN, startWidth.current + delta));
    }
  };

  const onPointerUp = () => {
    if (draggingLeft.current) {
      localStorage.setItem('sidebar-left-width', String(leftWidthRef.current));
    }
    if (draggingRight.current) {
      localStorage.setItem('sidebar-right-width', String(rightWidthRef.current));
    }
    draggingLeft.current = false;
    draggingRight.current = false;
  };

  return (
    <div
      className="app-shell flex h-screen w-screen overflow-hidden bg-stone-900 relative"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Jade accent — magical topline */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none z-50"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,166,102,0.45) 30%, rgba(0,230,153,0.3) 50%, rgba(0,166,102,0.45) 70%, transparent)' }}
      />

      {!isAltarWindowFullscreen && (
        <aside
          className="app-sidebar app-sidebar-left flex-shrink-0 border-r border-stone-700/60 relative"
          style={{ width: leftWidth }}
        >
          <LeftSidebar />
          <div
            onPointerDown={onLeftPointerDown}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-jade-500/20 transition-colors"
          />
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
      <UndoToast />
      <ImportDestinationModal />
      <ExportModal />
    </div>
  );
}
