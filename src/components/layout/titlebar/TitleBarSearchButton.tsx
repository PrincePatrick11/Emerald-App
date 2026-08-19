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
      // Hidden below `lg` so it cannot collide with the menu bar at the 900px
      // minimum window width.
      className="titlebar-search sidebar-search-inner hidden lg:flex items-center gap-2 rounded-md px-2.5 h-7 w-[clamp(12rem,28vw,26rem)] min-w-0 bg-stone-700/40"
    >
      <Search size={14} className="flex-shrink-0" />
      <span className="truncate text-xs">{t('search.placeholder')}</span>
    </button>
  );
}
