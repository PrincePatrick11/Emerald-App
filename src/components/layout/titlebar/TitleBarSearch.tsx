import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useGlobalSearch } from '../../../hooks/useGlobalSearch';
import { viewForSearchHit, type SearchHit } from '../../../lib/globalSearch';
import TitleBarSearchResults from './TitleBarSearchResults';

/**
 * Das Suchfeld in der Mitte der Titelleiste — die globale Suche der App.
 *
 * Es durchsucht über `lib/globalSearch` Titel, Tags und Inhalte aller Module
 * und bietet die Treffer im Dropdown darunter an. Die Oberfläche teilt es sich
 * mit der Suche der Eintragsliste (`sidebar-search-inner`,
 * `sidebar-search-input`), damit beide Suchen dieselbe Fläche zeigen;
 * `.titlebar-search` färbt nur Glyphe und Rahmen.
 *
 * Zusammen mit der Trefferliste bildet es ein Combobox-Muster: der Fokus bleibt
 * im Feld, die Pfeiltasten bewegen eine Auswahl in der Liste daneben, und
 * `aria-activedescendant` ist das Einzige, was diese Auswahl an einen
 * Screenreader meldet. Kein Tastenkürzel — die App hat bislang keines, und
 * eines einzuführen ist eine eigene Entscheidung.
 */
/** Die Liste und ihre Zeilen brauchen stabile Ids, damit `aria-controls` und
 *  `aria-activedescendant` auf sie zeigen koennen. */
const LISTBOX_ID = 'titlebar-search-results';
const optionId = (index: number) => `${LISTBOX_ID}-option-${index}`;

/** Wie viele Zeilen die Liste zeigt, bevor sie den Rest anbietet — und um
 *  wie viele sie danach waechst. Eine reine Ansichtsgroesse: gesucht wird
 *  ohnehin im ganzen Bestand, `lib/globalSearch` kennt die Zahl nicht. */
const PAGE_SIZE = 50;

export default function TitleBarSearch() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, query: effectiveQuery, pending } = useGlobalSearch(query, limit);
  const { hits, total } = results;
  const hasMore = total > hits.length;

  const showMore = () => setLimit((current) => current + PAGE_SIZE);

  /**
   * Die Auswahl wird beim *Lesen* geklemmt, nicht per Effekt nachgezogen.
   *
   * `hits` ist immer der Anfang derselben sortierten Liste, `activeIndex` zeigt
   * also normalerweise ins Ziel. Schrumpft der Bestand aber zwischen zwei
   * Rendern — Autosave, geloeschter Eintrag, Vault-Wechsel —, laege der Index
   * dahinter, und das faellt still aus: keine Zeile markiert, nichts zu
   * scrollen, und das naechste ArrowDown landet irgendwo. Ein Effekt an `hits`
   * waere das falsche Mittel, siehe unten.
   */
  const selectedIndex = hits.length ? Math.min(activeIndex, hits.length - 1) : 0;

  // Beide Wege hierher brauchen ihn, und keiner sieht den anderen: der Effekt
  // greift beim Tippen einer neuen Anfrage, ohne dass geschlossen wird;
  // `close()` greift beim Klick daneben, wobei der Begriff stehen bleibt und
  // der Effekt deshalb nicht feuert.
  const resetPaging = () => { setActiveIndex(0); setLimit(PAGE_SIZE); };

  // Eine neue Trefferliste fängt oben an, und zwar wieder auf Seite eins. An
  // der Anfrage aufgehängt und nicht an `hits`: das Array ist bei jeder
  // Store-Mutation ein neues, und ein Autosave mitten in der
  // Pfeiltastenauswahl würde die Markierung sonst zurück nach oben werfen.
  useEffect(() => { resetPaging(); }, [effectiveQuery]);

  const close = () => { setOpen(false); resetPaging(); };

  const openHit = (hit: SearchHit, inNewTab: boolean) => {
    const view = viewForSearchHit(hit);
    if (!view) return;
    if (inNewTab) openViewInNewTab(view);
    else setActiveView(view);
    // Der Suchbegriff faellt mit dem Dropdown weg: das Feld sitzt dauerhaft in
    // der Titelleiste, ein stehengebliebener Begriff wuerde dort veralten.
    setQuery('');
    close();
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else inputRef.current?.blur();
      close();
      return;
    }
    if (!open || hits.length === 0) return;

    // Erst die Ausnahme: am Listenende geht es weiter, statt umzulaufen,
    // solange noch etwas zurueckgehalten wird. Sonst waere die Fusszeile das
    // einzige Element des Dropdowns, das sich nur mit der Maus bedienen laesst
    // — der Fokus bleibt im Feld, ihre Stelle in der Tab-Reihenfolge erreicht
    // also niemand. `hits.length` ist die erste neu freigegebene Zeile, weil
    // die laengere Liste mit der kuerzeren beginnt.
    if (e.key === 'ArrowDown' && hasMore && selectedIndex === hits.length - 1) {
      e.preventDefault();
      showMore();
      setActiveIndex(hits.length);
      return;
    }
    // Dann die Regel.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((selectedIndex + step + hits.length) % hits.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) openHit(hit, e.ctrlKey || e.metaKey);
    }
  };

  return (
    // `data-tauri-drag-region` fehlt hier absichtlich und gehoert auch nicht
    // nachtraeglich her: Tauri liest das Attribut vom Element unter dem Zeiger,
    // und ein Feld, das beim Klick das Fenster zieht, laesst sich nicht
    // beschriften.
    <div ref={fieldRef} className="relative w-full max-w-[26rem] min-w-0">
      {/* `bg-stone-700/40` bleibt: die Klasse schlaegt in Parchment den
          `.sidebar-search-inner`-Override, und die Eintragslisten-Suche traegt
          sie ebenfalls. Sie hier allein zu streichen liesse die beiden
          Suchfelder in Parchment auseinanderlaufen — sie gehoert an beiden
          Stellen gemeinsam entfernt oder gar nicht (Documentation/design.md). */}
      <div className="titlebar-search sidebar-search-inner flex items-center gap-2 rounded-md px-2.5 h-7 bg-stone-700/40">
        <Search size={14} className="flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('search.globalPlaceholder')}
          aria-label={t('titlebar.search')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? LISTBOX_ID : undefined}
          // Der Fokus verlaesst das Feld nie; ohne diesen Zeiger bewegen die
          // Pfeiltasten eine Auswahl, von der nur sehende Nutzer erfahren.
          aria-activedescendant={open && hits[selectedIndex] ? optionId(selectedIndex) : undefined}
          className="sidebar-search-input flex-1 min-w-0 bg-transparent text-xs outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label={t('search.clear')}
            className="flex-shrink-0 opacity-70 hover:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <TitleBarSearchResults
          anchorRef={fieldRef}
          results={results}
          pending={pending}
          query={effectiveQuery}
          activeIndex={selectedIndex}
          listboxId={LISTBOX_ID}
          onActiveIndexChange={setActiveIndex}
          onSelect={openHit}
          onShowMore={showMore}
          onClose={close}
        />
      )}
    </div>
  );
}
