import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAltarFullscreen, useUIStore } from '../../../store/uiStore';
import { hasActiveVault, useVaultStore } from '../../../store/vaultStore';
import { usesCustomWindowControls, usesHtmlMenuBar } from '../../../lib/platform';
import RailButton from '../../ui/RailButton';
import TitleBarMenuBar from './TitleBarMenuBar';
import TitleBarSearch from './TitleBarSearch';
import WindowControls from './WindowControls';

/**
 * The width the search field is allowed to shrink to before the menu bar is
 * asked to give way instead.
 *
 * The order is deliberate: the menu keeps its width, the field yields first,
 * and only once the field is down to this does the bar fold into a single
 * button. Which window width that happens at is not a number worth writing
 * down — the bar is 315px in German against 203px in English, so a constant
 * would fold one language early and the other never. It is measured instead.
 */
const SEARCH_MIN_PX = 192;

/** The `px-4` on either side of the search field, which is not its to give. */
const SEARCH_GUTTER_PX = 32;

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
  const { t, i18n } = useTranslation();
  const navigateBack = useUIStore((s) => s.navigateBack);
  const navigateForward = useUIStore((s) => s.navigateForward);
  const history = useUIStore((s) => s.history);
  const historyIndex = useUIStore((s) => s.historyIndex);

  // The altar's distraction-free mode hides the sidebars and the tab bar. The
  // title bar stays — on Windows and Linux it holds the only way to close,
  // minimise or move the window — but drops the navigation and the search.
  const minimal = useUIStore(isAltarFullscreen);

  // Ohne offenen Vault gibt es nichts zu durchsuchen — und mehr als das: die
  // Stores behalten ihre Inhalte, wenn der letzte Vault geloescht wird
  // (`vaultStore.removeVault`, Zweig ohne Nachfolger). Sidebar und Hauptbereich
  // sind dann ungemountet, die Titelleiste bleibt stehen. Ein Suchfeld hier
  // waere die einzige Stelle, an der ein Nutzer den eben geloeschten Vault noch
  // lesen koennte — auch nachdem er "Dateien loeschen" angehakt hat.
  const vaultOpen = useVaultStore(hasActiveVault);

  const headerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // The menu bar's width while expanded. Read back while collapsed, where it
  // cannot be measured — that is what stops the two states oscillating.
  const expandedMenuWidth = useRef(0);
  const [compactMenu, setCompactMenu] = useState(false);

  // Labels change width between languages, and a collapsed bar cannot be
  // measured, so the stored width would be stale. Expanding first lets the
  // next measurement see the real one. Skipped on mount, where the width has
  // not been measured yet and expanding would undo the first reading.
  const measuredLanguage = useRef(i18n.language);
  useEffect(() => {
    if (measuredLanguage.current === i18n.language) return;
    measuredLanguage.current = i18n.language;
    expandedMenuWidth.current = 0;
    setCompactMenu(false);
  }, [i18n.language]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const left = leftRef.current;
    if (!header || !left) return;

    const measure = () => {
      const bar = left.querySelector('[role="menubar"]');
      const barWidth = bar?.getBoundingClientRect().width ?? 0;
      if (!compactMenu) expandedMenuWidth.current = barWidth;
      // What the row costs with the menu bar spelled out, whatever it is
      // showing right now.
      const spent = left.getBoundingClientRect().width - barWidth + expandedMenuWidth.current
        + (rightRef.current?.getBoundingClientRect().width ?? 0)
        + SEARCH_GUTTER_PX;
      // Nothing to protect in the altar's distraction-free mode, which drops
      // the search field but keeps the menu.
      setCompactMenu(!minimal && header.clientWidth - spent < SEARCH_MIN_PX);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [compactMenu, minimal, i18n.language]);

  return (
    <header
      ref={headerRef}
      data-tauri-drag-region
      className="titlebar relative flex-shrink-0 flex items-center h-10 select-none"
    >
      <div ref={leftRef} data-tauri-drag-region className="flex items-center gap-1 h-full flex-shrink-0 pl-2">
        {/* Reines Logo, kein Control: der Weg zum Dashboard sitzt jetzt in der
            Rail, und `data-tauri-drag-region` gibt die Fensterecke ans Ziehen
            zurueck, statt sie an einen Klick zu binden. */}
        <img
          data-tauri-drag-region
          // Ein <img> ist von Haus aus eine Drag-Quelle. Tauris drag.js laesst
          // auf macOS den zweiten Druck eines Doppelklicks (`e.detail === 2`)
          // ohne `preventDefault()` durch — ohne das hier startete WKWebView
          // dort ein natives Bild-Drag statt das Fenster zu maximieren.
          draggable={false}
          src="/emerald-icon.png"
          alt="Emerald"
          title="Emerald"
          className="flex-shrink-0 w-5 h-5 rounded-md object-cover [-webkit-user-drag:none]"
        />

        {/* Not gated on `minimal`: on Windows and Linux this is the only
            route to the altar's image export, and distraction-free mode is
            precisely where that export is wanted. */}
        {usesHtmlMenuBar && <TitleBarMenuBar compact={compactMenu} />}

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

      {/* The one flexible column, and so the one thing that gives way when the
          window narrows: the menu and the window controls keep their width
          (`flex-shrink-0`) and the search shrinks around them. It was a
          centred grid track before, which shrank the field twice as fast — a
          field centred on the window can only be as wide as twice the gap
          beside the menu, however much room is going spare on the other side.
          The wrapper renders even when empty; it is what holds the window
          controls at the right edge. */}
      <div data-tauri-drag-region className="flex justify-center px-4 flex-1 min-w-0">
        {!minimal && vaultOpen && <TitleBarSearch />}
      </div>

      <div ref={rightRef} data-tauri-drag-region className="flex items-center justify-end h-full flex-shrink-0">
        {usesCustomWindowControls && <WindowControls />}
      </div>
    </header>
  );
}
