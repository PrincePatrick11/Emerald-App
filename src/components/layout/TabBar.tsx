import { Flame, MoreHorizontal, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LazyMotion, Reorder, domAnimation } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/* Die Geometrie am rechten Ende, in Zahlen statt nur in Klassen: `gap-0.5` (2),
   das „+" (30), die Mindestbreite der Ziehflaeche `min-w-12` (48) und der
   Abstand zum Trennstrich (6). */
const TAB_GAP = 2;
const ADD_SIZE = 30;
const FILL_MIN = 48;
const EDGE_GAP = 6;
/** Wie lange die Layout-Animation nach dem Loslassen eines Tabs noch laeuft —
 *  reichlich fuer REORDER_SPRING, bis die ausgewichenen Tabs stehen. */
const REORDER_SETTLE_MS = 500;
/** Soviel Platz braucht der Streifen ueber der rechten Seitenleiste, damit
 *  Trennstrich, „+" (im ungünstigsten Fall EDGE_GAP dahinter) und Ziehflaeche
 *  hineinpassen. Darunter gibt es keinen Strich, und die Tabs weichen dem „+"
 *  wie ohne Seitenleiste aus. */
const EDGE_ROOM = 1 + EDGE_GAP + ADD_SIZE + TAB_GAP + FILL_MIN;

interface TabBarProps {
  /** Abstand, den die Tabs selbst zum rechten Rand halten — die Breite der
   *  rechten Seitenleiste, soweit sie nicht unter den Fensterknoepfen liegt.
   *  Das „+" darf in diesen Streifen hinein, die Tabs nicht. */
  endInset?: number;
  /** Aus, solange eine Seitenleiste per Drag in der Breite gezogen wird. */
  animate?: boolean;
}

