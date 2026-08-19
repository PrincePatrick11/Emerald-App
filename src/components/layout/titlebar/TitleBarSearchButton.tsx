import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';

/**
 * The search field in the middle of the title bar.
 *
 * Deliberately a `<button>` dressed as an input, not an actual `<input>`:
 * there is no global search yet, and a text field you can type into that does
 * nothing would be worse than a control that clearly does one thing. Clicking
 * opens the left entry list, whose per-tab search is the search that exists
 * today — the same behaviour the rail's magnifier button used to have.
 *
 * It reuses `sidebar-search-inner` from the entry
 * list so both search affordances share one themed surface, and colours its
 * label with `--text-subtle` (the placeholder tone) via `.titlebar-search`.
 */
export default function TitleBarSearchButton() {
  const { t } = useTranslation();
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const toggleLeftList = useUIStore((s) => s.toggleLeftList);

  return (
    <button
      type="button"
      onClick={() => { if (!leftListOpen) toggleLeftList(); }}
      title={t('search.placeholder')}
      aria-label={t('titlebar.search')}
      // Fills the space the menu bar and the window controls leave over, up
      // to a width where it still reads as a field rather than a banner, and
      // gives that space back as the window narrows. No lower bound: the menu
      // has the prior claim on the room, so the field is what yields.
      className="titlebar-search sidebar-search-inner flex w-full max-w-[26rem] items-center gap-2 rounded-md px-2.5 h-7 min-w-0 bg-stone-700/40"
    >
      <Search size={14} className="flex-shrink-0" />
      <span className="truncate text-xs">{t('search.placeholder')}</span>
    </button>
  );
}
