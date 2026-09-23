import { Flame, MoreHorizontal, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LazyMotion, Reorder, domAnimation } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { REORDER_SPRING } from '../../lib/motion';
import { useAltarStore } from '../../store/altarStore';
import { useJournalStore } from '../../store/journalStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import type { ActiveView, MoonPhase } from '../../types';
import { useCategoryStore } from '../../store/categoryStore';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useTemplateStore } from '../../store/templateStore';
import { useLexiconStore } from '../../store/lexiconStore';
import { definitionLabel, templateLabel } from '../../lib/blocks/blockAttrs';
import { imageSrc } from '../../lib/images';
import { AUX_VIEWS, DEFAULT_ENTRY_EMOJI, moduleMeta, type AuxViewId } from '../../lib/modules';

function getFallbackTitle(view: ActiveView, t: TFunction) {
  const meta = moduleMeta(view.type);
  if (meta) return view.id ? t(meta.untitledKey) : t(meta.navLabelKey);
  const aux = AUX_VIEWS[view.type as AuxViewId];
  return aux ? t(aux.navLabelKey) : '';
}

function renderIconValue(icon: string | null | undefined, fallback: ReactNode) {
  if (!icon) return fallback;
  if (icon.startsWith('data:') || icon.startsWith('blob:') || icon.startsWith('http') || icon.startsWith('/')) {
    return <img src={icon} alt="" className="h-3.5 w-3.5 rounded object-cover" />;
  }
  return <span className="text-sm leading-none">{icon}</span>;
}

function AltarTabIcon({ iconData }: { iconData: string | null | undefined }) {
  if (!iconData) return <Flame size={14} />;
  // `/`-Pfade sind Presets aus public/ und gehen an imageSrc vorbei.
  const src = iconData.startsWith('/') ? iconData : imageSrc(iconData);
  if (src) return <img src={src} alt="" className="h-3.5 w-3.5 rounded object-cover" />;
  return <span className="text-sm leading-none">{iconData}</span>;
}

/**
 * Titel und Icon eines Tabs. Jeder Tab abonniert nur seinen eigenen Eintrag:
 * die Selektoren liefern das Objekt selbst, das sich nur bei einer Änderung an
 * genau diesem Eintrag ändert — so zieht eine Umbenennung sofort in den Tab,
 * ohne dass jeder Autosave eines anderen Eintrags die Leiste neu zeichnet.
 * (Stabile Getter wie `getEntry` abonnierten nichts: ihre Identität ändert sich nie.)
 */