export default function TabBar({ endInset = 0, animate = true }: TabBarProps) {
  const { t } = useTranslation();
  const { tabs, activeTabId, selectTab, closeTab, addTab, setTabsOrder } = useUIStore(
    useShallow((s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, selectTab: s.selectTab, closeTab: s.closeTab, addTab: s.addTab, setTabsOrder: s.setTabsOrder }))
  );
  const scrollRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasEdge = endInset >= EDGE_ROOM;
  // Ohne Tabs rendert die Leiste nichts, es gibt also nichts zu beobachten —
  // der Effekt muss neu laufen, sobald wieder einer da ist.
  const hasTabs = tabs.length > 0;
  // Wie weit das „+" nach rechts ruecken muss, um nicht auf dem Trennstrich zu
  // sitzen: reicht die Liste bis an ihn heran, springt es dahinter.
  const [addShift, setAddShift] = useState(0);
  // Layout-Animation der Items nur, solange ein Tab gezogen wird — dort
  // weichen die anderen ihm aus. Sonst federte jeder Tab hinterher, sobald sich
  // die Leiste als Ganzes verschiebt (Eintragsliste per Drag breiter,
  // Seitenleiste ein- oder ausgeblendet), und saesse waehrenddessen nicht
  // buendig ueber dem Blatt. Nach dem Loslassen bleibt sie noch REORDER_SETTLE_MS
  // an, damit ein Tab, der gerade erst ausgewichen ist, zu Ende federt statt zu
  // springen.
  const [reordering, setReordering] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startReorder = () => { clearTimeout(settleTimer.current); setReordering(true); };
  const endReorder = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setReordering(false), REORDER_SETTLE_MS);
  };
  // Wird der gezogene Tab mitten im Ziehen geschlossen (Tastenkuerzel), kommt
  // kein `onDragEnd` mehr — der Schalter faellt dann mit der Tab-Zahl zurueck.
  useEffect(() => {
    if (reordering) endReorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei geaenderter Tab-Zahl
  }, [tabs.length]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const list = scrollRef.current;
    if (!root || !list || !hasEdge) { setAddShift(0); return; }
    const update = () => {
      // Die Kante der rechten Seitenleiste; der Strich belegt ihr erstes Pixel.
      const edge = root.getBoundingClientRect().right - endInset;
      const addLeft = list.getBoundingClientRect().right + TAB_GAP;
      const clear = edge + 1 + EDGE_GAP;
      const collides = addLeft + ADD_SIZE > edge - EDGE_GAP && addLeft < clear;
      setAddShift(collides ? clear - addLeft : 0);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(list);
    return () => observer.disconnect();
  }, [endInset, hasEdge, hasTabs]);

  // Der aktive Tab bleibt sichtbar — ein neuer per „+" ebenso wie einer, der
  // von anderswo geoeffnet oder gewaehlt wurde. Von Hand gerechnet statt
  // `scrollIntoView`: das scrollte auch die Vorfahren, die nur abschneiden.
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
    // Sitzt in der Titelleiste und beginnt ohne Polsterung, also buendig mit
    // der linken Kante des Blatts darunter; die Tabs sind Pills darin. Die freien
    // Raender und das flex-1-Element am Ende bleiben Ziehflaeche fuers Fenster
    // (das Attribut vererbt sich nicht, s. TitleBar). Die Luecken zwischen den
    // Pills nicht: ein Klick dorthin kurz nach einem Tab-Klick zaehlte als
    // Doppelklick und maximierte das Fenster.
    // Das Endelement hat eine Mindestbreite, damit auch bei vielen Tabs eine
    // zum Greifen bleibt.
    <div
      ref={rootRef}
      data-tauri-drag-region
      className="tabbar relative flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      <LazyMotion features={domAnimation}>
        <Reorder.Group
          ref={scrollRef}
          axis="x"
          values={tabs.map((tab) => tab.id)}
          onReorder={setTabsOrder}
          className={`scrollbar-none flex h-full min-w-0 flex-initial items-center gap-0.5 overflow-x-auto overflow-y-hidden${
            animate ? ' titlebar-follow-animated' : ''
          }`}
          style={{ maxWidth: `calc(100% - ${hasEdge ? endInset + EDGE_GAP : endInset}px)` }}
        >
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            return (
              <Reorder.Item
                key={tab.id}
                value={tab.id}
                // Reorder.Items Typ kennt nur `true | 'position'`; `false`
                // reicht es unveraendert an motion.li durch, wo es gilt.
                layout={reordering as true}
                onDragStart={startReorder}
                onDragEnd={endReorder}
                whileDrag={{ scale: 1.005 }}
                transition={REORDER_SPRING}
                style={{ position: 'relative' }}
                // Schrumpfen von 180 bis 96px, darunter scrollt die Liste.
                className={`tab-item group flex h-[var(--tab-pill-h)] min-w-[96px] flex-[0_1_180px] items-center gap-2 rounded-md pl-2.5 pr-1 text-[13px] transition-colors ${
                  isActive ? 'tab-item-active font-medium' : 'tab-item-idle'
                }`}
              >
                <TabButton view={tab.view} onSelect={() => selectTab(tab.id)} onClose={() => closeTab(tab.id)} />
                <button
                  onClick={() => closeTab(tab.id)}
                  // Am aktiven Tab immer da, an den anderen erst beim Ueberfahren.
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
        className="tab-add flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md transition-colors"
        style={addShift ? { marginLeft: addShift } : undefined}
        title={t('tabBar.newTab')}
      >
        <Plus size={14} />
      </button>
      <div data-tauri-drag-region className="min-w-12 flex-1 self-stretch" />
      {/* Trennstrich ueber der Kante der rechten Seitenleiste, in der Flucht
          der Linie zwischen den beiden Blatthaelften darunter. */}
      {hasEdge && (
        <div
          className={`pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 border-l border-stone-700/60${
            animate ? ' titlebar-follow-animated' : ''
          }`}
          style={{ right: endInset - 1 }}
        />
      )}
    </div>
  );
}
