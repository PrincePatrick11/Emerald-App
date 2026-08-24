import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import ContextMenu, { type ContextMenuAction } from './ContextMenu';
import Button from './Button';

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
  getDateStr?: (item: T) => string | null | undefined;
  getIcon?: (item: T) => ReactNode;
  isActive?: (item: T) => boolean;
  onOpen?: (item: T) => void;
  onOpenNewTab?: (item: T) => void;
  onDragStart?: (item: T) => void;
  /** Per-item drag gate — lets a mixed list keep the grab cursor off rows that cannot be dragged. */
  canDrag?: (item: T) => boolean;
  onRename: (item: T, newTitle: string) => void | Promise<void>;
  contextMenuActions: (item: T, startRename: () => void) => ContextMenuAction[];
  emptyMessage: string;
  /** Return the created item to immediately drop it into rename mode (e.g. Tasks, which has no separate edit view). */
  onCreate?: () => void | T | Promise<void | T>;
  createTitle?: string;
  /** Fully custom row content (both normal and renaming state). Overrides getIcon/onOpen/onOpenNewTab/onDragStart for rendering — search, empty-state, and the context menu popup stay centrally handled. `isActive` is not overridden but handed to the row, which decides how to show it. */
  renderRow?: (args: RenderRowArgs<T>) => ReactNode;
}

export default function EntryListTab<T>({
  items, getId, getTitle, getDateStr, getIcon, isActive, onOpen, onOpenNewTab, onDragStart, canDrag,
  onRename, contextMenuActions, emptyMessage, onCreate, createTitle, renderRow,
}: EntryListTabProps<T>) {
  const { t } = useTranslation();
  const { searchQuery, setSearchQuery } = useUIStore();

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const filtered = items.filter((item) => getTitle(item).toLowerCase().includes(searchQuery.toLowerCase()));

  const openCtxMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };

  const startRename = (item: T) => {
    setRenameValue(getTitle(item));
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
      <div className="sidebar-search px-2 py-2 border-b border-stone-700/60 flex-shrink-0 flex items-center gap-1.5">
        <div className="sidebar-search-inner flex-1 flex items-center gap-2 bg-stone-700/40 rounded-md px-2.5 py-1.5 min-w-0">
          <Search size={14} className="text-stone-500 flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sidebar-search-input bg-transparent text-sm text-stone-300 placeholder-stone-600 outline-none w-full selectable"
          />
        </div>
        {onCreate && (
          <Button
            tone="neutral"
            compact
            onClick={async () => {
              const created = await onCreate();
              if (created) startRename(created);
            }}
            title={createTitle}
            aria-label={createTitle}
            className="flex-shrink-0"
          >
            <Plus size={14} />
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-stone-600 px-2 py-2">{emptyMessage}</p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((item) => {
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
              const dragHandler = onDragStart && (canDrag?.(item) ?? true) ? onDragStart : undefined;

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
                      {dateStr && <div className="text-xs text-stone-600 mt-0.5">{dateStr}</div>}
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
                    <div className="truncate">{title}</div>
                    {dateStr && <div className="text-xs text-stone-600 mt-0.5 truncate">{dateStr}</div>}
                  </div>
                </button>
              );
            })}
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
