import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, BookOpen, Library, Check, X, Search, Wand2, Pencil, Trash2 } from 'lucide-react';
import { useTagStore } from '../../store/tagStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import ContextMenu from '../ui/ContextMenu';

const TAG_COLORS = [
  '#00e699', '#8347ff', '#3b82f6', '#f43f5e',
  '#f59e0b', '#06b6d4', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#84cc16', '#78716c',
];

export default function TagsView() {
  const { t } = useTranslation();
  const { tags, fetchTags, updateTag, deleteTag, restoreTag } = useTagStore();
  const pushUndo = useUndoStore((s) => s.push);
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const { operations, categories: opCategories } = useOperationStore();
  const setActiveView = useUIStore((s) => s.setActiveView);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ tagId: string; tagName: string; x: number; y: number } | null>(null);

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    if (!colorPickerId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside a color picker
      if (target.closest('[data-color-picker]')) return;
      setColorPickerId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerId]);

  // Count entries per tag
  const countMap: Record<string, number> = {};
  for (const tag of tags) {
    const j = entries.filter((e) => e.tags?.includes(tag.name)).length;
    const w = articles.filter((a) => a.tags?.includes(tag.name)).length;
    const o = operations.filter((op) => op.tags?.includes(tag.name)).length;
    countMap[tag.name] = j + w + o;
  }

  // Filtered results when a tag is selected
  const filteredEntries = selectedTag
    ? entries.filter((e) => e.tags?.includes(selectedTag))
    : [];
  const filteredArticles = selectedTag
    ? articles.filter((a) => a.tags?.includes(selectedTag))
    : [];
  const filteredOperations = selectedTag
    ? operations.filter((op) => op.tags?.includes(selectedTag))
    : [];

  const startEdit = (tag: { id: string; name: string }) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const saveEdit = async (id: string) => {
    if (editName.trim()) await updateTag(id, { name: editName.trim() });
    setEditingId(null);
  };

  const handleDelete = async (tag: { id: string; name: string }) => {
    if (confirmDeleteName !== tag.name) {
      setConfirmDeleteName(tag.name);
      return;
    }
    setConfirmDeleteName(null);
    await deleteTag(tag.name);
    if (selectedTag === tag.name) setSelectedTag(null);
    pushUndo({
      id: crypto.randomUUID(),
      description: t('undo.tagDeleted'),
      undo: () => restoreTag(tag.id),
    });
  };

  return (
    <div className="flex h-full">
      {/* Tag list */}
      <div className="w-64 flex-shrink-0 border-r border-stone-700/60 flex flex-col">
        <div className="px-4 py-5 border-b border-stone-700/60">
          <div className="flex items-center gap-2 mb-3">
            <Tag size={16} className="text-stone-500" />
            <h1 className="text-sm font-semibold text-stone-200">{t('nav.tags')}</h1>
          </div>
          <div className="flex items-center gap-2 bg-stone-700/40 rounded-lg px-3 py-2">
            <Search size={12} className="text-stone-500 flex-shrink-0" />
            <input
              type="text"
              placeholder={t('tags.search')}
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              className="bg-transparent text-xs text-stone-300 placeholder-stone-600 outline-none w-full selectable"
            />
            {tagSearch && (
              <button onClick={() => setTagSearch('')} className="text-stone-600 hover:text-stone-400">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {tags.length === 0 && (
            <p className="text-xs text-stone-600 px-4 py-3">{t('tags.none')}</p>
          )}

          {/* "All" option */}
          {tags.length > 0 && (
            <button
              onClick={() => setSelectedTag(null)}
              className={`sidebar-item w-full ${selectedTag === null ? 'active' : ''}`}
            >
              <span className="text-xs">{t('tags.all')}</span>
            </button>
          )}

          {tags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase())).map((tag) => (
            <div key={tag.id} className="group relative">
              {editingId === tag.id ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(tag.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 bg-stone-700/50 text-xs text-stone-200 px-2 py-1 rounded outline-none selectable"
                  />
                  <button onClick={() => saveEdit(tag.id)} className="btn-ghost text-jade-400">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="btn-ghost">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  className={`sidebar-item w-full ${selectedTag === tag.name ? 'active' : ''}`}
                  onClick={() => { setSelectedTag(tag.name); setColorPickerId(null); }}
                  onDoubleClick={() => startEdit(tag)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ tagId: tag.id, tagName: tag.name, x: e.clientX, y: e.clientY }); }}
                >
                  {/* Color dot — click opens color picker */}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorPickerId(colorPickerId === tag.id ? null : tag.id);
                    }}
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-white/30 transition-all"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 truncate text-xs text-left">{tag.name}</span>
                  {confirmDeleteName === tag.name ? (
                    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className="text-xs text-stone-400">Sure?</span>
                      <span onClick={() => handleDelete(tag)} className="text-xs text-red-400 hover:text-red-300 cursor-pointer px-1">Yes</span>
                      <span onClick={() => setConfirmDeleteName(null)} className="text-xs text-stone-500 hover:text-stone-300 cursor-pointer">No</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-stone-700 text-xs group-hover:hidden">{countMap[tag.name] ?? 0}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); handleDelete(tag); }}
                        className="hidden group-hover:flex text-stone-600 hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <X size={12} />
                      </span>
                    </>
                  )}
                </button>
              )}

              {/* Color picker dropdown — anchored below the dot */}
              {colorPickerId === tag.id && (
                <div
                  data-color-picker
                  className="absolute left-2 top-full mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2 flex flex-wrap gap-1.5 w-40"
                >
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { updateTag(tag.id, { color: c }); setColorPickerId(null); }}
                      className="w-5 h-5 rounded-full hover:scale-125 transition-transform"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Results panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedTag === null ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Tag size={36} className="text-stone-700" />
            <p className="text-stone-600 text-sm">{t('tags.selectHint')}</p>
            <p className="text-stone-700 text-xs">{t('tags.doubleClickEdit')}</p>
          </div>
        ) : (
          <div className="max-w-xl space-y-4">
            <h2 className="text-sm font-semibold text-stone-300">
              #{selectedTag}
              <span className="ml-2 text-stone-600 font-normal">
                {filteredEntries.length + filteredArticles.length + filteredOperations.length} {t('tags.results')}
              </span>
            </h2>

            {filteredEntries.length === 0 && filteredArticles.length === 0 && filteredOperations.length === 0 && (
              <p className="text-xs text-stone-600">{t('tags.noResults')}</p>
            )}

            {filteredEntries.map((e) => (
              <button
                key={e.id}
                onClick={() => setActiveView({ type: 'journal', id: e.id, mode: 'view' })}
                className="panel-interactive w-full text-left px-4 py-3 flex items-center gap-3"
              >
                <BookOpen size={14} className="text-stone-500 flex-shrink-0" />
                <div>
                  <div className="text-sm text-stone-200">{e.title}</div>
                  <div className="text-xs text-parchment-500/70 mt-0.5">{t('nav.journal')}</div>
                </div>
              </button>
            ))}

            {filteredArticles.map((a) => (
              <button
                key={a.id}
                onClick={() => setActiveView({ type: 'wiki', id: a.id, mode: 'view' })}
                className="panel-interactive w-full text-left px-4 py-3 flex items-center gap-3"
              >
                <Library size={14} className="text-stone-500 flex-shrink-0" />
                <div>
                  <div className="text-sm text-stone-200">{a.title}</div>
                  <div className="text-xs text-parchment-500/70 mt-0.5">{t('nav.wiki')}</div>
                </div>
              </button>
            ))}

            {filteredOperations.map((op) => {
              const cat = opCategories.find((c) => c.id === op.category_id);
              return (
                <button
                  key={op.id}
                  onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                  className="panel-interactive w-full text-left px-4 py-3 flex items-center gap-3"
                >
                  <Wand2 size={14} className="text-stone-500 flex-shrink-0" />
                  <div>
                    <div className="text-sm text-stone-200">{op.title}</div>
                    <div className="text-xs text-parchment-500/70 mt-0.5">{cat?.emoji} {cat ? (cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name) : t('nav.operations')}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            {
              label: t('contextMenu.rename'),
              icon: <Pencil size={12} />,
              onClick: () => {
                const tag = tags.find((t) => t.id === ctxMenu.tagId);
                if (tag) startEdit(tag);
              },
            },
            {
              label: t('contextMenu.delete'),
              icon: <Trash2 size={12} />,
              danger: true,
              onClick: () => {
                const tag = tags.find((t) => t.id === ctxMenu.tagId);
                if (tag) handleDelete(tag);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
