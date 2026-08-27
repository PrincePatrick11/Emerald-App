import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Library, Wand2 } from 'lucide-react';

export interface SuggestionItem {
  id: string;
  entryType: 'journal' | 'wiki' | 'operation';
  label: string;
  category?: string;
  icon?: string;
  entry_number?: number;
}

interface Props {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
}

export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SuggestionList = forwardRef<SuggestionListRef, Props>(
  ({ items, command }, ref) => {
    const { t } = useTranslation();
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-500 shadow-xl">
          {t('search.noResultsShort')}
        </div>
      );
    }

    return (
      <div className="bg-stone-800 border border-stone-700 rounded-lg overflow-hidden shadow-xl min-w-[220px] max-h-64 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => selectItem(index)}
            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              index === selectedIndex
                ? 'bg-jade-900/70 text-stone-100'
                : 'text-stone-300 hover:bg-stone-700/60'
            }`}
          >
            {item.entryType === 'journal' ? (
              <BookOpen size={12} className="text-stone-500 flex-shrink-0" />
            ) : item.entryType === 'wiki' ? (
              <Library size={12} className="text-stone-500 flex-shrink-0" />
            ) : (
              <Wand2 size={12} className="text-stone-500 flex-shrink-0" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            <span className="text-xs text-stone-600 flex-shrink-0 capitalize">
              {item.entryType}
            </span>
          </button>
        ))}
      </div>
    );
  }
);

SuggestionList.displayName = 'SuggestionList';
export default SuggestionList;
