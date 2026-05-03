import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X, SlidersHorizontal } from 'lucide-react';
import type { ViewMode, SortMode } from '../../store/uiStore';

interface Props {
  view: ViewMode;
  sort: SortMode;
  onView: (v: ViewMode) => void;
  onSort: (s: SortMode) => void;
  search?: string;
  onSearch?: (v: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;
}

function Dropdown<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-stone-800/70 hover:bg-stone-700/70 text-stone-400 hover:text-stone-200 transition-colors"
      >
        <span className="text-stone-600 mr-0.5">{label}</span>
        {selected}
        <ChevronDown size={11} className="text-stone-600" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-stone-850 border border-stone-700/60 rounded-lg shadow-xl py-1 min-w-[130px]" style={{ backgroundColor: '#1c1917' }}>
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                value === o.value
                  ? 'text-jade-400'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-700/50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ListToolbar({ view, sort, onView, onSort, search, onSearch, showFilters, onToggleFilters, activeFilterCount = 0 }: Props) {
  const { t } = useTranslation();

  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: 'list', label: t('listView.list') },
    { value: 'cards', label: t('listView.cards') },
    { value: 'timeline', label: t('listView.timeline') },
  ];

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: 'date_desc', label: t('listView.dateDesc') },
    { value: 'date_asc',  label: t('listView.dateAsc') },
    { value: 'alpha_asc', label: t('listView.alphaAsc') },
    { value: 'alpha_desc',label: t('listView.alphaDesc') },
    { value: 'category',  label: t('listView.category') },
  ];

  return (
    <div className="flex items-center gap-2 px-8 py-2 border-b border-stone-700/40 bg-stone-900/40">
      <Dropdown label={t('listView.view') + ': '} value={view} options={viewOptions} onChange={onView} />
      <Dropdown label={t('listView.sort') + ': '} value={sort} options={sortOptions} onChange={onSort} />
      {onToggleFilters !== undefined && (
        <button
          onClick={onToggleFilters}
          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'bg-jade-900/50 border border-jade-800/40 text-jade-400'
              : 'bg-stone-800/70 hover:bg-stone-700/70 text-stone-400 hover:text-stone-200'
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
      {onSearch !== undefined && (
        <div className="flex items-center gap-1.5 ml-2 flex-1 bg-stone-800/70 rounded-md px-2.5 py-1.5">
          <Search size={12} className="text-stone-600 flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            className="bg-transparent text-xs text-stone-300 placeholder-stone-600 outline-none w-full selectable"
          />
          {search && (
            <button onClick={() => onSearch('')} className="text-stone-600 hover:text-stone-400 transition-colors flex-shrink-0">
              <X size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
