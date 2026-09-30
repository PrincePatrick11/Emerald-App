import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useCategoryStore } from '../../store/categoryStore';
import { categoriesUsedBy, categoryLabel } from '../../lib/categories';
import { UNCATEGORIZED_KEY } from '../../lib/groupBy';
import type { AltarItem } from '../../types';
import Button from '../ui/Button';
import { AltarItemModal } from './AltarItemModal';
import { AltarItemTile } from './AltarItemTile';

const LIBRARY_DEFAULT_HEIGHT = 240;

// ─── Library strip ────────────────────────────────────────────────────────────

export function AltarLibraryStrip({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const items = useAltarStore((s) => s.items);
  const allCategories = useCategoryStore((s) => s.categories);

  // Strip-level state
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | string>('all');
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

  // Die Tabs zeigen nur, was in der Bibliothek vorkommt (plus Sonstiges) —
  // die Volliste gilt nur beim Zuweisen im ItemModal. Memoisiert, weil zwei
  // Effekte unten an der Referenz hängen: ein frisches Array pro Render ließe
  // checkCatScroll endlos setState aufrufen.
  const categories = useMemo(
    () => categoriesUsedBy(allCategories, items),
    [allCategories, items],
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

  const checkCatScroll = useCallback(() => {
    const el = catScrollRef.current;
    if (!el) return;
    setCatScrollState({
      left: el.scrollLeft > 0,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  useEffect(() => { checkCatScroll(); }, [categories, checkCatScroll]);

  // Neue Elemente landen in der gerade gewählten Kategorie — steht die Leiste
  // auf „Alle" oder „Ohne Kategorie", bleiben sie ohne.
  const defaultCategory = activeCategoryTab !== 'all' && activeCategoryTab !== UNCATEGORIZED_KEY
    ? activeCategoryTab
    : null;

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
            {/* In der Reihenfolge der Kategorien-Seite — geordnet wird nur dort, für alle Module. */}
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryTab(cat.id)}
                className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
              >
                {cat.emoji} {categoryLabel(t, cat)}
              </button>
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
    </div>
  );
}
