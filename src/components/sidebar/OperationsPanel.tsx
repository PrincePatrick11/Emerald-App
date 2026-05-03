import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import ContextMenu from '../ui/ContextMenu';

export default function OperationsPanel({ onNavigate }: { onNavigate: (view: any) => void }) {
  const { t } = useTranslation();
  const { categories, operations, createOperation, updateOperation, deleteOperation, restoreOperation } = useOperationStore();
  const { operationsSubTab, setOperationsSubTab } = useUIStore();
  const pushUndo = useUndoStore((s) => s.push);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activeTab = operationsSubTab ?? 'all';

  const filtered = activeTab === 'all'
    ? operations
    : operations.filter((o) => o.category_id === activeTab);

  const handleNew = async () => {
    const categoryId = activeTab === 'all' && categories.length > 0
      ? categories[0].id
      : activeTab !== 'all' ? activeTab : (categories[0]?.id ?? '');
    if (!categoryId) return;
    const op = await createOperation(categoryId);
    onNavigate({ type: 'operations', id: op.id, mode: 'edit' });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-0.5">
        <button
          onClick={() => setOperationsSubTab(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            activeTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-500 hover:text-stone-300'
          }`}
        >
          {t('operations.all')}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setOperationsSubTab(cat.id)}
            title={cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name}
            className={`px-2 py-1 rounded text-sm transition-colors ${
              activeTab === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            {cat.emoji}
          </button>
        ))}
      </div>

      {/* Category heading */}
      {(() => {
        const activeCat = activeTab !== 'all' ? categories.find((c) => c.id === activeTab) : null;
        return (
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 px-2 pt-1">
            {activeCat
            ? `${activeCat.emoji} ${activeCat.is_builtin ? t(`operations.categories.${activeCat.id}`) : activeCat.name}`
            : t('operations.all')}
          </p>
        );
      })()}

      {/* New button */}
      <button
        onClick={handleNew}
        className="sidebar-item w-full text-left text-stone-600 hover:text-stone-300"
      >
        <span className="w-5 text-center flex-shrink-0 text-base leading-none">+</span>
        <span className="flex-1 truncate text-xs">{t('operations.new')}</span>
      </button>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-xs text-stone-600 px-2 py-2">{t('operations.none')}</p>
      ) : (
        <div className="space-y-0.5">
          {filtered.map((op) => {
            const cat = categories.find((c) => c.id === op.category_id);
            const opIcon = op.icon || cat?.emoji || '⚡';
            return (
              <div
                key={op.id}
                onPointerDown={(e) => {
                  if (renamingId === op.id) return;
                  e.preventDefault();
                  setDragItem({ id: op.id, entryType: 'operation', label: op.title, category: cat?.emoji });
                }}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: op.id, x: e.clientX, y: e.clientY }); }}
                onClick={() => { if (renamingId !== op.id) onNavigate({ type: 'operations', id: op.id, mode: 'view' }); }}
                className="sidebar-item cursor-grab active:cursor-grabbing"
              >
                {opIcon.startsWith('data:')
                  ? <img src={opIcon} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                  : <span className="w-5 text-center flex-shrink-0 text-base">{opIcon}</span>}
                {renamingId === op.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={async () => { if (renameValue.trim()) await updateOperation(op.id, { title: renameValue.trim() }); setRenamingId(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-transparent outline-none text-xs text-stone-300 border-b border-stone-600"
                  />
                ) : (
                  <span className="flex-1 truncate text-xs">{op.title}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            {
              label: t('contextMenu.duplicate'),
              icon: <Copy size={12} />,
              onClick: async () => {
                const src = operations.find((o) => o.id === ctxMenu.id);
                if (!src) return;
                const newOp = await createOperation(src.category_id);
                await updateOperation(newOp.id, {
                  title: src.title + ' (Copy)', content: src.content,
                  tags: src.tags, is_active: src.is_active, end_date: src.end_date,
                  version: src.version, icon: src.icon ?? undefined, cover_image: src.cover_image ?? undefined,
                });
                onNavigate({ type: 'operations', id: newOp.id, mode: 'view' });
              },
            },
            {
              label: t('contextMenu.rename'),
              icon: <Pencil size={12} />,
              onClick: () => {
                const src = operations.find((o) => o.id === ctxMenu.id);
                if (!src) return;
                setRenameValue(src.title);
                setRenamingId(ctxMenu.id);
              },
            },
            {
              label: t('contextMenu.delete'),
              icon: <Trash2 size={12} />,
              danger: true,
              onClick: async () => {
                const id = ctxMenu.id;
                await deleteOperation(id);
                pushUndo({ id: crypto.randomUUID(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
              },
            },
          ]}
        />
      )}
    </div>
  );
}
