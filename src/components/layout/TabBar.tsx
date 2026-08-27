import { Flame, MoreHorizontal, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LazyMotion, Reorder, domAnimation } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { useAltarStore } from '../../store/altarStore';
import { useJournalStore } from '../../store/journalStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import type { ActiveView, MoonPhase } from '../../types';
import { getCategoryEmoji } from '../wiki/WikiList';
import { imageSrc } from '../../lib/images';
import { AUX_VIEWS, moduleMeta, type AuxViewId } from '../../lib/modules';

function getFallbackTitle(view: ActiveView, t: TFunction) {
  const meta = moduleMeta(view.type);
  if (meta) return view.id ? t(meta.untitledKey) : t(meta.navLabelKey);
  const aux = AUX_VIEWS[view.type as AuxViewId];
  return aux ? t(aux.navLabelKey) : '';
}

function renderIconValue(icon: string | null | undefined, fallback: ReactNode) {
  if (!icon) return fallback;
  if (icon.startsWith('data:') || icon.startsWith('blob:') || icon.startsWith('http') || icon.startsWith('/')) {
    return <img src={icon} alt="" className="h-4 w-4 rounded object-cover" />;
  }
  return <span className="text-sm leading-none">{icon}</span>;
}

function AltarTabIcon({ iconData }: { iconData: string | null | undefined }) {
  if (!iconData) return <Flame size={13} />;
  // `/`-Pfade sind Presets aus public/ und gehen an imageSrc vorbei.
  const src = iconData.startsWith('/') ? iconData : imageSrc(iconData);
  if (src) return <img src={src} alt="" className="h-4 w-4 rounded object-cover" />;
  return <span className="text-sm leading-none">{iconData}</span>;
}

export default function TabBar() {
  const { t } = useTranslation();
  const { tabs, activeTabId, selectTab, closeTab, addTab, setTabsOrder } = useUIStore(
    useShallow((s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, selectTab: s.selectTab, closeTab: s.closeTab, addTab: s.addTab, setTabsOrder: s.setTabsOrder }))
  );
  const getEntry = useJournalStore((s) => s.getEntry);
  const getArticle = useWikiStore((s) => s.getArticle);
  const getOperation = useOperationStore((s) => s.getOperation);
  const getTask = useTaskStore((s) => s.getTask);
  const operationCategories = useOperationStore((s) => s.categories);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const altars = useAltarStore((s) => s.altars);
  const scrollRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [tabs.length]);

  if (tabs.length === 0) return null;

  const getTitle = (view: ActiveView) => {
    if (!view.id) return getFallbackTitle(view, t);
    if (view.type === 'journal') return getEntry(view.id)?.title || getFallbackTitle(view, t);
    if (view.type === 'wiki') return getArticle(view.id)?.title || getFallbackTitle(view, t);
    if (view.type === 'operations') return getOperation(view.id)?.title || getFallbackTitle(view, t);
    if (view.type === 'altar') return altars.find((altar) => altar.id === view.id)?.title || getFallbackTitle(view, t);
    if (view.type === 'tasks') return getTask(view.id)?.title || getFallbackTitle(view, t);
    return getFallbackTitle(view, t);
  };

  const getIcon = (view: ActiveView) => {
    if (view.type === 'journal' && view.id) {
      const entry = getEntry(view.id);
      return <span className="text-sm leading-none">{MOON_PHASE_SYMBOLS[entry?.moon_phase as MoonPhase] ?? '📓'}</span>;
    }
    if (view.type === 'wiki' && view.id) {
      const article = getArticle(view.id);
      const categoryIcon = wikiCategories.find((category) => category.id === article?.category_id)?.emoji
        ?? getCategoryEmoji(article?.category_id as any);
      return renderIconValue(article?.icon, <span className="text-sm leading-none">{categoryIcon}</span>);
    }
    if (view.type === 'operations' && view.id) {
      const operation = getOperation(view.id);
      const categoryIcon = operationCategories.find((category) => category.id === operation?.category_id)?.emoji ?? '⚡';
      return renderIconValue(operation?.icon, <span className="text-sm leading-none">{categoryIcon}</span>);
    }

    if (view.type === 'altar' && view.id) {
      const altar = altars.find((a) => a.id === view.id);
      return <AltarTabIcon iconData={altar?.icon_data} />;
    }

    const Icon = moduleMeta(view.type)?.icon ?? AUX_VIEWS[view.type as AuxViewId]?.icon ?? MoreHorizontal;
    return <Icon size={13} />;
  };

  return (
    <div className="tabbar relative h-10 flex items-end overflow-hidden px-2 pt-2">
      <LazyMotion features={domAnimation}>
        <Reorder.Group
          ref={scrollRef}
          axis="x"
          values={tabs.map((tab) => tab.id)}
          onReorder={setTabsOrder}
          className="scrollbar-none flex min-w-0 max-w-full flex-initial items-end gap-1 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            const title = getTitle(tab.view);
            return (
              <Reorder.Item
                key={tab.id}
                value={tab.id}
                whileDrag={{ scale: 1.005 }}
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }}
                style={{ position: 'relative' }}
                className={`tab-item group flex min-w-32 max-w-56 flex-1 items-center gap-2 rounded-t-lg border px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'tab-item-active border-stone-700/80 bg-stone-800 text-stone-100'
                    : 'tab-item-idle border-stone-800/60 bg-stone-900/70 text-stone-500 hover:bg-stone-800/60 hover:text-stone-300'
                }`}
              >
                <button
                  onClick={() => selectTab(tab.id)}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                  onAuxClick={(event) => { if (event.button === 1) closeTab(tab.id); }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={title}
                >
                  <span className="flex-shrink-0 text-stone-500">{getIcon(tab.view)}</span>
                  <span className="truncate">{title}</span>
                  {tab.view.mode === 'edit' && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-jade-500" title={t('tabBar.editing')} />}
                </button>
                <button
                  onClick={() => closeTab(tab.id)}
                  className="-mr-1 rounded p-0.5 text-stone-600 opacity-0 transition-colors hover:bg-stone-700 hover:text-stone-200 group-hover:opacity-100"
                  title={t('tabBar.closeTab')}
                >
                  <X size={13} />
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </LazyMotion>
      <button
        onClick={() => addTab()}
        className="tab-add mb-px ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-t-lg border border-stone-800/60 bg-stone-900/70 text-stone-500 transition-colors hover:bg-stone-800/60 hover:text-stone-200"
        title={t('tabBar.newTab')}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