function TabButton({ view, onSelect, onClose }: { view: ActiveView; onSelect: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { type, id } = view;
  const entry = useJournalStore((s) => (type === 'journal' && id ? s.entries.find((e) => e.id === id) : undefined));
  const article = useWikiStore((s) => (type === 'wiki' && id ? s.articles.find((a) => a.id === id) : undefined));
  const operation = useOperationStore((s) => (type === 'operations' && id ? s.operations.find((o) => o.id === id) : undefined));
  const task = useTaskStore((s) => (type === 'tasks' && id ? s.tasks.find((task) => task.id === id) : undefined));
  const altar = useAltarStore((s) => (type === 'altar' && id ? s.altars.find((a) => a.id === id) : undefined));
  const definition = useBlockDefinitionStore((s) => (type === 'blocks' && id ? s.definitions.find((d) => d.id === id) : undefined));
  const template = useTemplateStore((s) => (type === 'templates' && id ? s.templates.find((tpl) => tpl.id === id) : undefined));
  const language = useLexiconStore((s) => (type === 'lexicon' && id ? s.languages.find((l) => l.id === id) : undefined));
  const categoryId = article?.category_id ?? operation?.category_id;
  const categoryEmoji = useCategoryStore((s) => (categoryId ? s.categories.find((c) => c.id === categoryId)?.emoji : undefined));

  const fallback = getFallbackTitle(view, t);
  let title = fallback;
  if (id) {
    const entityTitle = entry?.title ?? article?.title ?? operation?.title ?? task?.title ?? altar?.title;
    if (entityTitle) title = entityTitle;
    else if (definition) title = definitionLabel(t, definition);
    else if (template) title = templateLabel(t, template);
    else if (language) title = language.name;
  }

  let icon: ReactNode;
  const Icon = moduleMeta(type)?.icon ?? AUX_VIEWS[type as AuxViewId]?.icon ?? MoreHorizontal;
  if (type === 'journal' && id) {
    icon = <span className="text-sm leading-none">{MOON_PHASE_SYMBOLS[entry?.moon_phase as MoonPhase] ?? '📓'}</span>;
  } else if (type === 'wiki' && id) {
    icon = renderIconValue(article?.icon, <span className="text-sm leading-none">{categoryEmoji ?? DEFAULT_ENTRY_EMOJI.wiki}</span>);
  } else if (type === 'operations' && id) {
    icon = renderIconValue(operation?.icon, <span className="text-sm leading-none">{categoryEmoji ?? '⚡'}</span>);
  } else if (type === 'altar' && id) {
    icon = <AltarTabIcon iconData={altar?.icon_data} />;
  } else if (type === 'blocks' && id) {
    icon = renderIconValue(definition?.icon, <Icon size={14} />);
  } else if (type === 'templates' && id) {
    icon = renderIconValue(template?.icon, <Icon size={14} />);
  } else if (type === 'lexicon' && id) {
    icon = renderIconValue(language?.icon, <Icon size={14} />);
  } else {
    icon = <Icon size={14} />;
  }

  return (
    <button
      onClick={onSelect}
      onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
      onAuxClick={(event) => { if (event.button === 1) onClose(); }}
      className="tab-button flex h-full min-w-0 flex-1 items-center gap-2 text-left"
      title={title}
    >
      <span className="tab-icon flex-shrink-0">{icon}</span>
      <span className="truncate">{title}</span>
      {view.mode === 'edit' && <span className="tab-edit-dot h-1.5 w-1.5 flex-shrink-0 rounded-full" title={t('tabBar.editing')} />}
    </button>
  );
}

export default function TabBar() {
  const { t } = useTranslation();
  const { tabs, activeTabId, selectTab, closeTab, addTab, setTabsOrder } = useUIStore(
    useShallow((s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, selectTab: s.selectTab, closeTab: s.closeTab, addTab: s.addTab, setTabsOrder: s.setTabsOrder }))
  );
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

  return (
    // Die Leiste zeichnet keine eigene Grundlinie: jedes Element traegt seine
    // untere Kante selbst, der aktive Tab laesst sie weg — so ist die Linie
    // nur unter ihm offen. Das flex-1-Element am Ende zieht sie bis zum Rand.
    <div className="tabbar flex h-[var(--tabbar-h)] items-stretch overflow-hidden">
      <LazyMotion features={domAnimation}>
        <Reorder.Group
          ref={scrollRef}
          axis="x"
          values={tabs.map((tab) => tab.id)}
          onReorder={setTabsOrder}
          className="scrollbar-none flex min-w-0 max-w-full flex-initial items-stretch overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            return (
              <Reorder.Item
                key={tab.id}
                value={tab.id}
                whileDrag={{ scale: 1.005 }}
                transition={REORDER_SPRING}
                style={{ position: 'relative' }}
                className={`tab-item group flex w-[var(--tab-w)] flex-shrink-0 items-center gap-2 pl-3 pr-1.5 text-[13px] transition-colors ${
                  isActive ? 'tab-item-active font-medium' : 'tab-item-idle'
                }`}
              >
                <TabButton view={tab.view} onSelect={() => selectTab(tab.id)} onClose={() => closeTab(tab.id)} />
                <button
                  onClick={() => closeTab(tab.id)}
                  className="tab-close flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100"
                  title={t('tabBar.closeTab')}
                >
                  <X size={14} />
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </LazyMotion>
      <button
        onClick={() => addTab()}
        className="tab-add flex w-[var(--tabbar-h)] flex-shrink-0 items-center justify-center transition-colors"
        title={t('tabBar.newTab')}
      >
        <Plus size={16} />
      </button>
      <div className="tab-fill flex-1" />
    </div>
  );
}
