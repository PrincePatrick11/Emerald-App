import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import ContextMenu, { type ContextMenuAction } from './ContextMenu';

/** Rows per step when the list runs without a limit ("all"). */
const RENDER_STEP = 100;

export interface RenderRowArgs<T> {
  item: T;
  /** The result of `isActive`, so that a custom row can mark the selection
   *  without stating the same condition a second time. */
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  openCtxMenu: (e: React.MouseEvent) => void;
}

export interface EntryListTabProps<T> {
  items: T[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  /** What renaming starts with: the saved title, without "Untitled…". If absent, `getTitle`. */
  getEditTitle?: (item: T) => string;
  getDateStr?: (item: T) => string | null | undefined;
  getIcon?: (item: T) => ReactNode;
  isActive?: (item: T) => boolean;
  onOpen?: (item: T) => void;
  onOpenNewTab?: (item: T) => void;
  onDragStart?: (item: T) => void;
  onRename: (item: T, newTitle: string) => void | Promise<void>;
  contextMenuActions: (item: T, startRename: () => void) => ContextMenuAction[];
  emptyMessage: string;
  /** Fully custom row content (both normal and renaming state). Overrides getIcon/onOpen/onOpenNewTab/onDragStart for rendering — search, empty-state, and the context menu popup stay centrally handled. `isActive` is not overridden but handed to the row, which decides how to show it. */
  renderRow?: (args: RenderRowArgs<T>) => ReactNode;
}

/** How long the scrollbar stays after the last scroll event. */
const SCROLLBAR_LINGER_MS = 800;
/** How close to the list's right edge, from either side, brings the scrollbar up. */
const SCROLLBAR_EDGE_PX = 12;

/** WebKit does not repaint a custom scrollbar when only its colour rule changes:
 *  it has to be rebuilt, which taking the overflow away for one layout does. */
function setScrollbarShown(nav: HTMLElement, shown: boolean) {
  nav.classList.toggle('scrollbar-shown', shown);
  nav.style.overflowY = 'hidden';
  void nav.offsetWidth;
  nav.style.overflowY = '';
}

export default function EntryListTab<T>({
  items, getId, getTitle, getEditTitle = getTitle, getDateStr, getIcon, isActive, onOpen, onOpenNewTab, onDragStart,
  onRename, contextMenuActions, emptyMessage, renderRow,
}: EntryListTabProps<T>) {
  const { t } = useTranslation();
  const { searchQuery, setSearchQuery } = useUIStore(
    useShallow((s) => ({ searchQuery: s.searchQuery, setSearchQuery: s.setSearchQuery }))
  );

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // How many entries the vault setting shows; "Show more" adds
  // one limit each time. A tab switch remounts the list and starts over.
  const limit = useSettingsStore((s) => s.settings.leftList.limit);
  const [pages, setPages] = useState(1);
  // Even without a limit ("all"), not everything is drawn at once: first
  // a chunk, the rest once the list is scrolled there. Thousands of
  // rows would otherwise cost a noticeable redraw on every click (new `activeView`) and at
  // startup.
  const [rendered, setRendered] = useState(RENDER_STEP);
  // A new limit or a new search starts at the first page again.
  useEffect(() => { setPages(1); setRendered(RENDER_STEP); }, [limit, searchQuery]);

  const query = searchQuery.toLowerCase();
  const matching = query ? items.filter((item) => getTitle(item).toLowerCase().includes(query)) : items;
  const visible = matching.slice(0, limit === null ? rendered : limit * pages);
  const hiddenCount = limit === null ? 0 : matching.length - visible.length;
  const hasUnrendered = limit === null && visible.length < matching.length;

  const navRef = useRef<HTMLElement>(null);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(scrollEndTimer.current), []);
  // The scrollbar shows only while the list moves or the pointer is at its edge
  // (`.scrollbar-shown` in index.css). `:hover` cannot do this: a hidden thumb is not
  // repainted when the pointer reaches it. On the element, not in state: neither
  // a scroll nor a mouse move may re-render the whole list.
  const pointerAtEdge = useRef(false);
  const showScrollbarForNow = () => {
    const nav = navRef.current;
    if (!nav) return;
    if (!nav.classList.contains('scrollbar-shown')) setScrollbarShown(nav, true);
    clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      if (!pointerAtEdge.current) setScrollbarShown(nav, false);
    }, SCROLLBAR_LINGER_MS);
  };
  // On the window, not the list: over the scrollbar itself WebKit reports the
  // pointer as having left the list and sends nothing more, so the state just
  // stays "at the edge" until the pointer moves away from it elsewhere.
  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      const nav = navRef.current;
      // A held button may be dragging the thumb: hiding would rebuild the bar under it.
      if (!nav || e.buttons) return;
      const rect = nav.getBoundingClientRect();
      const atEdge = e.clientY >= rect.top && e.clientY <= rect.bottom
        && e.clientX >= rect.right - SCROLLBAR_EDGE_PX && e.clientX <= rect.right + SCROLLBAR_EDGE_PX
        && nav.scrollHeight > nav.clientHeight;
      if (atEdge === pointerAtEdge.current) return;
      pointerAtEdge.current = atEdge;
      showScrollbarForNow();
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only touches refs
  }, []);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Recreated on every growth: a fresh observer reports immediately whether the edge
  // is still visible, so even a tall screen fills up without
  // having to scroll first.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasUnrendered || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) setRendered((n) => n + RENDER_STEP); },
      { root: navRef.current, rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasUnrendered, rendered]);

  const openCtxMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };

  const startRename = (item: T) => {
    setRenameValue(getEditTitle(item));
    setRenamingId(getId(item));
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const item = items.find((it) => getId(it) === renamingId);
    if (item && renameValue.trim()) await onRename(item, renameValue.trim());
    setRenamingId(null);
  };

  const ctxItem = ctxMenu ? items.find((it) => getId(it) === ctxMenu.id) : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Right under the sheet's top edge: the 1px is the sheet's border, so the
          field starts where its surface does and shares a centre line with the
          rail's first button. No divider: the list sits directly on the frame.
          The 13px keep it clear of the list below. No create button here: see the
          rail's plus and the dashboards. */}
      <div className="entry-list-search-row pt-px pb-[13px] px-3 flex-shrink-0 flex items-center">
        <div className="entry-list-search flex-1 flex items-center gap-2 rounded-md px-2.5 h-[30px] min-w-0">
          <Search size={14} className="text-subtle flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sidebar-search-input bg-transparent text-sm text-soft placeholder:text-subtle outline-none w-full selectable"
          />
        </div>
      </div>

      <nav ref={navRef} onScroll={showScrollbarForNow} className="entry-list-nav flex-1 overflow-y-auto py-2 pl-2 pr-1 mr-1">
        {matching.length === 0 ? (
          // Two lines in place of the first entry, without icon and button;
          // the dashboard next to it carries the large empty state.
          <div className="px-2 py-1.5">
            <p className="text-[13px] text-muted">
              {items.length > 0 ? t('sidebar.noResultsFor', { query: searchQuery.trim() }) : emptyMessage}
            </p>
            <p className="text-xs text-subtle">
              {items.length > 0 ? t('sidebar.noResultsHint') : t('sidebar.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {visible.map((item) => {
              const id = getId(item);

              if (renderRow) {
                return (
                  <div key={id}>
                    {renderRow({
                      item,
                      isActive: isActive?.(item) ?? false,
                      isRenaming: renamingId === id,
                      renameValue,
                      setRenameValue,
                      commitRename,
                      cancelRename: () => setRenamingId(null),
                      openCtxMenu: (e) => openCtxMenu(e, id),
                    })}
                  </div>
                );
              }

              const title = getTitle(item);
              const dateStr = getDateStr?.(item);
              const icon = getIcon?.(item);
              const active = isActive?.(item) ?? false;
              const dragHandler = onDragStart;

              if (renamingId === id) {
                return (
                  <div key={id} className={`sidebar-item ${active ? 'active' : ''}`}>
                    {icon}
                    <div className="flex-1 min-w-0">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                        className="w-full bg-transparent text-sm text-soft outline-none selectable truncate"
                      />
                      {dateStr && <div className="entry-list-date text-xs">{dateStr}</div>}
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={id}
                  onPointerDown={dragHandler ? (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    dragHandler(item);
                  } : undefined}
                  onClick={onOpen ? () => onOpen(item) : undefined}
                  onAuxClick={onOpenNewTab ? (e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onOpenNewTab(item);
                    }
                  } : undefined}
                  onContextMenu={(e) => openCtxMenu(e, id)}
                  className={`sidebar-item w-full text-left ${dragHandler ? 'cursor-grab active:cursor-grabbing' : ''} ${active ? 'active' : ''}`}
                >
                  {icon}
                  <div className="flex-1 min-w-0">
                    <div className="entry-list-title truncate">{title}</div>
                    {dateStr && <div className="entry-list-date text-xs truncate">{dateStr}</div>}
                  </div>
                </button>
              );
            })}
            {/* `limit !== null` already follows from `hiddenCount > 0`; only TypeScript does not know that. */}
            {hiddenCount > 0 && limit !== null && (
              <button
                type="button"
                onClick={() => setPages((p) => p + 1)}
                className="entry-list-more"
              >
                {t('sidebar.showMore', { count: Math.min(limit, hiddenCount) })}
              </button>
            )}
            {hasUnrendered && <div ref={sentinelRef} aria-hidden className="h-px" />}
          </div>
        )}
      </nav>

      {ctxMenu && ctxItem && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={contextMenuActions(ctxItem, () => startRename(ctxItem))}
        />
      )}
    </div>
  );
}
