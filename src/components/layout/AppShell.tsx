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
import { hasActiveVault, useVaultStore } from '../../store/vaultStore';
import { invoke } from '@tauri-apps/api/core';
import { computeMenuEnabledState, runMenuAction, SELF_CONTAINED_MENU_ACTIONS } from '../../lib/menuActions';
import TitleBar from './titlebar/TitleBar';
import LeftSidebarRail, { RAIL_WIDTH } from './LeftSidebarRail';
import LeftSidebarEntryList, { ENTRY_LIST_TABS_WIDTH } from './LeftSidebarEntryList';
import RightSidebar from './RightSidebar';
import MainArea from './MainArea';
import TabBar from './TabBar';
import VaultModal from './VaultModal';
import UndoToast from '../ui/UndoToast';
import ImportDestinationModal from '../ui/ImportDestinationModal';

const ENTRY_LIST_MIN = 180;
/** Genau so breit, dass die sechs Tabs der Eintragsliste nebeneinander passen. */
const ENTRY_LIST_DEFAULT = ENTRY_LIST_TABS_WIDTH;
const RIGHT_MIN = 180;
/** So breit wie die linke Seite im Ganzen — Rail plus Eintragsliste. */
const RIGHT_DEFAULT = RAIL_WIDTH + ENTRY_LIST_DEFAULT;

/* Die Breiten-Transition der Seitenleisten. Eine Klasse in `index.css`, kein
   `style={{ transition: … }}` aus SIDEBAR_ANIM_MS heraus: ein Inline-Style
   schlaegt jede Regel im Stylesheet, also auch die `prefers-reduced-motion`-
   Abbestellung. SIDEBAR_ANIM_MS muss deshalb von Hand zur Dauer dort passen —
   es steuert nur, wie lange der Inhalt noch gemountet bleibt. */
const SIDEBAR_ANIM_CLASS = 'app-sidebar-animated';
const SIDEBAR_ANIM_MS = 200;

const ENTRY_LIST_WIDTH_KEY = 'entry-list-width';
const RIGHT_WIDTH_KEY = 'sidebar-right-width';

/** Vault setup has nowhere to close to. `Modal` requires the prop but never
 *  calls it while `dismissible={false}` — there is no X, no Escape, no backdrop. */
const NEVER_CLOSE = () => {};

/**
 * Haelt den Inhalt einer Seitenleiste ueber die Ausblend-Animation hinweg
 * gemountet und raeumt ihn erst danach ab. Dauerhaft gemountet lassen waere
 * einfacher, kostet aber: `AllList` ruft alle fuenf Config-Hooks der Module,
 * `AltarSidebarPanel` bringt eigene Effekte und Drag-Listener mit — beides
 * soll unsichtbar nicht mitlaufen. Timeout statt `transitionend`, damit auch
 * abgeraeumt wird, wenn die Transition (Reduced Motion) gar nicht laeuft.
 */
