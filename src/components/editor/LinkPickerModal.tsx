import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, LayoutList, X } from 'lucide-react';
import { MODULE_LIST } from '../../lib/modules';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { ContentType, MoonPhase } from '../../types';
import { DEFAULT_ENTRY_EMOJI, ENTRY_TYPE_ICONS, ENTRY_TYPE_LABEL_KEYS, type SuggestionItem } from './SuggestionList';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';

type Tab = 'all' | ContentType;

/** Tab-Reihenfolge = Rail-Reihenfolge (Registry), nicht die Key-Reihenfolge
 *  irgendeiner Map: journal, task, operation, wiki, altar. */
const LINK_TYPE_ORDER: ContentType[] = MODULE_LIST.map((mod) => mod.entryType);

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
  const tasks = useTaskStore((s) => s.tasks);
  const taskCategories = useTaskStore((s) => s.categories);
  const altars = useAltarStore((s) => s.altars);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Blockreihenfolge von Hand mit LINK_TYPE_ORDER (Rail) synchron gehalten —
  // nichts erzwingt das —, damit der „Alle"-Tab die Module in derselben Folge
  // zeigt wie die Rail und die Tab-Leiste.
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
    ...tasks
      .filter((task) => !task.deleted_at)
      .map((task) => ({
        id: task.id,
        entryType: 'task' as const,
        label: task.title,
        icon: taskCategories.find((c) => c.id === task.category_id)?.emoji || DEFAULT_ENTRY_EMOJI.task,
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
    ...articles
      .filter((a) => !a.deleted_at)
      .map((a) => ({
        id: a.id,
        entryType: 'wiki' as const,
        label: a.title,
        category: a.category_id,
        icon: a.icon || (wikiCategories.find((c) => c.id === a.category_id)?.emoji ?? getCategoryEmoji(a.category_id as any)),
        entry_number: a.entry_number,
      })),
    // Kein icon — wie in RichEditors itemsRef: icon_data ist eine data-URL
    // und landete sonst in den Node-Attrs; Zeile und Chip rendern den
    // Emoji-Fallback über getDefaultIcon.
    ...altars.map((a) => ({
      id: a.id,
      entryType: 'altar' as const,
      label: a.title,
    })),
  ], [entries, articles, wikiCategories, operations, opCategories, tasks, taskCategories, altars]);

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
    const next: Record<Tab, number> = { all: visible.length, journal: 0, wiki: 0, operation: 0, task: 0, altar: 0 };
    for (const item of visible) next[item.entryType]++;
    return next;
  }, [allItems, query]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    // 14px wie in jeder anderen Icon-Tab-Leiste (LeftSidebarEntryList,
    // ListToolbar) — 12 ist der Schritt für Meta-Zeilen und Badges.
    { id: 'all', label: t('linkPicker.tabAll'), icon: <LayoutList size={14} />, count: counts.all },
    ...LINK_TYPE_ORDER.map((type) => {
      const Icon = ENTRY_TYPE_ICONS[type];
      return { id: type as Tab, label: t(ENTRY_TYPE_LABEL_KEYS[type]), icon: <Icon size={14} />, count: counts[type] };
    }),
  ];

  return (
    <Modal
      title={t('linkPicker.title')}
      onClose={onClose}
      widthClassName="w-[560px]"
      bodyClassName="flex-1 flex flex-col overflow-hidden"
      // Feste statt maximale Höhe: mit max-h wuchs und schrumpfte das Modal
      // mit der Trefferzahl des aktiven Tabs und sprang, weil es vertikal
      // zentriert ist, bei jedem Tab-Wechsel in der Höhe hin und her.
      className="link-picker-modal overflow-hidden h-[75vh]"
    >
        {/* Search */}
        <div className="px-4 py-2.5 border-b border-stone-700/40 flex-shrink-0">
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

        {/* Tabs — nur Icon + Zähler, das Label liefert der Tooltip: sechs Tabs
            mit Locale-Labels sprengten die Modal-Breite. Bewusst KEIN
            overflow-x-auto als Netz: ein Overflow-Container clippt auch
            vertikal und wird beim Fokussieren eines Tabs verschoben — die
            Reihe sprang dann in der Höhe. Die Icon-Tabs passen ohnehin.
            Abweichung von TabIconButton (components.md): dessen Aktiv-Zustand
            ist fest auf die Stone-Tönung der Seitenleisten verdrahtet, hier
            braucht es die Jade-Tönung des Pickers — eine Tone-Variante fehlt
            dort noch; bis dahin bleibt dies der eigene Button. */}
        <div role="tablist" className="flex items-center gap-1 px-4 py-2 border-b border-stone-700/40 flex-shrink-0">
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
                  ? 'link-picker-tab-active bg-jade-900/60 text-jade-300'
                  : 'link-picker-tab-idle text-stone-500 hover:text-stone-300 hover:bg-stone-800'
              }`}
            >
              {tab.icon}
              <span className={`link-picker-tab-count ${activeTab === tab.id ? 'text-jade-500' : 'text-stone-600'}`}>
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
              {filtered.map((item) => {
                const TypeIcon = ENTRY_TYPE_ICONS[item.entryType];
                return (
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
                      <TypeIcon size={10} />
                      <span className="capitalize">{t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}</span>
                    </span>

                    {item.entry_number != null && (
                      <span className="text-xs text-stone-700 flex-shrink-0">#{item.entry_number}</span>
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
