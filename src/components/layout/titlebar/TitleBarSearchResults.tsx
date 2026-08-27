import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { createPortal } from 'react-dom';
import { Folder, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { comparable, type SearchHit, type SearchKind, type SearchResults } from '../../../lib/globalSearch';
import { MODULES } from '../../../lib/modules';

/** Abstand des Panels zur Fensterkante und zum Suchfeld darüber. */
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

/** Unter dieser Breite liest sich eine Trefferzeile nicht mehr. Das Suchfeld
 *  darf schmaler werden als das Panel — es gibt nur den linken Rand vor.
 *
 *  In rem und nicht in px, weil die Zahl eine Textbreite meint: WebKitGTK zieht
 *  seine Wurzelschrift aus der GTK-Textskalierung, und bei Faktor 1,5 trüge ein
 *  380px-Panel keine zehn Zeichen mehr. Die beiden Werte darüber bleiben px —
 *  ein Abstand zur Fensterkante ist wirklich ein Abstand. */
const MIN_PANEL_REM = 24;

/** Die Suche spricht Datenmodell-Vokabular ('operation' singular, 'task') —
 *  die Modul-Kinds ziehen Icon und nav-Label aus der Registry, die drei
 *  Nicht-Modul-Kinds haben eigene. Ein totales Record: ein neuer SearchKind
 *  ohne Eintrag hier ist ein Compile-Fehler, kein Laufzeit-Loch. */
const KIND_META: Record<SearchKind, { icon: LucideIcon; labelKey: string }> = {
  journal: { icon: MODULES.journal.icon, labelKey: MODULES.journal.navLabelKey },
  wiki: { icon: MODULES.wiki.icon, labelKey: MODULES.wiki.navLabelKey },
  operation: { icon: MODULES.operations.icon, labelKey: MODULES.operations.navLabelKey },
  task: { icon: MODULES.tasks.icon, labelKey: MODULES.tasks.navLabelKey },
  altar: { icon: MODULES.altar.icon, labelKey: MODULES.altar.navLabelKey },
  altarItem: { icon: Sparkles, labelKey: 'search.altarElements' },
  tag: { icon: Tag, labelKey: 'nav.tags' },
  category: { icon: Folder, labelKey: 'search.categories' },
};

function kindIcon(kind: SearchKind): ReactNode {
  const Icon = KIND_META[kind].icon;
  return <Icon size={13} />;
}

/**
 * Hebt die Fundstelle im Titel hervor.
 *
 * Gesucht wird auf derselben gefalteten Kleinschreibung, mit der die Suche den
 * Treffer überhaupt gefunden hat — sonst bliebe ein Titel mit `don’t` bei der
 * Eingabe `don't` unmarkiert, obwohl er als Treffer in der Liste steht.
 * Geschnitten wird aus dem Original, was nur trägt, weil jede Faltung ein
 * Zeichen gegen ein Zeichen tauscht.
 */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const needle = comparable(query);
  const index = comparable(text).indexOf(needle);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="search-match">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

interface Props {
  /** Das Suchfeld: gibt die Position vor und darf den Klick nicht schliessen. */
  anchorRef: RefObject<HTMLElement | null>;
  results: SearchResults;
  /** Die Liste ist eine Anfrage alt, weil `useDeferredValue` noch nachzieht. */
  pending: boolean;
  query: string;
  activeIndex: number;
  /** Die Id, mit der das Feld per `aria-controls` auf diese Liste zeigt; die
   *  Zeilen leiten ihre eigenen Ids daraus ab. */
  listboxId: string;
  onActiveIndexChange: (index: number) => void;
  onSelect: (hit: SearchHit, inNewTab: boolean) => void;
  onShowMore: () => void;
  onClose: () => void;
}

/**
 * Die Trefferliste der globalen Suche.
 *
 * Portal nach `document.body` mit `position: fixed`, aus demselben Grund, den
 * `ui/ContextMenu` ausbuchstabiert: `.app-sidebar` und `.app-main` tragen
 * `position: relative; z-index: 1` und sind gleichrangige Stacking-Contexts.
 * Ein Panel, das in der Titelleiste selbst hängt, verliert gegen den spaeter
 * gemalten Hauptbereich — eine hoehere `z-index`-Zahl ändert daran nichts.
 */
export default function TitleBarSearchResults({
  anchorRef, results, pending, query, activeIndex, listboxId, onActiveIndexChange, onSelect,
  onShowMore, onClose,
}: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });

  // Neu vermessen, wenn sich das Fenster ändert. Die Trefferzahl steht bewusst
  // nicht in der Liste: Rand, Breite und Höchsthöhe leiten sich allein aus dem
  // Feld und dem Fenster ab — wie viele Zeilen darunter stehen, ändert keine
  // der vier Zahlen.
  useLayoutEffect(() => {
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = Math.min(
        Math.max(rect.width, MIN_PANEL_REM * rootFontSize),
        window.innerWidth - 2 * VIEWPORT_MARGIN,
      );
      const top = rect.bottom + ANCHOR_GAP;
      setBox({
        left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN),
        top,
        width,
        maxHeight: Math.min(window.innerHeight * 0.6, window.innerHeight - top - VIEWPORT_MARGIN),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchorRef]);

  // Ein Klick daneben schließt — das Suchfeld selbst ausgenommen, sonst schlüge
  // sein eigener Fokus-Klick die Liste sofort wieder zu.
  //
  // `capture: true`, und das ist keine Feinheit: Tauris `drag.js` hängt
  // seinen eigenen mousedown-Listener aus einem Init-Skript an `document` —
  // also vor allem, was die App registriert — und ruft auf einem Element mit
  // `data-tauri-drag-region` `stopImmediatePropagation()`. Genau so ein Element
  // ist der Zwischenraum links und rechts des Suchfelds, und das ist die
  // natürlichste Stelle, um „daneben" zu klicken. In der Bubble-Phase zöge der
  // Klick dort das Fenster und ließe die Trefferliste offen stehen.
  useOutsideClick(true, onClose, { refs: [panelRef, anchorRef], capture: true });

  // Die Tastaturauswahl in den Blick holen. `block: 'nearest'` scrollt nur,
  // wenn die Zeile wirklich ausserhalb liegt.
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const { hits, total } = results;

  return createPortal(
    <div
      ref={panelRef}
      className="menu-surface fixed z-[9999] flex flex-col overflow-hidden"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
    >
      {hits.length === 0 ? (
        <p className="search-result-meta">{query.trim() ? t('search.noResults') : t('search.hint')}</p>
      ) : (
        // Waehrend `useDeferredValue` nachzieht, steht hier noch das Ergebnis
        // der vorigen Eingabe. Auf einem kleinen Vault ist das kein Bild lang,
        // auf einem grossen ist der erste Volltextlauf spürbar — und eine
        // Liste, die stumm veraltet, liest sich wie eine, die schon passt.
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('titlebar.search')}
          aria-busy={pending}
          className={`flex-1 overflow-y-auto overscroll-contain py-1 transition-opacity ${pending ? 'opacity-60' : ''}`}
        >
          {hits.map((hit, index) => (
            <button
              key={hit.key}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="search-result-row"
              onMouseMove={() => onActiveIndexChange(index)}
              // Der Fokus bleibt im Eingabefeld: die Liste wird mit den
              // Pfeiltasten bedient, ein Klick darf ihn nicht wegziehen.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onSelect(hit, e.ctrlKey || e.metaKey)}
            >
              <span className="flex-shrink-0 mt-0.5">{kindIcon(hit.kind)}</span>

              <span className="flex-1 min-w-0">
                <span className="search-result-title block">
                  {hit.matchedIn === 'title' ? highlight(hit.title, query) : hit.title}
                </span>
                {hit.snippet && (
                  <span className="search-result-snippet block">
                    {hit.snippet.before}
                    <mark className="search-match">{hit.snippet.match}</mark>
                    {hit.snippet.after}
                  </span>
                )}
              </span>

              <span className="search-result-badge mt-0.5">
                {t(KIND_META[hit.kind].labelKey)}
                {hit.entryNumber != null && <span>#{hit.entryNumber}</span>}
                {/* Schliessen sich aus: eine Kategorie hat keine Eintragsnummer. */}
                {hit.module && (
                  <>
                    <span aria-hidden="true">·</span>
                    {/* Kategorien tragen zusaetzlich ihr Modul: die vier Kategorie-
                        Tabellen teilen sich Built-in-Ids, ohne Modul waeren `Herb`
                        (Wiki) und `Herb` (Altar) nicht zu unterscheiden. */}
                    <span>{t(MODULES[hit.module].navLabelKey)}</span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Was die Kappung verschweigt, sagt die Liste selbst — eine stumm
          abgeschnittene Trefferliste liest sich wie eine vollstaendige. Und
          weil das Zurueckgehaltene ohnehin schon gesucht ist, sagt die Zeile
          es nicht nur, sie gibt es auch heraus. Mit der Tastatur laeuft man
          dafuer einfach weiter nach unten. `onMouseDown` aus demselben Grund
          wie bei den Zeilen darueber. */}
      {total > hits.length && (
        <button
          type="button"
          className="search-result-more flex-shrink-0"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onShowMore}
        >
          {t('search.showMore', { count: total - hits.length })}
        </button>
      )}
    </div>,
    document.body,
  );
}
