import { useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Menu, Search, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, selectActiveHistory, useUIStore } from '../../../store/uiStore';
import { hasActiveVault, useVaultStore } from '../../../store/vaultStore';
import { isMacOS, usesCustomWindowControls } from '../../../lib/platform';
import EmeraldMark from '../../ui/EmeraldMark';
import { RAIL_WIDTH } from '../LeftSidebarRail';
import TabBar from '../TabBar';
import RailButton from '../../ui/RailButton';
import TitleBarMenuButton from './TitleBarMenuButton';
import { useTitleBarMenus } from './useTitleBarMenus';
import SearchModal from './SearchModal';
import WindowControls from './WindowControls';

interface Props {
  tabs?: boolean;
  /** Width of the left sidebar. */
  leadWidth?: number;
  /** Off while a sidebar is being dragged to a new width. */
  animate?: boolean;
}

/**
 * The window's title bar.
 *
 * Windows and Linux run undecorated (`decorations: false`) and get their
 * minimise / maximise / close buttons here. macOS keeps its native traffic
 * lights (`titleBarStyle: "Overlay"`) and reserves room on the left for them
 * instead of the logo, via `html[data-platform='macos']` in index.css. Edit
 * and View live in its native menu bar; Export and Import are here everywhere.
 *
 * `data-tauri-drag-region` is not inherited: Tauri reads the attribute off the
 * element directly under the cursor. Every non-interactive wrapper that should
 * drag the window therefore carries it, and no interactive control does.
 *
 * With `tabs` set, the bar also holds the tab strip. The leading group then
 * grows to `leadWidth` — the left sidebar's width — so the tabs begin flush
 * with the sheet's left edge below and may run up to the window buttons, minus
 * a strip kept free for dragging the window.
 * Without `tabs` (no vault yet, boot still running) the shell content is
 * unmounted and there are no tabs to show.
 */
export default function TitleBar({ tabs = false, leadWidth = 0, animate = true }: Props) {
  const { t } = useTranslation();
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  // The history of the active tab — every tab keeps its own.
  const canGoBack = useUIStore((s) => selectActiveHistory(s).index > 0);
  const canGoForward = useUIStore((s) => {
    const history = selectActiveHistory(s);
    return history.index < history.views.length - 1;
  });

  // The altar's distraction-free mode hides the sidebars and the tab bar. The
  // title bar stays — on Windows and Linux it holds the only way to close,
  // minimise or move the window — but drops the navigation and the search.
  const minimal = useUIStore(isAltarFullscreen);

  // Without an open vault there is nothing to search — and more than that: the
  // stores keep their contents when the last vault is deleted
  // (`vaultStore.removeVault`, branch without a successor). Sidebar and main
  // area are then unmounted, the title bar stays. A search here
  // would be the only place where a user could still read the vault just
  // deleted — even after ticking "Delete files".
  const vaultOpen = useVaultStore(hasActiveVault);
  const [searchOpen, setSearchOpen] = useState(false);
  // When the magnifier goes away — altar fullscreen, last vault closed — the
  // search goes with it, instead of popping open again by itself on return.
  if (searchOpen && (minimal || !vaultOpen)) setSearchOpen(false);
  const menus = useTitleBarMenus();
  const showTabs = tabs && !minimal;

  return (
    <header
      data-tauri-drag-region
      className="titlebar relative flex-shrink-0 flex items-center h-10 select-none"
    >
      {/* With tabs at least as wide as the left sidebar (border-box,
          so including padding) and animated along with it — the tabs thus start
          at the left edge of the sheet. If the bar is narrower than the buttons
          (rail or list hidden), they simply start behind them. */}
      <div
        data-tauri-drag-region
        className={`flex items-center h-full flex-shrink-0${
          showTabs && animate ? ' titlebar-follow-animated' : ''
        }`}
        style={showTabs ? { minWidth: leadWidth } : undefined}
      >
        {/* A pure logo, not a control: the way to the dashboard now sits in the
            rail, and `data-tauri-drag-region` gives the window corner back to
            dragging instead of binding it to a click.

            The attribute sits on the wrapper and not on the <svg>: Tauri reads it
            on the element under the pointer, and depending on the spot that would
            be a <polygon> inside it. `pointer-events-none` on the mark reliably
            pushes the pointer check back to the wrapper — and incidentally takes
            care of what the earlier <img> needed `draggable={false}` for:
            as a drag source it started a native image drag on macOS on the
            second press of a double click, instead of maximizing the window.
            An inline SVG is not one.

            As wide as the rail and centred in it: the logo lines up
            with the icons below it. The menu button follows with `mr-1.5`,
            its icon then sits above those of the entry list (whose 4px
            margin next to the rail is in index.css) — that is why the wrapper
            carries no `gap`, only the groups after it `ml-1`. */}
        {!isMacOS && (
          <div
            data-tauri-drag-region
            title="Emerald App"
            className="flex-shrink-0 flex items-center justify-center mr-1.5"
            style={{ width: RAIL_WIDTH }}
          >
            <EmeraldMark size={20} className="pointer-events-none" />
          </div>
        )}

        {!isMacOS && (
          <TitleBarMenuButton
            label={t('titlebar.menu')}
            icon={<Menu size={16} />}
            nodes={menus.appMenu}
          />
        )}

        {!minimal && (
          <div className="ml-1 flex items-center gap-0.5 flex-shrink-0">
            {vaultOpen && (
              <RailButton onClick={() => setSearchOpen(true)} title={t('titlebar.search')}>
                <Search size={16} />
              </RailButton>
            )}
            <RailButton onClick={navigateBack} disabled={!canGoBack} title={t('titlebar.back')}>
              <ArrowLeft size={16} />
            </RailButton>
            <RailButton
              onClick={navigateForward}
              disabled={!canGoForward}
              title={t('titlebar.forward')}
            >
              <ArrowRight size={16} />
            </RailButton>
          </div>
        )}

        {/* Not gated on `minimal`: this is the only
            route to the altar's image export, and distraction-free mode is
            precisely where that export is wanted. Export carries Download,
            Import Upload — as in Settings → Backup. */}
        <div className="ml-1 flex items-center gap-0.5 flex-shrink-0">
          <TitleBarMenuButton label={menus.exportMenu.label} icon={<Download size={16} />} nodes={menus.exportMenu.nodes} />
          <TitleBarMenuButton label={menus.importMenu.label} icon={<Upload size={16} />} nodes={menus.importMenu.nodes} />
        </div>
      </div>

      {/* Without tabs: empty space that stays free as a drag area. */}
      {showTabs ? (
        <TabBar />
      ) : (
        <div data-tauri-drag-region className="flex-1 min-w-0 h-full" />
      )}

      {/* `ml-auto` keeps the window controls at the right edge even when
          the tab bar renders nothing for lack of tabs. */}
      <div data-tauri-drag-region className="ml-auto flex items-center justify-end h-full flex-shrink-0">
        {usesCustomWindowControls && <WindowControls />}
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
