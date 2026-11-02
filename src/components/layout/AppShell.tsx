import { memo, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, useUIStore } from '../../store/uiStore';
import { reloadAllStores } from '../../store/moduleWiring';
import { activeVault, hasActiveVault, useVaultStore } from '../../store/vaultStore';
import { useSettingsStore } from '../../store/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import { runMenuAction, NATIVE_MENU_EVENTS } from '../../lib/menuActions';
import { hideSplash } from '../../lib/splash';
import TitleBar from './titlebar/TitleBar';
import LeftSidebarRailBase, { RAIL_WIDTH } from './LeftSidebarRail';
import LeftSidebarEntryListBase from './LeftSidebarEntryList';
import RightSidebarBase from './RightSidebar';
import MainAreaBase from './MainArea';
import AppBottomBar from './AppBottomBar';
import VaultModal from './VaultModal';
import VaultKeyDialog from './VaultKeyDialog';
import BackupUnlockDialog from './BackupUnlockDialog';
import { ensureVaultReady, VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { keyErrorOf } from '../../lib/vaultKeys';
import UndoToast from '../ui/UndoToast';
import ImageNoticeModal from '../ui/ImageNoticeModal';
import LeaveGuardModal from './LeaveGuardModal';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../../lib/platform';
import { useMouseNavigation } from '../../hooks/useMouseNavigation';
import { hasOpenEdits, settleBeforeExit } from '../../lib/openEdits';
import { restoreDrafts } from '../../store/draftStore';
import { loadVaultPrefs } from '../../store/vaultPrefs';
import { startAutoBackup } from '../../lib/autoBackup';
import ImportDestinationModal from '../ui/ImportDestinationModal';

// No props, everything through their own store subscriptions: `memo` keeps them
// out of the shell's re-renders — otherwise dragging a sidebar would push every
// mouse move through the list, the sheet with its editors and the right sidebar.
const LeftSidebarRail = memo(LeftSidebarRailBase);
const LeftSidebarEntryList = memo(LeftSidebarEntryListBase);
const RightSidebar = memo(RightSidebarBase);
const MainArea = memo(MainAreaBase);

const ENTRY_LIST_MIN = 180;
/** Together with the rail (44), wider than the title bar's tool group on
 *  Windows/Linux — logo at rail width + menu + three navigation and two
 *  export/import buttons with their gaps, about 238px — so the tabs there
 *  start flush above the sheet. */
const ENTRY_LIST_DEFAULT = 226;
const RIGHT_MIN = 180;
/** As wide as the left side as a whole — rail plus entry list. */
const RIGHT_DEFAULT = RAIL_WIDTH + ENTRY_LIST_DEFAULT;

/* The width transition of the sidebars. A class in `index.css`, not a
   `style={{ transition: … }}` built from SIDEBAR_ANIM_MS: an inline style
   beats every rule in the stylesheet, including the `prefers-reduced-motion`
   opt-out. SIDEBAR_ANIM_MS therefore has to match the duration there by hand —
   it only controls how long the content stays mounted. */
const SIDEBAR_ANIM_CLASS = 'app-sidebar-animated';
const SIDEBAR_ANIM_MS = 200;

const ENTRY_LIST_WIDTH_KEY = 'entry-list-width';
const RIGHT_WIDTH_KEY = 'sidebar-right-width';

/** Vault setup has nowhere to close to. `Modal` requires the prop but never
 *  calls it while `dismissible={false}` — there is no X, no Escape, no backdrop. */
const NEVER_CLOSE = () => {};

/**
 * Keeps a sidebar's content mounted through the fade-out animation and only
 * unmounts it afterwards. Leaving it mounted permanently would be simpler but
 * costs: `AllList` calls all five config hooks of the modules,
 * `AltarSidebarPanel` brings its own effects and drag listeners — neither
 * should keep running while invisible. A timeout instead of `transitionend`, so
 * it is also unmounted when the transition (reduced motion) never runs.
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
  const loadVaults = useVaultStore((s) => s.loadVaults);
  const vaultsLoaded = useVaultStore((s) => s.loaded);
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const vaultLocked = useVaultStore((s) => s.locked);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const railOpen = useUIStore((s) => s.railOpen);
  const viewLocked = useUIStore((s) => s.viewLocked);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const isAltarWindowFullscreen = useUIStore(isAltarFullscreen);

  const [entryListWidth, setEntryListWidth] = useState(() =>
    loadSavedWidth(ENTRY_LIST_WIDTH_KEY, ENTRY_LIST_MIN, ENTRY_LIST_DEFAULT)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    loadSavedWidth(RIGHT_WIDTH_KEY, RIGHT_MIN, RIGHT_DEFAULT)
  );
  // State, not a ref: turning the transition off has to re-render.
  const [resizing, setResizing] = useState(false);
  // The first start is only done once the vault's settings are loaded too
  // (or that failed): until then nothing may call `getDb()` — the cleanup
  // routine there needs the trash retention period, the migrations the
  // language. Without this gate, a restored trash tab, say, would open the
  // database with nobody's settings.
  const [bootSettled, setBootSettled] = useState(false);

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
      // First start: there is no database yet to load anything from. The first
      // vault is activated through `switchVault`, which ends in
      // `reloadAllStores()` — this effect does not run again for that.
      const vaultState = useVaultStore.getState();
      const active = activeVault(vaultState);
      if (!active) return;
      // Before anything else: an encrypted vault has to be unlocked before
      // drafts or the database are read. Whoever cancels picks another one in
      // the vault window — the saved active vault stays until it is switched
      // there.
      return ensureVaultReady(active).then(() => {
        // As in `openActiveVault`: the settings before the database. Before
        // that, whatever drafts a crash left behind — before a page looks for
        // them — and how this vault's lists should look.
        loadVaultPrefs(vaultState.activeVaultId);
        return restoreDrafts(vaultState.activeVaultId)
          .then(() => useSettingsStore.getState().loadForVault(vaultState.activeVaultId))
          .then(reloadAllStores);
      }, (err: unknown) => {
        if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) throw err;
        useVaultStore.setState({ activeVaultId: '' });
      });
    })
      // Without a `catch` the error would stay an unhandled rejection in the
      // console — visible only if someone looks.
      .catch((err) => console.error('[boot] initial load failed', err))
      .finally(() => setBootSettled(true))
      // From here on there is either the loaded content or — on first start —
      // the vault setup. Both are a finished screen, so the loading screen can
      // go. Also on failure: an empty interface is still better than a loading
      // screen that never ends.
      .finally(hideSplash);
  }, []);

  // Window closing: first settle what happens to edits in progress. The
  // handler is awaited before the window goes — "Keep editing" keeps it
  // open.
  useEffect(() => {
    if (!isTauri) return;
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      // First, and without waiting for it: otherwise Rust closes the window
      // itself on the next attempt (`CloseWatch` in `lib.rs`).
      void invoke('close_request_seen').catch(() => {});
      try {
        if (hasOpenEdits()) {
          // Nobody would see the question in a minimized window — closing
          // would look ignored.
          if (await appWindow.isMinimized()) {
            await appWindow.unminimize();
            // Linux (X11): tao drops `setFocus` while it still considers the
            // window minimized — and it only learns otherwise when GTK reports
            // the new state back. Wait at most one second for that.
            for (let i = 0; i < 20 && (await appWindow.isMinimized()); i++) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          }
          await appWindow.setFocus();
        }
        if (!(await settleBeforeExit())) event.preventDefault();
      } catch (e) {
        // An error here must not keep the window open: Tauri only closes once
        // this handler returns without preventing it.
        console.error('[close] leave guard failed', e);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  // The automatic backup checks for the duration of the session whether one is due.
  useEffect(() => (isTauri ? startAutoBackup() : undefined), []);

  // Sync menu bar labels with the current language
  useEffect(() => {
    invoke('update_menu_labels', {
      edit:            t('menu.edit'),
      view:            t('menu.view'),
      resetView:       t('menu.resetView'),
      lockView:        t('menu.lockView'),
      showSplash:      t('menu.showSplash'),
      rail:            t('menu.rail'),
      entryList:       t('menu.entryList'),
      properties:      t('menu.properties'),
      quit:            t('menu.quit'),
    }).catch(() => {/* desktop-only, ignore in browser preview */});
  }, [i18n.language, t]);

  // Same idea for the View menu's check items — this state also changes
  // without the menu ever being opened (`setActiveView` opens the right
  // sidebar for edit mode).
  useEffect(() => {
    invoke('set_view_menu_checked', { rail: railOpen, leftList: leftListOpen, rightSidebar: rightSidebarOpen, viewLocked })
      .catch(() => {/* desktop-only, ignore in browser preview */});
  }, [railOpen, leftListOpen, rightSidebarOpen, viewLocked]);

  useMouseNavigation();

  useEffect(() => {
    const unlisten = listen('reset-sidebar-widths', () => {
      setEntryListWidth(ENTRY_LIST_DEFAULT);
      setRightWidth(RIGHT_DEFAULT);
      localStorage.removeItem(ENTRY_LIST_WIDTH_KEY);
      localStorage.removeItem(RIGHT_WIDTH_KEY);
      setAltarWindowFullscreen(false);
      // Also the way back to hidden bars — with the rail gone, settings and
      // the vault button would otherwise stay away until the View menu is found.
      useUIStore.getState().showAllPanels();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [setAltarWindowFullscreen]);

  // The native macOS menu emits these; the title bar's menus call
  // `runMenuAction` directly. Both go through the same implementation.
  useEffect(() => {
    const unlisteners = NATIVE_MENU_EVENTS.map((id) =>
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

  // The lock removes the drag handle — a drag in progress ends with it,
  // otherwise it would carry on without a handle until released somewhere.
  useEffect(() => {
    if (viewLocked) onPointerUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLocked]);

  // Window frame and title bar — everything that stands even without an open vault.
  const chrome = (children: React.ReactNode) => (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden relative">
      <TitleBar />
      {children}
      <VaultKeyDialog />
    </div>
  );

  // While no vault is open, the shell content stays unmounted: every
  // `getDb()` from the sidebar, tab bar or main area would run into the
  // NO_ACTIVE_VAULT error from `getActiveVaultPath()`.
  //
  // Three separate exits so the reason stays visible: while `loaded` is still
  // false, it is merely not yet known whether a vault exists — the setup modal
  // must not flash up then. And with a vault but before the end of the start,
  // its settings are still missing (see `bootSettled`).
  if (!vaultsLoaded) return chrome(<main className="app-main flex-1 min-h-0" />);
  if (needsVault) {
    return chrome(
      <>
        <main className="app-main flex-1 min-h-0" />
        <VaultModal dismissible={false} onClose={NEVER_CLOSE} />
      </>
    );
  }
  if (!bootSettled) return chrome(<main className="app-main flex-1 min-h-0" />);
  // Locked: none of the content stays standing behind the password prompt.
  if (vaultLocked) return chrome(<main className="app-main flex-1 min-h-0" />);

  const leftSidebarWidth = (railOpen ? RAIL_WIDTH : 0) + (leftListOpen ? entryListWidth : 0);
  // With nothing to its left, the sheet keeps its distance from the window
  // edge there too — it always floats, instead of sticking to the edge with a
  // rounded-md corner.
  const leftFrameEmpty = isAltarWindowFullscreen || leftSidebarWidth === 0;
  // Tied to the deferred unmount instead of `rightSidebarOpen`: when
  // collapsing, the main area only gets its right edge once the bar is gone,
  // instead of drawing a double line next to it.
  const sheetJoined = rightSidebarMounted && !isAltarWindowFullscreen;

  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden relative">
      {/* The tabs sit in the title bar, above the sheet. */}
      <TitleBar tabs leadWidth={leftSidebarWidth} animate={!resizing} />

      {/* The sidebar resize handles live in here, so the pointer handlers that
          drive them do too. */}
      {/* Both bars animate their width and clip their content instead of
          letting it shrink along: the inner container keeps its pixel width,
          the <aside> cuts it off. Otherwise the content squeezes together
          during the animation — and the entry list's tab bar would wrap in the
          middle of the transition. During a resize drag no transition runs.
          While the closed content is still mounted, `inert` and `aria-hidden`
          together keep it out of both focus *and* screen-reader order; `inert`
          alone would have no effect on older WebKit versions. */}
      <div
        className={`app-sheet-frame flex flex-1 min-h-0 overflow-hidden relative${
          leftFrameEmpty ? ' app-sheet-frame-free-left' : ''
        }${isAltarWindowFullscreen ? '' : ' app-sheet-frame-with-bar'}${resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!isAltarWindowFullscreen && (
          <aside
            // A frame, not a divider: rail and list merge seamlessly into the
            // title bar, only the sheet next to them is set apart.
            className={`app-sidebar app-sidebar-left flex-shrink-0 relative overflow-hidden${
              railOpen ? ' app-sidebar-left-with-rail' : ''
            }${resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`}`}
            style={{ width: leftSidebarWidth }}
          >
            {/* A hidden rail is pushed out of view to the left by the negative
                margin, so the list moves into its place. */}
            <div
              className={`flex h-full${resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`}`}
              style={{ width: RAIL_WIDTH + entryListWidth, marginLeft: railOpen ? 0 : -RAIL_WIDTH }}
            >
              <div className="flex-shrink-0 h-full flex" inert={!railOpen} aria-hidden={!railOpen}>
                <LeftSidebarRail />
              </div>
              <div
                className="flex-shrink-0 h-full flex"
                style={{ width: entryListWidth }}
                inert={!leftListOpen}
                aria-hidden={!leftListOpen}
              >
                {leftListMounted && <LeftSidebarEntryList />}
              </div>
            </div>
            {leftListOpen && !viewLocked && (
              <div
                onPointerDown={onLeftPointerDown}
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-accent-wash-strong transition-colors"
              />
            )}
          </aside>
        )}

        {/* Main Content */}
        {/* The sheet, left half. With the right bar next to it, it is straight
            and borderless on the right — the bar draws the edge between them. */}
        <main
          className={`app-main app-sheet-main flex-1 min-w-0 overflow-hidden flex flex-col${
            sheetJoined ? ' app-sheet-main-joined' : ''
          }`}
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <MainArea />
          </div>
        </main>

        {/* Right Sidebar — content anchored to the right edge, so it slides in
            from there when opening instead of unfolding from the left. */}
        {!isAltarWindowFullscreen && (
          <aside
            className={`app-sidebar app-sidebar-right flex-shrink-0 relative overflow-hidden${
              resizing ? '' : ` ${SIDEBAR_ANIM_CLASS}`
            }`}
            style={{ width: rightSidebarOpen ? rightWidth : 0 }}
          >
            {/* Resize handle — with the bar closed it would otherwise sit as a
                strip at the edge of the main area. With "Lock view" it does
                not exist on either side. */}
            {rightSidebarOpen && !viewLocked && (
              <div
                onPointerDown={onRightPointerDown}
                className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-accent-wash-strong transition-colors"
              />
            )}
            {/* The sheet, right half. Surface, border and radius sit on the
                content, not on the <aside>: there the borders would remain as
                a 2px line at width 0. This way they move out with the content
                and are clipped along with it. */}
            <div
              className="app-sheet-side absolute top-0 right-0 h-full"
              style={{ width: rightWidth }}
              inert={!rightSidebarOpen}
              aria-hidden={!rightSidebarOpen}
            >
              {rightSidebarMounted && <RightSidebar />}
            </div>
          </aside>
        )}
      </div>

      {!isAltarWindowFullscreen && (
        <AppBottomBar
          className={resizing ? '' : SIDEBAR_ANIM_CLASS}
          paddingRight={`calc(var(--sheet-inset) + ${rightSidebarOpen ? rightWidth : 0}px + 8px)`}
        />
      )}

      <UndoToast />
      <ImageNoticeModal />
      <LeaveGuardModal />
      <ImportDestinationModal />
      <VaultKeyDialog />
      <BackupUnlockDialog />
    </div>
  );
}
