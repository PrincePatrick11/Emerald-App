import { useEffect, useRef, type ReactNode } from 'react';
import { Folder, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { comparable, type SearchHit, type SearchKind, type SearchResults } from '../../../lib/globalSearch';
import { AUX_VIEWS, MODULES } from '../../../lib/modules';

/** The search speaks data-model vocabulary ('operation' singular, 'task') —
 *  the module kinds take icon and nav label from the registry, the three
 *  non-module kinds have their own. A total record: a new SearchKind
 *  without an entry here is a compile error, not a runtime hole. */
const KIND_META: Record<SearchKind, { icon: LucideIcon; labelKey: string }> = {
  journal: { icon: MODULES.journal.icon, labelKey: MODULES.journal.navLabelKey },
  wiki: { icon: MODULES.wiki.icon, labelKey: MODULES.wiki.navLabelKey },
  operation: { icon: MODULES.operations.icon, labelKey: MODULES.operations.navLabelKey },
  task: { icon: MODULES.tasks.icon, labelKey: MODULES.tasks.navLabelKey },
  altar: { icon: MODULES.altar.icon, labelKey: MODULES.altar.navLabelKey },
  altarItem: { icon: Sparkles, labelKey: 'search.altarElements' },
  image: { icon: AUX_VIEWS.images.icon, labelKey: AUX_VIEWS.images.navLabelKey },
  tag: { icon: Tag, labelKey: 'nav.tags' },
  category: { icon: Folder, labelKey: 'search.categories' },
  language: { icon: AUX_VIEWS.lexicon.icon, labelKey: AUX_VIEWS.lexicon.navLabelKey },
  // A vocabulary entry jumps to its language and therefore carries the same badge.
  lexiconEntry: { icon: AUX_VIEWS.lexicon.icon, labelKey: AUX_VIEWS.lexicon.navLabelKey },
};

/** The id of a hit row — `SearchModal` points at the same one via
 *  `aria-activedescendant`. */
export const searchOptionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

function kindIcon(kind: SearchKind): ReactNode {
  const Icon = KIND_META[kind].icon;
  return <Icon size={14} />;
}

/**
 * Highlights the match in the title.
 *
 * The lookup uses the same case-folded form with which the search found the
 * hit in the first place — otherwise a title with `don’t` would stay unmarked
 * for the input `don't` although it is in the list as a hit.
 * The cut is taken from the original, which only holds because every folding
 * swaps one character for one character.
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
  /** The list is one query old because `useDeferredValue` is still catching up. */
  pending: boolean;
  query: string;
  activeIndex: number;
  /** The id with which the field points at this list via `aria-controls`; the
   *  rows derive their own ids from it. */
  listboxId: string;
  onActiveIndexChange: (index: number) => void;
  onSelect: (hit: SearchHit, inNewTab: boolean) => void;
  onShowMore: () => void;
}

/**
 * The hit list of the global search, in the body of `SearchModal`.
 */
export default function SearchResultList({
  results, pending, query, activeIndex, listboxId, onActiveIndexChange, onSelect, onShowMore,
}: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Bring the keyboard selection into view. `block: 'nearest'` only scrolls
  // if the row really lies outside.
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
        // While `useDeferredValue` catches up, the result of the previous
        // input is still shown here. On a small vault that lasts not a single
        // frame, on a large one the first full-text run is noticeable — and a
        // list that silently goes stale reads like one that already fits.
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
              // Focus stays in the input field: the list is operated with the
              // arrow keys, a click must not pull it away.
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
                {/* Mutually exclusive: a category has no entry number. */}
                {hit.module && (
                  <>
                    <span aria-hidden="true">·</span>
                    {/* Categories only: the module in which they are used most.
                        Not a jump target — since the view of its own, the hit
                        always opens that one —, but a hint as to
                        which of the identically named categories is meant. */}
                    <span>{t(MODULES[hit.module].navLabelKey)}</span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* What the cap leaves unsaid, the list says itself — a silently
          truncated hit list reads like a complete one. And because what was
          held back has already been searched anyway, the row does not just
          say it, it also hands it over. With the keyboard you simply keep
          going down for that. `onMouseDown` for the same reason
          as for the rows above. */}
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
