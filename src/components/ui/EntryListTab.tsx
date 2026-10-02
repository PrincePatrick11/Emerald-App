import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import ContextMenu, { type ContextMenuAction } from './ContextMenu';

/** Zeilen je Schritt, wenn die Liste ohne Limit („alle") läuft. */
const RENDER_STEP = 100;

export interface RenderRowArgs<T> {
  item: T;
  /** Das Ergebnis von `isActive` — damit eine eigene Zeile die Auswahl
   *  markieren kann, ohne dieselbe Bedingung ein zweites Mal zu formulieren. */
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
  /** Womit das Umbenennen beginnt — der gespeicherte Titel, ohne „Unbenannt…". Fehlt es, `getTitle`. */
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
  // Wie viele Einträge die Einstellung des Vaults zeigt; „Mehr anzeigen" legt
  // je ein Limit nach. Ein Tab-Wechsel montiert die Liste neu und beginnt von vorn.
  const limit = useSettingsStore((s) => s.settings.leftList.limit);
  const [pages, setPages] = useState(1);
  // Ohne Limit („alle") wird trotzdem nicht alles auf einmal gezeichnet: erst
  // ein Stück, der Rest, sobald die Liste dorthin gescrollt wird. Tausende
  // Zeilen kosteten sonst bei jedem Klick (neue `activeView`) und beim Start
  // ein spürbares Neuzeichnen.
  const [rendered, setRendered] = useState(RENDER_STEP);
  // Ein neues Limit oder eine neue Suche beginnt wieder bei der ersten Seite.
  useEffect(() => { setPages(1); setRendered(RENDER_STEP); }, [limit, searchQuery]);

  const query = searchQuery.toLowerCase();
  const matching = query ? items.filter((item) => getTitle(item).toLowerCase().includes(query)) : items;
  const visible = matching.slice(0, limit === null ? rendered : limit * pages);
  const hiddenCount = limit === null ? 0 : matching.length - visible.length;
  const hasUnrendered = limit === null && visible.length < matching.length;

  const navRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Neu bei jedem Wachsen: ein frischer Observer meldet sofort, ob der Rand
  // noch sichtbar ist — so füllt sich auch ein hoher Bildschirm, ohne dass
  // erst gescrollt werden muss.
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
      {/* 56px hoch wie die Aktionsleiste rechts (`SidebarActionBar`), ohne
          Trennlinie: die Liste liegt direkt auf dem Rahmen. Anlegen laeuft
          ueber die Hauptaktion im rechten Panel, nicht ueber einen Knopf hier. */}
      <div className="entry-list-search-row h-14 px-3 flex-shrink-0 flex items-center">
        <div className="entry-list-search flex-1 flex items-center gap-2 rounded-md px-2.5 h-[30px] min-w-0">
          <Search size={14} className="text-stone-500 flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sidebar-search-input bg-transparent text-sm text-stone-300 placeholder-stone-600 outline-none w-full selectable"
          />
        </div>
      </div>

      <nav ref={navRef} className="entry-list-nav flex-1 overflow-y-auto py-2 px-2">
        {matching.length === 0 ? (
          // Zwei Zeilen an der Stelle des ersten Eintrags, ohne Icon und Knopf —
          // das Dashboard daneben trägt den großen Leer-Zustand.
          <div className="px-2 py-1.5">
            <p className="text-[13px] text-stone-400">
              {items.length > 0 ? t('sidebar.noResultsFor', { query: searchQuery.trim() }) : emptyMessage}
            </p>
            <p className="text-xs text-stone-600">
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
                        className="w-full bg-transparent text-sm text-stone-300 outline-none selectable truncate"
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
            {/* `limit !== null` folgt schon aus `hiddenCount > 0` — nur TypeScript weiß das nicht. */}
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
