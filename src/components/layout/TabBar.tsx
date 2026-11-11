import { MoreHorizontal, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LazyMotion, Reorder, domAnimation } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { journalIcon } from '../../lib/moonPhase';
import { hasOwnTitle } from '../../lib/entryTitle';
import { REORDER_SPRING } from '../../lib/motion';
import { useHorizontalWheel } from '../../hooks/useHorizontalWheel';
import { findEntry, useEntryStore } from '../../store/entryStore';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import type { ActiveView } from '../../types';
import { useCategoryStore } from '../../store/categoryStore';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useTemplateStore } from '../../store/templateStore';
import { useLexiconStore } from '../../store/lexiconStore';
import { useSettingsStore } from '../../store/settingsStore';
import { definitionLabel, templateLabel } from '../../lib/blocks/blockAttrs';
import { AUX_VIEWS, DEFAULT_ENTRY_EMOJI, entryIcon, entryTypeForView, moduleMeta, type AuxViewId } from '../../lib/modules';

function getFallbackTitle(view: ActiveView, t: TFunction) {
  const meta = moduleMeta(view.type);
  if (meta) return view.id ? t(meta.untitledKey) : t(meta.navLabelKey);
  const aux = AUX_VIEWS[view.type as AuxViewId];
  return aux ? t(aux.navLabelKey) : '';
}

function renderIconValue(icon: string | null | undefined, fallback: ReactNode) {
  if (!icon) return fallback;
  if (icon.startsWith('data:') || icon.startsWith('blob:') || icon.startsWith('http') || icon.startsWith('/')) {
    return <img src={icon} alt="" className="h-3.5 w-3.5 rounded-md object-cover" />;
  }
  return <span className="text-sm leading-none">{icon}</span>;
}

/**
 * Title and icon of a tab. Each tab subscribes only to its own entry:
 * the selectors return the object itself, which only changes when exactly
 * this entry changes — so a rename reaches the tab immediately,
 * without every autosave of another entry redrawing the bar.
 * (Stable getters like `getEntry` subscribed to nothing: their identity never changes.)
 */
