import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CheckSquare, Library, Wand2, type LucideIcon } from 'lucide-react';
import type { ContentType } from '../../../types';
import type { SuggestionItem } from '../../../lib/linkItems';
import { useListKeys, type SuggestionListHandle } from './suggestionPopup';

/** Lives in `lib/linkItems.ts` alongside `buildLinkItems`, which produces these values;
 *  only re-exported here for the components that take the type from here. */
export type { SuggestionItem };

/** Not the registry (`MODULES`): that one is keyed by view type (plural),
 *  whereas the link type counts here. One row for the suggestion list and
 *  LinkPickerModal (tabs, type badges). */
export const ENTRY_TYPE_ICONS: Record<ContentType, LucideIcon> = {
  journal: BookOpen,
  wiki: Library,
  operation: Wand2,
  task: CheckSquare,
};

/** Lives in `lib/modules.ts` so that `lib/` can reach it too; only
 *  re-exported here for the components that import it from here. */
export { DEFAULT_ENTRY_EMOJI } from '../../../lib/modules';

/** Translated type labels: tabs and badges in the LinkPicker, badge here. */
export const ENTRY_TYPE_LABEL_KEYS: Record<ContentType, string> = {
  journal: 'linkPicker.tabJournal',
  wiki: 'linkPicker.tabWiki',
  operation: 'linkPicker.tabOperations',
  task: 'linkPicker.tabTasks',
};

interface Props {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
}

const SuggestionList = forwardRef<SuggestionListHandle, Props>(
  ({ items, command }, ref) => {
    const { t } = useTranslation();
    const { selectedIndex } = useListKeys(ref, items, command);

    if (items.length === 0) {
      return (
        <div className="bg-well-solid border border-edge-default rounded-lg px-3 py-2 text-xs text-subtle shadow-menu">
          {t('search.noResultsShort')}
        </div>
      );
    }

    return (
      <div className="bg-well-solid border border-edge-default rounded-lg overflow-hidden shadow-menu min-w-[220px] max-h-64 overflow-y-auto">
        {items.map((item, index) => {
          const TypeIcon = ENTRY_TYPE_ICONS[item.entryType];
          return (
            <button
              key={item.id}
              // Keep the editor's focus and selection: the click would otherwise take them away.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                index === selectedIndex
                  ? 'bg-accent-fill-strong text-on-accent'
                  : 'text-soft hover:bg-well-raise'
              }`}
            >
              <TypeIcon size={12} className="text-subtle flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-xs text-subtle flex-shrink-0 capitalize">
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
