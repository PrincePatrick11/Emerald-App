import { useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Menu, Search, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, selectActiveHistory, useUIStore } from '../../../store/uiStore';
import { hasActiveVault, useVaultStore } from '../../../store/vaultStore';
import { usesCustomWindowControls, usesHtmlMenuBar } from '../../../lib/platform';
import EmeraldMark from '../../ui/EmeraldMark';
import TabBar from '../TabBar';
import RailButton from '../../ui/RailButton';
import TitleBarMenuButton from './TitleBarMenuButton';
import { useTitleBarMenus } from './useTitleBarMenus';
import SearchModal from './SearchModal';
import WindowControls, { WINDOW_CONTROLS_WIDTH } from './WindowControls';

interface Props {
  tabs?: boolean;
  /** Breite der linken Seitenleiste. */
  leadWidth?: number;
  /** Breite der rechten Seitenleiste. */
  trailWidth?: number;
  /** Aus, solange eine Seitenleiste per Drag in der Breite gezogen wird. */
  animate?: boolean;
}

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
 *
 * With `tabs` set, the bar also holds the tab strip. The leading group then
 * grows to `leadWidth` — the left sidebar's width — and ends in a divider on
 * the sidebar's edge, so the tabs begin above the main area; they end at the
 * right sidebar's edge (`trailWidth`), only the "+" may reach past it.
 * Without `tabs` (no vault yet, boot still running) the shell content is
 * unmounted and there are no tabs to show.
 */
export default function TitleBar({ tabs = false, leadWidth = 0, trailWidth = 0, animate = true }: Props) {
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
  // Geht die Lupe weg — Altar-Vollbild, letzter Vault geschlossen —, geht die
  // Suche mit, statt beim Zurückkehren von selbst wieder aufzuspringen.
  if (searchOpen && (minimal || !vaultOpen)) setSearchOpen(false);
  const menus = useTitleBarMenus();
  const showTabs = tabs && !minimal;
  // Wie weit die Tab-Leiste in die rechte Seitenleiste hineinragt: ihr Anteil,
  // der nicht schon unter den Fensterknoepfen liegt. Um so viel enden die Tabs
  // vor dem rechten Rand der Leiste — und damit auf der Kante der Seitenleiste.
  const tabsEndInset = Math.max(0, trailWidth - (usesCustomWindowControls ? WINDOW_CONTROLS_WIDTH : 0));

  return (
    <header
      data-tauri-drag-region
      className="titlebar relative flex-shrink-0 flex items-center h-10 select-none"
    >
      {/* Mit Tabs mindestens so breit wie die linke Seitenleiste (border-box,
          also samt Polsterung) und mit ihr animiert. Ist die Leiste schmaler
          als die Knoepfe, beginnen die Tabs eben dahinter. */}
      <div
        data-tauri-drag-region
        className={`flex items-center gap-1 h-full flex-shrink-0 pl-2${
          showTabs && animate ? ' titlebar-follow-animated' : ''
        }`}
        style={showTabs ? { minWidth: leadWidth } : undefined}
      >
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

        {usesHtmlMenuBar && (
          <TitleBarMenuButton
            label={t('titlebar.menu')}
            icon={<Menu size={14} />}
            nodes={menus.appMenu}
          />
        )}

        {!minimal && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {vaultOpen && (
              <RailButton onClick={() => setSearchOpen(true)} title={t('titlebar.search')}>
                <Search size={14} />
              </RailButton>
            )}
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
          </div>
        )}

        {/* Not gated on `minimal`: on Windows and Linux this is the only
            route to the altar's image export, and distraction-free mode is
            precisely where that export is wanted. Export trägt Download,
            Import Upload — wie in Settings → Backup. */}
        {usesHtmlMenuBar && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <TitleBarMenuButton label={menus.exportMenu.label} icon={<Download size={14} />} nodes={menus.exportMenu.nodes} />
            <TitleBarMenuButton label={menus.importMenu.label} icon={<Upload size={14} />} nodes={menus.importMenu.nodes} />
          </div>
        )}

        {/* Trennstrich vor den Tabs, ganz rechts im Abschnitt: genau ueber der
            rechten Kante der Seitenleiste (gleiche Klasse, gleiche Farbe).
            Der Rand links davon bleibt Ziehflaeche. */}
        {showTabs && (
          <div data-tauri-drag-region className="ml-auto flex items-center self-stretch pl-2">
            <div className="pointer-events-none h-4 border-l border-stone-700/60" />
          </div>
        )}
      </div>

      {/* Ohne Tabs: leerer Zwischenraum, der als Ziehflaeche frei bleibt. */}
      {showTabs ? (
        <TabBar endInset={tabsEndInset} animate={animate} />
      ) : (
        <div data-tauri-drag-region className="flex-1 min-w-0 h-full" />
      )}

      {/* `ml-auto` haelt die Fenstersteuerung auch dann am rechten Rand, wenn
          die Tab-Leiste mangels Tabs nichts rendert. */}
      <div data-tauri-drag-region className="ml-auto flex items-center justify-end h-full flex-shrink-0">
        {usesCustomWindowControls && <WindowControls />}
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
