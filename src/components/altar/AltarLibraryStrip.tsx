import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useCategoryStore } from '../../store/categoryStore';
import { FALLBACK_CATEGORY_ID } from '../../lib/schema';
import { categoriesUsedBy, categoryLabel } from '../../lib/categories';
import { ALTAR_CATEGORY_DEFAULT_EMOJI } from '../../lib/altarConstants';
import { UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import type { AltarItem, Category } from '../../types';
import Button from '../ui/Button';
import CategoryModal from '../ui/CategoryModal';
import { AltarItemModal } from './AltarItemModal';
import { AltarItemTile } from './AltarItemTile';

const LIBRARY_DEFAULT_HEIGHT = 240;

/**
 * Überträgt die Reihenfolge eines Ausschnitts auf die Volliste: Die Plätze,
 * die Mitglieder des Ausschnitts in `full` belegen, werden in der Reihenfolge
 * von `subsetOrder` neu besetzt; alles andere bleibt, wo es war. So schreibt
 * ein Drag in der Tab-Leiste (nur die hier benutzten Kategorien) die globale
 * Reihenfolge, ohne die im Wiki benutzten Kategorien zu verschieben.
 */
function mergeOrder(full: readonly string[], subsetOrder: readonly string[]): string[] {
  const subset = new Set(subsetOrder);
  // Der Ausschnitt muss genau die Mitglieder haben, die er in `full` ersetzt —
  // sonst liefe der Zeiger ins Leere und schriebe `undefined` in die Reihenfolge.
  if (full.filter((id) => subset.has(id)).length !== subsetOrder.length) return [...full];
  let i = 0;
  return full.map((id) => (subset.has(id) ? subsetOrder[i++] : id));
}

// ─── Library strip ────────────────────────────────────────────────────────────

export function AltarLibraryStrip({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const items = useAltarStore((s) => s.items);
  const allCategories = useCategoryStore((s) => s.categories);

  // Strip-level state
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | string>('all');
  const pointerDragRef = useRef<{ id: string; hasMoved: boolean } | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const liveOrderRef = useRef<string[] | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const catScrollRef = useRef<HTMLDivElement>(null);
  const [catScrollState, setCatScrollState] = useState({ left: false, right: false });
  const [isResizeHotspot, setIsResizeHotspot] = useState(false);
  const isResizeHotspotRef = useRef(false); // keeps onMouseLeave closure current without re-subscribing
  const [isResizing, setIsResizing] = useState(false);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem('altar-library-height'));
    if (Number.isFinite(saved) && saved >= 160 && saved <= 460) return saved;
    return LIBRARY_DEFAULT_HEIGHT;
  });

  // Modal control state (the item modal manages its own edit state internally)
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AltarItem | null>(null);

  // Kategorien laufen über denselben Editor wie Wiki, Operations und Tasks —
  // nur dass hier auch das Bearbeiten im Modal statt in einer Kopfzeile passiert.
  const catEditor = useCategoryEditor({
    defaultEmoji: ALTAR_CATEGORY_DEFAULT_EMOJI,
    onAdded: (cat) => setActiveCategoryTab(cat.id),
  });
  const editingCategory = catEditor.editingCatId
    ? allCategories.find((c) => c.id === catEditor.editingCatId) ?? null
    : null;
  // Die Tabs zeigen nur, was in der Bibliothek vorkommt (plus Sonstiges und
  // eine gerade angelegte) — die Volliste gilt nur beim Zuweisen im ItemModal.
  // Memoisiert, weil zwei Effekte unten an der Referenz hängen: ein frisches
  // Array pro Render ließe checkCatScroll endlos setState aufrufen.
  const lastAddedId = catEditor.lastAddedId;
  const categories = useMemo(
    () => categoriesUsedBy(allCategories, items, [lastAddedId]),
    [allCategories, items, lastAddedId],
  );

  const hasUncategorized = items.some((i) => !allCategories.find((c) => c.id === i.category_id));

  // Ein Tab, den es nicht mehr gibt (Kategorie gelöscht, Waisen weg), fällt auf „Alle" zurück.
  useEffect(() => {
    if (activeCategoryTab === 'all') return;
    const stillThere = activeCategoryTab === UNCATEGORIZED_KEY
      ? hasUncategorized
      : categories.some((c) => c.id === activeCategoryTab);
    if (!stillThere) setActiveCategoryTab('all');
  }, [hasUncategorized, activeCategoryTab, categories]);

  const openCreateModal = () => { setEditingItem(null); setIsItemModalOpen(true); };
  const openEditModal = (item: AltarItem) => { setEditingItem(item); setIsItemModalOpen(true); };

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const startY = event.clientY;
    const startHeight = panelHeight;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setPanelHeight(Math.max(160, Math.min(460, startHeight + delta)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    localStorage.setItem('altar-library-height', String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    const unlisten = listen('reset-sidebar-widths', () => {
      setPanelHeight(LIBRARY_DEFAULT_HEIGHT);
      localStorage.removeItem('altar-library-height');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handlePanelMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // Die Modale hängen im React-Baum unter dem Strip, im DOM aber unter
    // <body>: ihr Klick käme hier oberhalb der Panel-Kante an und würde als
    // Resize-Start mit preventDefault verschluckt — das Namensfeld bekam so
    // keinen Fokus.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientY - bounds.top <= 6) startResize(event);
  };

  const handlePanelMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextHotspot = event.clientY - bounds.top <= 6;
    if (nextHotspot === isResizeHotspotRef.current) return;
    isResizeHotspotRef.current = nextHotspot;
    setIsResizeHotspot(nextHotspot);
  };

  const applyFlipAndUpdate = (newOrder: string[]) => {
    const firstPositions = new Map<string, number>();
    for (const [id, el] of tabRefs.current) {
      firstPositions.set(id, el.getBoundingClientRect().left);
    }
    liveOrderRef.current = newOrder;
    flushSync(() => setLiveOrder([...newOrder]));
    for (const [id, el] of tabRefs.current) {
      const first = firstPositions.get(id);
      if (first === undefined) continue;
      const delta = first - el.getBoundingClientRect().left;
      if (Math.abs(delta) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translateX(${delta}px)`;
    }
    requestAnimationFrame(() => {
      for (const [, el] of tabRefs.current) {
        if (!el.style.transform) continue;
        el.style.transition = 'transform 150ms ease';
        el.style.transform = '';
      }
    });
  };

  const handleCatPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    pointerDragRef.current = { id, hasMoved: false };
    liveOrderRef.current = categories.map((c) => c.id);
    lastHoverIdRef.current = null;

    const onMove = (me: PointerEvent) => {
      if (!pointerDragRef.current) return;
      if (!pointerDragRef.current.hasMoved) {
        pointerDragRef.current.hasMoved = true;
        setDragCatId(id);
        document.body.style.cursor = 'grabbing';
      }
      const el = document.elementFromPoint(me.clientX, me.clientY);
      const catEl = el?.closest('[data-cat-id]');
      const hoverId = catEl?.getAttribute('data-cat-id') ?? null;
      if (!hoverId || hoverId === id || hoverId === lastHoverIdRef.current) return;
      lastHoverIdRef.current = hoverId;
      const current = liveOrderRef.current!;
      const fromIdx = current.indexOf(id);
      const toIdx = current.indexOf(hoverId);
      if (fromIdx === -1 || toIdx === -1) return;
      const newOrder = [...current];
      const [removed] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, removed);
      applyFlipAndUpdate(newOrder);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      const state = pointerDragRef.current;
      const finalOrder = liveOrderRef.current;
      pointerDragRef.current = null;
      liveOrderRef.current = null;
      lastHoverIdRef.current = null;
      for (const [, el] of tabRefs.current) {
        el.style.transition = '';
        el.style.transform = '';
      }
      setDragCatId(null);
      setLiveOrder(null);
      if (state?.hasMoved && finalOrder) {
        // Die Tabs sind ein Ausschnitt der globalen Liste; geschrieben wird die ganze.
        const full = useCategoryStore.getState().categories.map((c) => c.id);
        useCategoryStore.getState().reorderCategories(mergeOrder(full, finalOrder));
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const displayCategories = useMemo(
    () => liveOrder
      ? liveOrder.map((id) => categories.find((c) => c.id === id)).filter((c): c is Category => !!c)
      : categories,
    [liveOrder, categories],
  );

  const checkCatScroll = useCallback(() => {
    const el = catScrollRef.current;
    if (!el) return;
    setCatScrollState({
      left: el.scrollLeft > 0,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  useEffect(() => { checkCatScroll(); }, [displayCategories, checkCatScroll]);

  // Neue Elemente landen in der gerade gewählten Kategorie, sonst im Sammelbecken.
  const defaultCategory = activeCategoryTab !== 'all' && activeCategoryTab !== UNCATEGORIZED_KEY
    ? activeCategoryTab
    : FALLBACK_CATEGORY_ID;

  const filteredItems = activeCategoryTab === 'all'
    ? items
    : activeCategoryTab === UNCATEGORIZED_KEY
      ? items.filter((i) => !allCategories.find((c) => c.id === i.category_id))
      : items.filter((item) => item.category_id === activeCategoryTab);

  return (
    <div
      className={`relative flex-shrink-0 border-t border-stone-700/60 px-6 py-3 flex flex-col min-h-0 ${isResizing || isResizeHotspot ? 'cursor-row-resize' : 'cursor-default'}`}
      style={{ height: panelHeight }}
      onMouseDown={handlePanelMouseDown}
      onMouseMove={handlePanelMouseMove}
      onMouseLeave={() => {
        if (!isResizeHotspotRef.current) return;
        isResizeHotspotRef.current = false;
        setIsResizeHotspot(false);
      }}
    >
      <div className={`pointer-events-none absolute top-0 left-0 right-0 h-1 transition-colors ${(isResizing || isResizeHotspot) ? 'bg-jade-500/20' : 'bg-transparent'}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{t('altar.libraryTitle')}</p>
        <Button onClick={openCreateModal} variant="ghost" className="flex-shrink-0 flex items-center gap-1 text-xs" title={t('altar.addElement')}><Plus size={12} />{t('altar.element')}</Button>
      </div>
      <div className="mb-3 flex items-center gap-1">
        <div className="relative flex-1 min-w-0">
          <div className={`altar-cat-scroll-fade pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-stone-900 to-transparent transition-opacity duration-150 ${catScrollState.left ? 'opacity-100' : 'opacity-0'}`} />
          <div className={`altar-cat-scroll-fade pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-stone-900 to-transparent transition-opacity duration-150 ${catScrollState.right ? 'opacity-100' : 'opacity-0'}`} />
          <div ref={catScrollRef} onScroll={checkCatScroll} className="scrollbar-none flex gap-1 overflow-x-auto">
            <button onClick={() => setActiveCategoryTab('all')} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{t('altar.all')}</button>
            {displayCategories.map((cat) => (
              <div
                key={cat.id}
                data-cat-id={cat.id}
                ref={(el) => { if (el) tabRefs.current.set(cat.id, el); else tabRefs.current.delete(cat.id); }}
                onPointerDown={(e) => handleCatPointerDown(e, cat.id)}
                className={`group relative flex items-center select-none ${dragCatId === cat.id ? 'opacity-40' : 'opacity-100'}`}
              >
                <button onClick={() => setActiveCategoryTab(cat.id)} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap cursor-grab ${activeCategoryTab === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{cat.emoji} {categoryLabel(t, cat)}</button>
                {!cat.is_builtin && (
                  <button onClick={(e) => { e.stopPropagation(); catEditor.startEditCat(cat); }} className="absolute -right-1 -top-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-stone-700 text-stone-400 hover:text-stone-200 transition-colors" title={t('editor.edit')}><Pencil size={8} /></button>
                )}
              </div>
            ))}
            {hasUncategorized && (
              <button
                onClick={() => setActiveCategoryTab(UNCATEGORIZED_KEY)}
                className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === UNCATEGORIZED_KEY ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
              >
                {t('categories.uncategorized')}
              </button>
            )}
          </div>
        </div>
        <Button onClick={() => catEditor.setAddingCategory(true)} variant="ghost" className="flex-shrink-0 flex items-center gap-1 text-xs" title={t('categories.add')}><Plus size={12} />{t('categories.add')}</Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noElements')}</p>}
        <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
          {filteredItems.map((item) => (
            <AltarItemTile
              key={item.id}
              item={item}
              draggable={editable}
              onEdit={editable ? () => openEditModal(item) : undefined}
            />
          ))}
        </div>
      </div>

      {isItemModalOpen && (
        <AltarItemModal
          key={editingItem?.id ?? 'create'}
          item={editingItem}
          categories={allCategories}
          defaultCategory={defaultCategory}
          onClose={() => setIsItemModalOpen(false)}
        />
      )}

      <CategoryModal editor={catEditor} editing={editingCategory} />
    </div>
  );
}
