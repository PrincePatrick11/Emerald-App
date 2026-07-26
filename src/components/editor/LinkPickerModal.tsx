import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, BookOpen, Library, Wand2, X } from 'lucide-react';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import type { SuggestionItem } from './SuggestionList';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';

type Tab = 'all' | 'journal' | 'wiki' | 'operation';

interface Props {
  onSelect: (item: SuggestionItem) => void;
  onClose: () => void;
}

export default function LinkPickerModal({ onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const operations = useOperationStore((s) => s.operations);
  const opCategories = useOperationStore((s) => s.categories);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const allItems = useMemo<SuggestionItem[]>(() => [
    ...entries
      .filter((e) => !e.deleted_at)
      .map((e) => ({
        id: e.id,
        entryType: 'journal' as const,
        label: e.title,
        icon: MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓',
        entry_number: e.entry_number,
      })),
    ...articles
      .filter((a) => !a.deleted_at)
      .map((a) => ({
        id: a.id,
        entryType: 'wiki' as const,
        label: a.title,
        category: a.category,
        icon: a.icon || (wikiCategories.find((c) => c.id === a.category)?.emoji ?? getCategoryEmoji(a.category as any)),
        entry_number: a.entry_number,
      })),
    ...operations
      .filter((o) => !o.deleted_at)
      .map((o) => ({
        id: o.id,
        entryType: 'operation' as const,
        label: o.title,
        category: opCategories.find((c) => c.id === o.category_id)?.emoji,
        icon: o.icon || opCategories.find((c) => c.id === o.category_id)?.emoji || '⚡',
        entry_number: o.entry_number,
      })),
  ], [entries, articles, wikiCategories, operations, opCategories]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      if (activeTab !== 'all' && item.entryType !== activeTab) return false;
      if (q && !item.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allItems, query, activeTab]);

  // Count per tab
  const counts = useMemo(() => {
    const q = query.toLowerCase();
    const visible = q ? allItems.filter((i) => i.label.toLowerCase().includes(q)) : allItems;
    return {
      all: visible.length,
      journal: visible.filter((i) => i.entryType === 'journal').length,
      wiki: visible.filter((i) => i.entryType === 'wiki').length,
      operation: visible.filter((i) => i.entryType === 'operation').length,
    };
  }, [allItems, query]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'all', label: t('linkPicker.tabAll'), icon: null, count: counts.all },
    { id: 'journal', label: t('linkPicker.tabJournal'), icon: <BookOpen size={12} />, count: counts.journal },
    { id: 'wiki', label: t('linkPicker.tabWiki'), icon: <Library size={12} />, count: counts.wiki },
    { id: 'operation', label: t('linkPicker.tabOperations'), icon: <Wand2 size={12} />, count: counts.operation },
  ];

  return (
    <Modal
      title={t('linkPicker.title')}
      onClose={onClose}
      widthClassName="w-[560px]"
      maxHeightClassName="max-h-[75vh]"
      bodyClassName="flex-1 flex flex-col overflow-hidden"
      className="link-picker-modal overflow-hidden"
    >
        {/* Search */}
        <div className="px-4 py-2.5 border-b border-stone-700/40">
          <div className="flex items-center gap-2 bg-stone-800 rounded-lg px-3 py-1.5">
            <Search size={13} className="text-stone-500 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('linkPicker.searchPlaceholder')}
              className="flex-1 bg-transparent text-sm text-stone-200 placeholder-stone-600 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-stone-600 hover:text-stone-400">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-stone-700/40">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'link-picker-tab-active bg-jade-900/60 text-jade-300'
                  : 'link-picker-tab-idle text-stone-500 hover:text-stone-300 hover:bg-stone-800'
              }`}
            >
              {tab.icon}
              {tab.label}
              <span className={`link-picker-tab-count ml-0.5 ${activeTab === tab.id ? 'text-jade-500' : 'text-stone-600'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-stone-600">
              {t('linkPicker.noResults')}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item); onClose(); }}
                  className="link-picker-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left hover:bg-stone-800 group transition-colors"
                >
                  {/* Icon */}
                  <span className="text-base w-5 flex-shrink-0 flex items-center justify-center">
                    {item.icon?.startsWith('data:') ? (
                      <img src={item.icon} alt="" className="w-4 h-4 object-contain" />
                    ) : (
                      item.icon
                    )}
                  </span>

                  {/* Title */}
                  <span className="link-picker-label flex-1 text-stone-200 truncate">{item.label}</span>

                  {/* Type badge */}
                  <span className="text-xs text-stone-600 flex-shrink-0 flex items-center gap-1 group-hover:text-stone-500">
                    {item.entryType === 'journal' ? (
                      <BookOpen size={10} />
                    ) : item.entryType === 'wiki' ? (
                      <Library size={10} />
                    ) : (
                      <Wand2 size={10} />
                    )}
                    <span className="capitalize">
                      {item.entryType === 'journal'
                        ? t('linkPicker.tabJournal')
                        : item.entryType === 'wiki'
                        ? t('linkPicker.tabWiki')
                        : t('linkPicker.tabOperations')}
                    </span>
                  </span>

                  {item.entry_number != null && (
                    <span className="text-xs text-stone-700 flex-shrink-0">#{item.entry_number}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
    </Modal>
  );
}
