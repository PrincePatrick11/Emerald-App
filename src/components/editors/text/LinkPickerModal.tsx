import { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutList } from 'lucide-react';
import { useLinkItems } from '../../../hooks/useLinkItems';
import { LinkItemIcon } from '../../sidebar/fields/LinkedEntryPicker';
import type { LinkTargetKind } from '../../../types';
import { TARGET_KIND_ICONS, TARGET_KIND_LABEL_KEYS, type SuggestionItem } from './SuggestionList';
import { useTranslation } from 'react-i18next';
import Modal from '../../ui/Modal';
import SearchField from '../../ui/SearchField';

type Tab = 'all' | LinkTargetKind;

/** Tab order: entries, then tasks — as in the rail. */
const LINK_TYPE_ORDER: LinkTargetKind[] = ['entry', 'task'];

interface Props {
  onSelect: (item: SuggestionItem) => void;
  onClose: () => void;
}

export default function LinkPickerModal({ onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Entries, then tasks — see buildLinkItems.
  const allItems: SuggestionItem[] = useLinkItems();

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      if (activeTab !== 'all' && item.targetKind !== activeTab) return false;
      if (q && !item.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allItems, query, activeTab]);

  // Count per tab
  const counts = useMemo(() => {
    const q = query.toLowerCase();
    const visible = q ? allItems.filter((i) => i.label.toLowerCase().includes(q)) : allItems;
    const next: Record<Tab, number> = { all: visible.length, entry: 0, task: 0 };
    for (const item of visible) next[item.targetKind]++;
    return next;
  }, [allItems, query]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    // 14px as in every other icon tab bar (LeftSidebarEntryList,
    // ListToolbar); 12 is the step for meta rows and badges.
    { id: 'all', label: t('linkPicker.tabAll'), icon: <LayoutList size={14} />, count: counts.all },
    ...LINK_TYPE_ORDER.map((type) => {
      const Icon = TARGET_KIND_ICONS[type];
      return { id: type as Tab, label: t(TARGET_KIND_LABEL_KEYS[type]), icon: <Icon size={14} />, count: counts[type] };
    }),
  ];

  return (
    <Modal
      title={t('linkPicker.title')}
      onClose={onClose}
      widthClassName="w-[560px]"
      bodyClassName="flex-1 flex flex-col overflow-hidden"
      // Fixed instead of maximum height: with max-h the modal grew and shrank
      // with the hit count of the active tab and, because it is vertically
      // centred, jumped up and down in height on every tab switch.
      className="overflow-hidden h-[75vh]"
    >
        {/* Search */}
        <div className="px-3.5 pt-3 flex-shrink-0">
          <SearchField
            inputRef={searchRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t('linkPicker.searchPlaceholder')}
            aria-label={t('linkPicker.searchPlaceholder')}
          />
        </div>

        {/* Tabs: only icon + counter, the label comes from the tooltip, like the
            other icon tab bars. Deliberately NO
            overflow-x-auto as a safety net: an overflow container also clips
            vertically and gets shifted when a tab is focused, so the
            row jumped in height. The icon tabs fit anyway.
            Deviation from TabIconButton (components.md): its active state
            is hard-wired to the stone tint of the sidebars, whereas here
            the picker's jade tint is needed; a tone variant is still missing
            there, and until then this remains the custom button. */}
        <div role="tablist" className="modal-rule flex items-center gap-1 px-3.5 py-2.5 border-b flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              aria-label={`${tab.label}: ${tab.count}`}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                activeTab === tab.id
                  ? 'link-picker-tab-active'
                  : 'link-picker-tab-idle'
              }`}
            >
              {tab.icon}
              <span className="link-picker-tab-count">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-subtle">
              {t('linkPicker.noResults')}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item) => {
                const TypeIcon = TARGET_KIND_ICONS[item.targetKind];
                return (
                  <button
                    key={item.id}
                    onClick={() => { onSelect(item); onClose(); }}
                    className="link-picker-row w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors"
                  >
                    {/* Icon */}
                    <span className="text-base w-5 flex-shrink-0 flex items-center justify-center">
                      <LinkItemIcon item={item} />
                    </span>

                    {/* Title */}
                    <span className="link-picker-label flex-1 text-secondary truncate">{item.label}</span>

                    {/* Type badge: the category, else entry/task */}
                    <span className="text-xs text-subtle flex-shrink-0 flex items-center gap-1">
                      <TypeIcon size={12} />
                      <span>{item.categoryLabel || t(TARGET_KIND_LABEL_KEYS[item.targetKind])}</span>
                    </span>

                    {item.entry_number != null && (
                      <span className="text-xs text-subtle flex-shrink-0">#{item.entry_number}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
    </Modal>
  );
}
