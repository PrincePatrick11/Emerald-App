import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, LayoutList, X } from 'lucide-react';
import { MODULE_LIST } from '../../lib/modules';
import { useLinkItems } from '../../hooks/useLinkItems';
import { isImageIcon } from '../../lib/helpers';
import type { ContentType } from '../../types';
import { ENTRY_TYPE_ICONS, ENTRY_TYPE_LABEL_KEYS, type SuggestionItem } from './SuggestionList';
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

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Reihenfolge = LINK_TYPE_ORDER (Rail), siehe useLinkItems.
  const allItems: SuggestionItem[] = useLinkItems();

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
                      {(() => {
                        // displayIcon zuerst: Altäre tragen ihre Grafik nur dort
                        // (siehe SuggestionItem), `icon` bliebe leer.
                        const icon = item.displayIcon || item.icon;
                        return isImageIcon(icon)
                          ? <img src={icon} alt="" className="w-4 h-4 object-contain" />
                          : icon;
                      })()}
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
