import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { SlashCommand } from './slashCommands';
import { useListKeys, type SuggestionListHandle } from './suggestionPopup';

/** The `/` menu: the matching commands, chosen by arrow keys and Enter, or a click. */
const CommandList = forwardRef<SuggestionListHandle, SuggestionProps<SlashCommand, SlashCommand>>(
  ({ items, command }, ref) => {
    const { t } = useTranslation();
    const { selectedIndex, setSelectedIndex } = useListKeys(ref, items, command);

    if (items.length === 0) {
      return <div className="menu-surface px-3 py-2 text-xs text-subtle">{t('search.noResultsShort')}</div>;
    }

    return (
      <div className="menu-surface min-w-[200px] max-h-72 overflow-y-auto py-1">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              // Keep the editor's focus and selection: the click would otherwise take them away.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`menu-item${index === selectedIndex ? ' menu-item--current' : ''}`}
            >
              <Icon size={14} className="text-subtle flex-shrink-0" />
              <span className="flex-1 truncate">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    );
  },
);

CommandList.displayName = 'CommandList';
export default CommandList;
