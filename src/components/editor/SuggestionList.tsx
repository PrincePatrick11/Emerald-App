import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CheckSquare, Flame, Library, Wand2, type LucideIcon } from 'lucide-react';
import type { ContentType } from '../../types';

export interface SuggestionItem {
  id: string;
  entryType: ContentType;
  label: string;
  category?: string;
  icon?: string;
  entry_number?: number;
}

/** Nicht die Registry (`MODULES`): die ist nach View-Typ (plural) verschlüsselt,
 *  hier zählt der Link-Typ. Eine Reihe für die Suggestion-Liste und
 *  LinkPickerModal (Tabs, Typ-Badges). */
export const ENTRY_TYPE_ICONS: Record<ContentType, LucideIcon> = {
  journal: BookOpen,
  wiki: Library,
  operation: Wand2,
  task: CheckSquare,
  altar: Flame,
};

/** Emoji-Fallback je Link-Typ, wenn weder eigenes Icon noch Kategorie-Emoji
 *  greift — eine Wahrheit für Chip-NodeView, Editor-Lookups, Picker, Export. */
export const DEFAULT_ENTRY_EMOJI: Record<ContentType, string> = {
  journal: '📓',
  wiki: '📚',
  operation: '⚡',
  task: '✅',
  altar: '🔥',
};

/** Übersetzte Typ-Labels — Tabs und Badges im LinkPicker, Badge hier. */
export const ENTRY_TYPE_LABEL_KEYS: Record<ContentType, string> = {
  journal: 'linkPicker.tabJournal',
  wiki: 'linkPicker.tabWiki',
  operation: 'linkPicker.tabOperations',
  task: 'linkPicker.tabTasks',
  altar: 'linkPicker.tabAltar',
};

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
        {items.map((item, index) => {
          const TypeIcon = ENTRY_TYPE_ICONS[item.entryType];
          return (
            <button
              key={item.id}
              onClick={() => selectItem(index)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                index === selectedIndex
                  ? 'bg-jade-900/70 text-stone-100'
                  : 'text-stone-300 hover:bg-stone-700/60'
              }`}
            >
              <TypeIcon size={12} className="text-stone-500 flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-xs text-stone-600 flex-shrink-0 capitalize">
                {t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);

SuggestionList.displayName = 'SuggestionList';
export default SuggestionList;
