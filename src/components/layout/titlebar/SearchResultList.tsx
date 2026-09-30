import { useEffect, useRef, type ReactNode } from 'react';
import { Folder, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { comparable, type SearchHit, type SearchKind, type SearchResults } from '../../../lib/globalSearch';
import { AUX_VIEWS, MODULES } from '../../../lib/modules';
import { displayTitle } from '../../../lib/entryTitle';

const isContentKind = (kind: SearchKind): kind is 'journal' | 'wiki' | 'operation' | 'task' | 'altar' =>
  kind === 'journal' || kind === 'wiki' || kind === 'operation' || kind === 'task' || kind === 'altar';

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
  language: { icon: AUX_VIEWS.lexicon.icon, labelKey: AUX_VIEWS.lexicon.navLabelKey },
  // Eine Vokabel springt in ihre Sprache und trägt deshalb dasselbe Abzeichen.
  lexiconEntry: { icon: AUX_VIEWS.lexicon.icon, labelKey: AUX_VIEWS.lexicon.navLabelKey },
};

/** Die Id einer Trefferzeile — `SearchModal` zeigt per
 *  `aria-activedescendant` auf dieselbe. */
export const searchOptionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

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
}

/**
 * Die Trefferliste der globalen Suche, im Körper von `SearchModal`.
 */
export default function SearchResultList({
  results, pending, query, activeIndex, listboxId, onActiveIndexChange, onSelect, onShowMore,
}: Props) {
  const { t } = useTranslation();
  // Einträge ohne eigenen Titel heißen „Unbenannt…" wie überall.
  const shownTitle = (hit: SearchHit) => (isContentKind(hit.kind) ? displayTitle(t, hit.kind, hit.title) : hit.title);
  const panelRef = useRef<HTMLDivElement>(null);

  // Die Tastaturauswahl in den Blick holen. `block: 'nearest'` scrollt nur,
  // wenn die Zeile wirklich ausserhalb liegt.
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const { hits, total } = results;

  return (
    <div ref={panelRef} className="flex-1 min-h-0 flex flex-col">
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
              id={searchOptionId(listboxId, index)}
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
                  {hit.matchedIn === 'title' ? highlight(hit.title, query) : shownTitle(hit)}
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
                    {/* Nur Kategorien: das Modul, in dem sie am meisten benutzt
                        wird. Kein Sprungziel — der Treffer oeffnet seit der
                        eigenen Ansicht immer diese —, sondern der Hinweis,
                        welche der gleichnamig wirkenden Kategorien gemeint ist. */}
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
    </div>
  );
}
