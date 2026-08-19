import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, useUIStore } from '../../../store/uiStore';
import { usesCustomWindowControls, usesHtmlMenuBar } from '../../../lib/platform';
import RailButton from '../../ui/RailButton';
import TitleBarMenuBar from './TitleBarMenuBar';
import TitleBarSearchButton from './TitleBarSearchButton';
import WindowControls from './WindowControls';

/**
 * The window's title bar.
 *
 * Windows and Linux run undecorated (`decorations: false`) and get their
 * minimise / maximise / close buttons plus the application menu here. macOS
 * keeps its native traffic lights (`titleBarStyle: "Overlay"`) and its native
 * menu bar at the screen edge, so it renders neither — it only reserves room
 * on the left for the lights, via `html[data-platform='macos']` in index.css.
 *
 * `data-tauri-drag-region` is not inherited: Tauri reads the attribute off the
 * element directly under the cursor. Every non-interactive wrapper that should
 * drag the window therefore carries it, and no interactive control does.
 */
export default function TitleBar() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  const history = useUIStore((s) => s.history);
  const historyIndex = useUIStore((s) => s.historyIndex);

  // The altar's distraction-free mode hides the sidebars and the tab bar. The
  // title bar stays — on Windows and Linux it holds the only way to close,
  // minimise or move the window — but drops the navigation and the search.
  const minimal = useUIStore(isAltarFullscreen);

  return (
    <header
      data-tauri-drag-region
      className="titlebar relative flex-shrink-0 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-10 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-1 h-full min-w-0 pl-2">
        <button
          type="button"
          onClick={() => setActiveView({ type: 'home' })}
          title={t('app.name')}
          className="flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          <img src="/emerald-icon.png" alt="Emerald" className="w-5 h-5 rounded-md object-cover" />
        </button>

        {/* Not gated on `minimal`: on Windows and Linux this is the only
            route to the altar's image export, and distraction-free mode is
            precisely where that export is wanted. */}
        {usesHtmlMenuBar && <TitleBarMenuBar />}

        {!minimal && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <RailButton onClick={navigateBack} disabled={historyIndex <= 0} title={t('titlebar.back')}>
              <ArrowLeft size={14} />
            </RailButton>
            <RailButton
              onClick={navigateForward}
              disabled={historyIndex >= history.length - 1}
              title={t('titlebar.forward')}
            >
              <ArrowRight size={14} />
            </RailButton>
          </div>
        )}
      </div>

      {/* The three-column grid keeps this centred on the window rather than on
          the space left over, so the search never shifts as the menu changes
          width between languages. The wrapper always stays a grid item — a
          `hidden` grid child is removed from the grid entirely, which would
          shift the window controls into the middle track. */}
      <div data-tauri-drag-region className="flex justify-center px-4 min-w-0">
        {!minimal && <TitleBarSearchButton />}
      </div>

      <div data-tauri-drag-region className="flex items-center justify-end h-full min-w-0">
        {usesCustomWindowControls && <WindowControls />}
      </div>
    </header>
  );
}
