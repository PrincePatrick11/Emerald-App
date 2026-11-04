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
import { isHistoryButton } from '../../lib/mouseButtons';

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

  // The tabs only show what occurs in the library (plus Other); the full
  // list only applies when assigning in the ItemModal. Memoised because two
  // effects below depend on the reference: a fresh array per render would make
  // checkCatScroll call setState endlessly.
  const categories = useMemo(
    () => categoriesUsedBy(allCategories, items),
    [allCategories, items],
  );

  const hasUncategorized = items.some((i) => !allCategories.find((c) => c.id === i.category_id));

  // A tab that no longer exists (category deleted, orphans gone) falls back to "All".
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
    if (isHistoryButton(event)) return;
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
    // The modals sit under the strip in the React tree but under <body> in
    // the DOM: their click would arrive here above the panel edge and be
    // swallowed as a resize start with preventDefault, so the name field
    // never got focus.
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

  // New elements land in the currently selected category; if the strip is
  // on "All" or "No category", they stay without one.
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
      className={`relative flex-shrink-0 border-t border-edge px-6 py-3 flex flex-col min-h-0 ${isResizing || isResizeHotspot ? 'cursor-row-resize' : 'cursor-default'}`}
      style={{ height: panelHeight }}
      onMouseDown={handlePanelMouseDown}
      onMouseMove={handlePanelMouseMove}
      onMouseLeave={() => {
        if (!isResizeHotspotRef.current) return;
        isResizeHotspotRef.current = false;
        setIsResizeHotspot(false);
      }}
    >
      <div className={`pointer-events-none absolute top-0 left-0 right-0 h-1 transition-colors ${(isResizing || isResizeHotspot) ? 'bg-accent-wash-strong' : 'bg-transparent'}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('altar.libraryTitle')}</p>
        <Button onClick={openCreateModal} variant="ghost" className="flex-shrink-0 flex items-center gap-1 text-xs" title={t('altar.addElement')}><Plus size={12} />{t('altar.element')}</Button>
      </div>
      <div className="mb-3 flex items-center gap-1">
        <div className="relative flex-1 min-w-0">
          <div className={`altar-cat-scroll-fade pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-well-page to-transparent transition-opacity duration-150 ${catScrollState.left ? 'opacity-100' : 'opacity-0'}`} />
          <div className={`altar-cat-scroll-fade pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-well-page to-transparent transition-opacity duration-150 ${catScrollState.right ? 'opacity-100' : 'opacity-0'}`} />
          <div ref={catScrollRef} onScroll={checkCatScroll} className="scrollbar-none flex gap-1 overflow-x-auto">
            <button onClick={() => setActiveCategoryTab('all')} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-well-active text-secondary' : 'text-subtle hover:text-muted'}`}>{t('altar.all')}</button>
            {/* In the order of the categories page; ordering happens only there, for all modules. */}
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryTab(cat.id)}
                className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === cat.id ? 'bg-well-active text-secondary' : 'text-subtle hover:text-muted'}`}
              >
                {cat.emoji} {categoryLabel(t, cat)}
              </button>
            ))}
            {hasUncategorized && (
              <button
                onClick={() => setActiveCategoryTab(UNCATEGORIZED_KEY)}
                className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === UNCATEGORIZED_KEY ? 'bg-well-active text-secondary' : 'text-subtle hover:text-muted'}`}
              >
                {t('categories.uncategorized')}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-subtle px-2 py-3">{t('altar.noElements')}</p>}
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