function TabButton({ view, onSelect, onClose }: { view: ActiveView; onSelect: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { type, id } = view;
  const entryType = entryTypeForView(type);
  const entry = useEntryStore((s) => (entryType && id ? findEntry(s.entries, id, entryType) : undefined));
  const task = useTaskStore((s) => (type === 'tasks' && id ? s.tasks.find((task) => task.id === id) : undefined));
  const definition = useBlockDefinitionStore((s) => (type === 'blocks' && id ? s.definitions.find((d) => d.id === id) : undefined));
  const template = useTemplateStore((s) => (type === 'templates' && id ? s.templates.find((tpl) => tpl.id === id) : undefined));
  const language = useLexiconStore((s) => (type === 'lexicon' && id ? s.languages.find((l) => l.id === id) : undefined));
  const categoryId = entry?.category_id;
  const category = useCategoryStore((s) => (categoryId ? s.categories.find((c) => c.id === categoryId) : undefined));
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  const fallback = getFallbackTitle(view, t);
  let title = fallback;
  if (id) {
    const entityTitle = entry?.title ?? task?.title;
    if (hasOwnTitle(entityTitle)) title = entityTitle;
    else if (definition) title = definitionLabel(t, definition);
    else if (template) title = templateLabel(t, template);
    else if (language) title = language.name;
  }

  let icon: ReactNode;
  const Icon = moduleMeta(type)?.icon ?? AUX_VIEWS[type as AuxViewId]?.icon ?? MoreHorizontal;
  if (entryType && id) {
    icon = entryType === 'journal'
      ? <span className="text-sm leading-none">{entry ? journalIcon(entry, showMoonPhase) : DEFAULT_ENTRY_EMOJI.journal}</span>
      : renderIconValue(entryIcon(entryType, entry ?? {}, category), null);
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

/** How long the layout animation keeps running after a tab is released —
 *  ample for REORDER_SPRING, until the tabs that moved aside have settled. */
const REORDER_SETTLE_MS = 500;

export default function TabBar() {
  const { t } = useTranslation();
  const { tabs, activeTabId, selectTab, closeTab, addTab, setTabsOrder } = useUIStore(
    useShallow((s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, selectTab: s.selectTab, closeTab: s.closeTab, addTab: s.addTab, setTabsOrder: s.setTabsOrder }))
  );
  const scrollRef = useRef<HTMLUListElement>(null);
  // Layout animation of the items only while a tab is being dragged — there
  // the others make way for it. Otherwise every tab would spring after it as soon as
  // the bar as a whole shifts (entry list dragged wider,
  // sidebar shown or hidden), and in the meantime would not sit
  // flush above the sheet. After release it stays on for REORDER_SETTLE_MS,
  // so that a tab that has only just made way finishes springing instead of
  // jumping.
  const [reordering, setReordering] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startReorder = () => { clearTimeout(settleTimer.current); setReordering(true); };
  const endReorder = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setReordering(false), REORDER_SETTLE_MS);
  };
  // If the dragged tab is closed mid-drag (keyboard shortcut), no more
  // `onDragEnd` arrives — the switch then drops back with the tab count.
  useEffect(() => {
    if (reordering) endReorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the tab count changes
  }, [tabs.length]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // The active tab stays visible — a new one via "+" as well as one that was
  // opened or chosen from elsewhere. Computed by hand instead of
  // `scrollIntoView`: that would also scroll the ancestors, which only clip.
  useEffect(() => {
    const list = scrollRef.current;
    const item = list?.querySelector<HTMLElement>('.tab-item-active');
    if (!list || !item) return;
    const listBox = list.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    let delta = 0;
    if (itemBox.left < listBox.left) delta = itemBox.left - listBox.left;
    else if (itemBox.right > listBox.right) delta = itemBox.right - listBox.right;
    if (delta === 0) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' });
  }, [activeTabId, tabs.length]);

  useHorizontalWheel(scrollRef, [tabs.length]);

  if (tabs.length === 0) return null;

  return (
    // Sits in the title bar and starts without padding, so flush with
    // the left edge of the sheet below; the tabs are pills inside it. The free
    // margins and the flex-1 element at the end remain a drag area for the window
    // (the attribute is not inherited, see TitleBar). The gaps between the
    // pills do not: a click there shortly after a tab click counted as a
    // double click and maximized the window.
    // The end element has a minimum width so that, even with many tabs, a piece
    // remains in front of the window buttons for moving the window.
    <div
      data-tauri-drag-region
      className="tabbar flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      <LazyMotion features={domAnimation}>
        <Reorder.Group
          ref={scrollRef}
          axis="x"
          values={tabs.map((tab) => tab.id)}
          onReorder={setTabsOrder}
          className="scrollbar-none flex h-full min-w-0 flex-initial items-center gap-0.5 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            return (
              <Reorder.Item
                key={tab.id}
                value={tab.id}
                // Reorder.Item's type only knows `true | 'position'`; `false`
                // it passes through unchanged to motion.li, where it is valid.
                layout={reordering as true}
                onDragStart={startReorder}
                onDragEnd={endReorder}
                whileDrag={{ scale: 1.005 }}
                transition={REORDER_SPRING}
                style={{ position: 'relative' }}
                // Shrinks from 180 to 96px, below that the list scrolls.
                className={`tab-item group flex h-[var(--tab-pill-h)] min-w-[96px] flex-[0_1_180px] items-center gap-2 rounded-md pl-2.5 pr-1 text-[13px] transition-colors ${
                  isActive ? 'tab-item-active font-medium' : 'tab-item-idle'
                }`}
              >
                <TabButton view={tab.view} onSelect={() => selectTab(tab.id)} onClose={() => closeTab(tab.id)} />
                <button
                  onClick={() => closeTab(tab.id)}
                  // Always there on the active tab, on the others only on hover.
                  className={`tab-close flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md transition-colors${
                    isActive ? '' : ' opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
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
        className="tab-add flex h-[var(--tab-pill-h)] w-[var(--tab-pill-h)] flex-shrink-0 items-center justify-center rounded-md transition-colors"
        title={t('tabBar.newTab')}
      >
        <Plus size={14} />
      </button>
      <div data-tauri-drag-region className="min-w-8 flex-1 self-stretch" />
    </div>
  );
}