function useDeferredUnmount(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const tid = setTimeout(() => setMounted(false), SIDEBAR_ANIM_MS);
    return () => clearTimeout(tid);
  }, [open]);
  return mounted;
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
  const fetchAllTasks = useTaskStore((s) => s.fetchAll);
  const fetchRoutines = useRoutineStore((s) => s.fetchRoutines);
  const fetchAltars = useAltarStore((s) => s.fetchAltars);
  const loadVaults = useVaultStore((s) => s.loadVaults);
  const vaultsLoaded = useVaultStore((s) => s.loaded);
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const activeView = useUIStore((s) => s.activeView);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  const isAltarWindowFullscreen = useUIStore(isAltarFullscreen);

  const [entryListWidth, setEntryListWidth] = useState(() =>
    loadSavedWidth(ENTRY_LIST_WIDTH_KEY, ENTRY_LIST_MIN, ENTRY_LIST_DEFAULT)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    loadSavedWidth(RIGHT_WIDTH_KEY, RIGHT_MIN, RIGHT_DEFAULT)
  );
  // State, nicht Ref: das Abschalten der Transition muss neu rendern.
  const [resizing, setResizing] = useState(false);

  const leftListMounted = useDeferredUnmount(leftListOpen);
  const rightSidebarMounted = useDeferredUnmount(rightSidebarOpen);

  const entryListWidthRef = useRef(entryListWidth);
  const rightWidthRef = useRef(rightWidth);
  useEffect(() => { entryListWidthRef.current = entryListWidth; }, [entryListWidth]);
  useEffect(() => { rightWidthRef.current = rightWidth; }, [rightWidth]);

  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const needsVault = !hasActiveVault({ vaults, activeVaultId });

  useEffect(() => {
    // Load vault metadata first so getDb() knows which DB file to open
    loadVaults().then(() => {
      // Erststart: es gibt noch keine Datenbank, aus der sich etwas laden
      // liesse. Der erste Vault wird ueber `switchVault` aktiviert, und das
      // endet in `reloadAllStores()` — dieser Effekt laeuft dafuer nicht erneut.
      if (!hasActiveVault(useVaultStore.getState())) return;
      return Promise.all([fetchEntries(), fetchArticles(), fetchTags(), fetchAll(), fetchAllTasks(), fetchRoutines(), fetchAltars()]);
    });
  }, []);

  // Sync menu bar labels with the current language
  useEffect(() => {
    invoke('update_menu_labels', {
      edit:            t('menu.edit'),
      view:            t('menu.view'),
      export:          t('menu.export'),
      import:          t('menu.import'),
      resetView:       t('menu.resetView'),
      entryList:       t('menu.entryList'),
      properties:      t('menu.properties'),
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

  // Same idea for the View menu's two check items — the rail's own toggle
  // buttons change this state without the menu ever being opened.
  useEffect(() => {
    invoke('set_view_menu_checked', { leftList: leftListOpen, rightSidebar: rightSidebarOpen })
      .catch(() => {/* desktop-only, ignore in browser preview */});
  }, [leftListOpen, rightSidebarOpen]);

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
      localStorage.removeItem(ENTRY_LIST_WIDTH_KEY);
      localStorage.removeItem(RIGHT_WIDTH_KEY);
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
    setResizing(true);
    startX.current = e.clientX;
    startWidth.current = entryListWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRightPointerDown = (e: React.PointerEvent) => {
    draggingRight.current = true;
    setResizing(true);
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
      localStorage.setItem(ENTRY_LIST_WIDTH_KEY, String(entryListWidthRef.current));
    }
    if (draggingRight.current) {
      localStorage.setItem(RIGHT_WIDTH_KEY, String(rightWidthRef.current));
    }
    draggingLeft.current = false;
    draggingRight.current = false;
    setResizing(false);
  };

  // Fensterrahmen und Titelleiste — alles, was auch ohne offenen Vault steht.
  const chrome = (children: React.ReactNode) => (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden bg-stone-900 relative">
      <TitleBar />
      {children}
    </div>
  );

  // Solange kein Vault offen ist, bleibt der Shell-Inhalt ungemountet: jedes
  // `getDb()` aus Sidebar, Tableiste oder Hauptbereich liefe in den
  // NO_ACTIVE_VAULT-Fehler aus `getActiveVaultPath()`.
  //
  // Zwei getrennte Ausgaenge, damit sichtbar bleibt, warum: waehrend `loaded`
  // noch falsch ist, steht nur noch nicht fest, ob ein Vault da ist — dann darf
  // das Setup-Modal nicht schon aufblitzen.
  if (!vaultsLoaded) return chrome(<main className="app-main flex-1 min-h-0" />);
  if (needsVault) {
    return chrome(
      <>
        <main className="app-main flex-1 min-h-0" />
        <VaultModal dismissible={false} onClose={NEVER_CLOSE} />
      </>
    );
  }

  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden bg-stone-900 relative">
      <TitleBar />

      {/* The sidebar resize handles live in here, so the pointer handlers that
          drive them do too. */}
      {/* Beide Leisten animieren ihre Breite und klippen ihren Inhalt, statt ihn
          mitschrumpfen zu lassen: der innere Container behaelt seine
          Pixelbreite, das <aside> schneidet sie ab. Sonst quetscht sich der
          Inhalt waehrend der Animation zusammen — und die Tab-Leiste der
          Eintragsliste braeche mitten im Uebergang um. Waehrend eines
          Resize-Drags laeuft keine Transition. Solange der geschlossene Inhalt
          noch gemountet ist, halten `inert` und `aria-hidden` ihn zusammen aus
          Fokus *und* Vorlesereihenfolge heraus; `inert` allein waere auf
          aelteren WebKit-Versionen wirkungslos. */}
      <div
        className="flex flex-1 min-h-0 overflow-hidden relative"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!isAltarWindowFullscreen && (
          <aside
            // Die Trennlinie darf hier am <aside> bleiben: die Rail klappt nie
            // weg, die linke Leiste wird also nie schmaler als 56px.
            className={`app-sidebar app-sidebar-left flex-shrink-0 border-r border-stone-700/60 relative overflow-hidden${
              resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`
            }`}
            style={{ width: RAIL_WIDTH + (leftListOpen ? entryListWidth : 0) }}
          >
            <div className="flex h-full" style={{ width: RAIL_WIDTH + entryListWidth }}>
              <LeftSidebarRail />
              <div
                className="flex-shrink-0 h-full flex"
                style={{ width: entryListWidth }}
                inert={!leftListOpen}
                aria-hidden={!leftListOpen}
              >
                {leftListMounted && <LeftSidebarEntryList />}
              </div>
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

        {/* Right Sidebar — Inhalt am rechten Rand verankert, damit er sich beim
            Aufklappen von dort hereinschiebt statt links aufzuklappen. */}
        {!isAltarWindowFullscreen && (
          <aside
            className={`app-sidebar app-sidebar-right flex-shrink-0 relative overflow-hidden${
              resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`
            }`}
            style={{ width: rightSidebarOpen ? rightWidth : 0 }}
          >
            {/* Resize handle — bei geschlossener Leiste saesse er sonst als
                Streifen am Rand des Hauptbereichs. */}
            {rightSidebarOpen && (
              <div
                onPointerDown={onRightPointerDown}
                className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-jade-500/20 transition-colors"
              />
            )}
            {/* Die Trennlinie sitzt am Inhalt, nicht am <aside>: dort waere sie
                bei Breite 0 als 1px-Strich am Fensterrand stehengeblieben. So
                faehrt sie mit dem Inhalt hinaus und wird mit ihm geklippt. */}
            <div
              className="absolute top-0 right-0 h-full border-l border-stone-700/60"
              style={{ width: rightWidth }}
              inert={!rightSidebarOpen}
              aria-hidden={!rightSidebarOpen}
            >
              {rightSidebarMounted && <RightSidebar />}
            </div>
          </aside>
        )}
      </div>

      <UndoToast />
      <ImportDestinationModal />
    </div>
  );
}
