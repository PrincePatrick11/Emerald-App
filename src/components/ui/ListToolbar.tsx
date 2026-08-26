import { useTranslation } from 'react-i18next';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import type { ViewMode, SortMode } from '../../store/uiStore';
import Dropdown from './Dropdown';

interface Props {
  view: ViewMode;
  sort: SortMode;
  onView: (v: ViewMode) => void;
  onSort: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  search?: string;
  onSearch?: (v: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;
  extraActions?: React.ReactNode;
}

export default function ListToolbar({ view, sort, onView, onSort, viewOptions: viewOptionsProp, search, onSearch, showFilters, onToggleFilters, activeFilterCount = 0, extraActions }: Props) {
  const { t } = useTranslation();

  const viewOptions = viewOptionsProp ?? [
    { value: 'list' as const, label: t('listView.list') },
    { value: 'cards' as const, label: t('listView.cards') },
    { value: 'timeline' as const, label: t('listView.timeline') },
  ];

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: 'date_desc', label: t('listView.dateDesc') },
    { value: 'date_asc',  label: t('listView.dateAsc') },
    { value: 'alpha_asc', label: t('listView.alphaAsc') },
    { value: 'alpha_desc',label: t('listView.alphaDesc') },
    { value: 'category',  label: t('listView.category') },
  ];

  return (
    <div className="list-toolbar flex items-center gap-2 px-8 py-2 border-b border-stone-700/40 bg-stone-900/40">
      {viewOptions.length > 1 && (
        <Dropdown label={t('listView.view') + ': '} value={view} options={viewOptions} onChange={onView} />
      )}
      <Dropdown label={t('listView.sort') + ': '} value={sort} options={sortOptions} onChange={onSort} />
      {onToggleFilters !== undefined && (
        <button
          onClick={onToggleFilters}
          className={`list-toolbar-filter relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'list-toolbar-filter-active'
              : 'list-toolbar-filter-idle'
          }`}
          title={t('filters.toggle')}
        >
          <SlidersHorizontal size={12} />
          {t('filters.toggle')}
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-jade-500 text-stone-900 text-[9px] font-bold flex items-center justify-center leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
      )}
      {extraActions}
      {onSearch !== undefined && (
        <div className="list-toolbar-search flex items-center gap-1.5 ml-2 flex-1 rounded-md px-2.5 py-1.5">
          <Search size={12} className="list-toolbar-chip-label flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            className="list-toolbar-input bg-transparent text-xs outline-none w-full selectable"
          />
          {search && (
            <button onClick={() => onSearch('')} className="list-toolbar-clear transition-colors flex-shrink-0">
              <X size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
