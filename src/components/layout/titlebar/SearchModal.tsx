import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useGlobalSearch } from '../../../hooks/useGlobalSearch';
import { viewForSearchHit, type SearchHit } from '../../../lib/globalSearch';
import Modal from '../../ui/Modal';
import SearchResultList, { searchOptionId } from './SearchResultList';

/** The list and its rows need stable ids so that `aria-controls` and
 *  `aria-activedescendant` can point at them. */
const LISTBOX_ID = 'global-search-results';

/** How many rows the list shows before it offers the rest — and by
 *  how many it grows afterwards. A pure view size: the search covers
 *  the whole data set anyway, `lib/globalSearch` does not know the number. */
const PAGE_SIZE = 50;

/**
 * The app's global search, as a modal behind the magnifier in the title bar.
 *
 * Through `lib/globalSearch` it searches titles, tags and content of all modules
 * and lists the hits under the field. It has the outlined pill
 * (`sidebar-search-inner`) to itself; the entry list searches in a
 * borderless field on the frame and only shares `sidebar-search-input`.
 *
 * Together with the hit list it forms a combobox pattern: focus stays
 * in the field, the arrow keys move a selection in the list below, and
 * `aria-activedescendant` is the only thing that reports this selection to a
 * screen reader. Escape closes via `Modal` itself.
 */
export default function SearchModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { results, query: effectiveQuery, pending } = useGlobalSearch(query, limit);
  const { hits, total } = results;
  const hasMore = total > hits.length;

  const showMore = () => setLimit((current) => current + PAGE_SIZE);

  /**
   * The selection is clamped on *read*, not pulled along by an effect.
   *
   * `hits` is always the beginning of the same sorted list, so `activeIndex`
   * normally points into the target. But if the data set shrinks between two
   * renders — autosave, deleted entry, vault switch — the index would lie
   * beyond it, and that fails silently: no row marked, nothing to
   * scroll, and the next ArrowDown lands somewhere. An effect on `hits`
   * would be the wrong tool, see below.
   */
  const selectedIndex = hits.length ? Math.min(activeIndex, hits.length - 1) : 0;

  // A new hit list starts at the top, and on page one again. Hung on
  // the query and not on `hits`: the array is a new one on every
  // store mutation, and an autosave in the middle of an
  // arrow-key selection would otherwise throw the highlight back to the top.
  useEffect(() => { setActiveIndex(0); setLimit(PAGE_SIZE); }, [effectiveQuery]);

  const openHit = (hit: SearchHit, inNewTab: boolean) => {
    const view = viewForSearchHit(hit);
    if (!view) return;
    if (inNewTab) openViewInNewTab(view);
    else setActiveView(view);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;

    // The exception first: at the end of the list it carries on instead of
    // wrapping, as long as something is still held back. Otherwise the footer
    // would be the only element of the list that can only be operated with the
    // mouse — focus stays in the field, so nobody reaches its place in the
    // tab order. `hits.length` is the first newly released row, because
    // the longer list begins with the shorter one.
    if (e.key === 'ArrowDown' && hasMore && selectedIndex === hits.length - 1) {
      e.preventDefault();
      showMore();
      setActiveIndex(hits.length);
      return;
    }
    // Then the rule.
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
    <Modal
      title={t('titlebar.search')}
      onClose={onClose}
      widthClassName="w-[560px]"
      bodyClassName="flex-1 flex flex-col overflow-hidden"
      // Fixed instead of maximum height, as with the LinkPicker: the modal is
      // vertically centred and would otherwise jump with the hit count on every keystroke.
      className="overflow-hidden h-[70vh]"
    >
      <div className="px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-soft)' }}>
        {/* In Parchment, `bg-stone-700/40` beats the `.sidebar-search-inner`
            override (Documentation/design.md, Known Fault Line). The entry
            list's search no longer carries the class; here it is the last
            remnant and can go once someone checks the field in Parchment. */}
        <div className="sidebar-search-inner flex items-center gap-2 rounded-md px-2.5 h-8 bg-stone-700/40">
          <Search size={14} className="text-stone-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.globalPlaceholder')}
            aria-label={t('titlebar.search')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls={hits.length ? LISTBOX_ID : undefined}
            // Focus never leaves the field; without this pointer the arrow
            // keys move a selection that only sighted users learn about.
            aria-activedescendant={hits[selectedIndex] ? searchOptionId(LISTBOX_ID, selectedIndex) : undefined}
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
      </div>

      <SearchResultList
        results={results}
        pending={pending}
        query={effectiveQuery}
        activeIndex={selectedIndex}
        listboxId={LISTBOX_ID}
        onActiveIndexChange={setActiveIndex}
        onSelect={openHit}
        onShowMore={showMore}
      />
    </Modal>
  );
}
