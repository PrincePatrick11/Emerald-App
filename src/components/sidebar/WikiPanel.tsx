import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import { getCategoryEmoji } from '../wiki/WikiList';
import ContextMenu from '../ui/ContextMenu';
import type { WikiArticle } from '../../types';

export default function WikiPanel({
  articles,
  onNavigate,
  wikiSubTab,
}: {
  articles: WikiArticle[];
  onNavigate: (view: any) => void;
  wikiSubTab: string | null;
}) {
  const { t } = useTranslation();
  const { setWikiSubTab } = useUIStore();
  const { wikiCategories, createArticle, updateArticle, deleteArticle, restoreArticle } = useWikiStore();
  const pushUndo = useUndoStore((s) => s.push);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activeTab = wikiSubTab ?? 'all';
  const filtered = activeTab === 'all'
    ? articles
    : articles.filter((a) => a.category === activeTab);

  const activeCat = activeTab !== 'all' ? wikiCategories.find((c) => c.id === activeTab) : null;
  const activeCategoryLabel = activeCat
    ? `${activeCat.emoji} ${activeCat.is_builtin ? t(`wiki.categories.${activeCat.id}`) : activeCat.name}`
    : t('operations.all');

  const handleNew = async () => {
    const category = activeTab !== 'all' ? activeTab : (wikiCategories[0]?.id ?? 'other');
    const article = await createArticle(category);
    onNavigate({ type: 'wiki', id: article.id, mode: 'edit' });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-0.5">
        <button
          onClick={() => setWikiSubTab(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            activeTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-500 hover:text-stone-300'
          }`}
        >
          {t('operations.all')}
        </button>
        {wikiCategories.filter((cat) => articles.some((a) => a.category === cat.id)).map((cat) => (
          <button
            key={cat.id}
            onClick={() => setWikiSubTab(cat.id)}
            title={cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name}
            className={`px-2 py-1 rounded text-sm transition-colors ${
              activeTab === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            {cat.emoji}
          </button>
        ))}
      </div>

      {/* Category heading */}
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 px-2 pt-1">
        {activeCategoryLabel}
      </p>

      {/* New button */}
      <button
        onClick={handleNew}
        className="sidebar-item w-full text-left text-stone-600 hover:text-stone-300"
      >
        <span className="w-5 text-center flex-shrink-0 text-base leading-none">+</span>
        <span className="flex-1 truncate text-xs">{t('wiki.newArticle')}</span>
      </button>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-xs text-stone-600 px-2 py-2">{t('wiki.noArticles')}</p>
      ) : (
        <div className="space-y-0.5">
          {filtered.map((article) => {
            const cat = wikiCategories.find((c) => c.id === article.category);
            return (
              <div
                key={article.id}
                onPointerDown={(e) => {
                  if (renamingId === article.id) return;
                  e.preventDefault();
                  setDragItem({ id: article.id, entryType: 'wiki', label: article.title, category: article.category });
                }}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: article.id, x: e.clientX, y: e.clientY }); }}
                className="sidebar-item cursor-grab active:cursor-grabbing group"
                onClick={() => { if (renamingId !== article.id) onNavigate({ type: 'wiki', id: article.id, mode: 'view' }); }}
              >
                {article.icon
                  ? <img src={article.icon} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                  : <span className="w-5 text-center flex-shrink-0 text-base">{cat?.emoji ?? getCategoryEmoji(article.category)}</span>
                }
                {renamingId === article.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={async () => { if (renameValue.trim()) await updateArticle(article.id, { title: renameValue.trim() }); setRenamingId(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-transparent outline-none text-xs text-stone-300 border-b border-stone-600"
                  />
                ) : (
                  <span className="flex-1 truncate text-xs">{article.title}</span>
                )}
                <span className="text-stone-700 text-xs opacity-0 group-hover:opacity-100 transition-opacity select-none">
                  ⠿
                </span>
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
                const src = articles.find((a) => a.id === ctxMenu.id);
                if (!src) return;
                const newArt = await createArticle(src.category);
                await updateArticle(newArt.id, {
                  title: src.title + ' (Copy)', content: src.content,
                  tags: src.tags, icon: src.icon ?? undefined, cover_image: src.cover_image ?? undefined,
                });
                onNavigate({ type: 'wiki', id: newArt.id, mode: 'view' });
              },
            },
            {
              label: t('contextMenu.rename'),
              icon: <Pencil size={12} />,
              onClick: () => {
                const src = articles.find((a) => a.id === ctxMenu.id);
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
                await deleteArticle(id);
                pushUndo({ id: crypto.randomUUID(), description: t('undo.articleDeleted'), undo: () => restoreArticle(id) });
              },
            },
          ]}
        />
      )}
    </div>
  );
}
