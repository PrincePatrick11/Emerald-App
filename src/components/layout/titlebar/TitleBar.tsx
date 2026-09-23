import { useState } from 'react';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, selectActiveHistory, useUIStore } from '../../../store/uiStore';
import { hasActiveVault, useVaultStore } from '../../../store/vaultStore';
import { usesCustomWindowControls, usesHtmlMenuBar } from '../../../lib/platform';
import EmeraldMark from '../../ui/EmeraldMark';
import RailButton from '../../ui/RailButton';
import TitleBarMenuBar from './TitleBarMenuBar';
import SearchModal from './SearchModal';
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
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  // Der Verlauf des aktiven Tabs — jeder Tab führt seinen eigenen.
  const canGoBack = useUIStore((s) => selectActiveHistory(s).index > 0);
  const canGoForward = useUIStore((s) => {
    const history = selectActiveHistory(s);
    return history.index < history.views.length - 1;
  });

  // The altar's distraction-free mode hides the sidebars and the tab bar. The
  // title bar stays — on Windows and Linux it holds the only way to close,
  // minimise or move the window — but drops the navigation and the search.
  const minimal = useUIStore(isAltarFullscreen);

  // Ohne offenen Vault gibt es nichts zu durchsuchen — und mehr als das: die
  // Stores behalten ihre Inhalte, wenn der letzte Vault geloescht wird
  // (`vaultStore.removeVault`, Zweig ohne Nachfolger). Sidebar und Hauptbereich
  // sind dann ungemountet, die Titelleiste bleibt stehen. Eine Suche hier
  // waere die einzige Stelle, an der ein Nutzer den eben geloeschten Vault noch
  // lesen koennte — auch nachdem er "Dateien loeschen" angehakt hat.
  const vaultOpen = useVaultStore(hasActiveVault);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header
      data-tauri-drag-region
      className="titlebar relative flex-shrink-0 flex items-center h-10 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-1 h-full flex-shrink-0 pl-2">
        {/* Reines Logo, kein Control: der Weg zum Dashboard sitzt jetzt in der
            Rail, und `data-tauri-drag-region` gibt die Fensterecke ans Ziehen
            zurueck, statt sie an einen Klick zu binden.

            Das Attribut sitzt am Wrapper und nicht am <svg>: Tauri liest es
            am Element unter dem Zeiger, und das waere je nach Stelle ein
            <polygon> darin. `pointer-events-none` an der Marke schiebt die
            Zeigerpruefung zuverlaessig auf den Wrapper zurueck — und erledigt
            nebenbei, wofuer das fruehere <img> hier `draggable={false}`
            brauchte: als Drag-Quelle startete es auf macOS beim zweiten Druck
            eines Doppelklicks ein natives Bild-Drag, statt das Fenster zu
            maximieren. Ein Inline-SVG ist keine. */}
        <div
          data-tauri-drag-region
          title="Emerald App"
          className="flex-shrink-0 flex items-center"
        >
          <EmeraldMark size={20} className="pointer-events-none" />
        </div>

        {/* Not gated on `minimal`: on Windows and Linux this is the only
            route to the altar's image export, and distraction-free mode is
            precisely where that export is wanted. */}
        {usesHtmlMenuBar && <TitleBarMenuBar />}

        {!minimal && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <RailButton onClick={navigateBack} disabled={!canGoBack} title={t('titlebar.back')}>
              <ArrowLeft size={14} />
            </RailButton>
            <RailButton
              onClick={navigateForward}
              disabled={!canGoForward}
              title={t('titlebar.forward')}
            >
              <ArrowRight size={14} />
            </RailButton>
            {vaultOpen && (
              <RailButton onClick={() => setSearchOpen(true)} title={t('titlebar.search')}>
                <Search size={14} />
              </RailButton>
            )}
          </div>
        )}
      </div>

      {/* Leerer Zwischenraum: haelt die Fenstersteuerung am rechten Rand und
          bleibt als Ziehflaeche fuer das Fenster frei. */}
      <div data-tauri-drag-region className="flex-1 min-w-0 h-full" />

      <div data-tauri-drag-region className="flex items-center justify-end h-full flex-shrink-0">
        {usesCustomWindowControls && <WindowControls />}
      </div>

      {searchOpen && !minimal && vaultOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
