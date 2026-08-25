import { useState, useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, Pencil } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useUIStore } from '../../store/uiStore';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import RichEditor from '../editor/RichEditor';
import TagInput from '../editor/TagInput';
import Dashboard from '../ui/Dashboard';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId } from '../../lib/helpers';
import { format } from 'date-fns';
import type { JournalEntry, MoonPhase } from '../../types';

const MOON_PHASE_ORDER: MoonPhase[] = [
  'new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
  'full', 'waning_gibbous', 'last_quarter', 'waning_crescent',
];

export default function JournalView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, setEditActions, journalPrefs, setJournalPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, setEditActions: s.setEditActions, journalPrefs: s.journalPrefs, setJournalPrefs: s.setJournalPrefs }))
  );
  const { entries, createEntry, duplicateEntry, updateEntry, deleteEntry, restoreEntry, getEntry } = useJournalStore(
    useShallow((s) => ({ entries: s.entries, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);
  const getWikiArticle = useWikiStore((s) => s.getArticle);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const { operations, categories: opCategories } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, categories: s.categories }))
  );

  const entry = activeView.id ? getEntry(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterPhases, setFilterPhases] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedEntryId, setLoadedEntryId] = useState<string | null>(null);

  // Always-fresh refs
  const entryIdRef = useRef<string | undefined>(undefined);
  entryIdRef.current = entry?.id;
  const linkedOpIdsRef = useRef<string[]>(entry?.linked_operation_ids ?? []);
  linkedOpIdsRef.current = entry?.linked_operation_ids ?? [];
  const linkedWikiIdsRef = useRef<string[]>(entry?.linked_wiki_ids ?? []);
  linkedWikiIdsRef.current = entry?.linked_wiki_ids ?? [];

  // Der Editor-Inhalt wird pro Tastendruck in diesen Ref gespiegelt statt in
  // State — ein State-Update haette die komplette View pro Anschlag neu
  // gerendert. Gelesen wird er erst beim Speichern (buildPatch).
  const pendingHtmlRef = useRef('');
  // Cancel verwirft die ungespeicherten letzten Sekunden, indem der Editor
  // ueber den Key frisch vom letzten gespeicherten Stand mountet.
  const [editorEpoch, setEditorEpoch] = useState(0);

  const { triggerAutoSave, cancelAutoSave } = useEntryEditor({
    entityId: entry?.id,
    isEditing,
    ready: !!entry && loadedEntryId === entry.id,
    buildPatch: () => ({ title, content: pendingHtmlRef.current, tags }),
    update: updateEntry,
  });

  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      pendingHtmlRef.current = entry.content;
      setTags(entry.tags ?? []);
      setLoadedEntryId(entry.id);
    } else {
      setLoadedEntryId(null);
    }
  }, [entry?.id]);

  // Sync tags from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (entry) setTags(entry.tags ?? []);
  }, [entry?.tags]);

  // Titel ebenso: ein Rename aus der Sidebar bei offenem Edit-Modus wuerde
  // sonst vom naechsten Autosave zurueckgedreht.
  useEffect(() => {
    if (entry) setTitle(entry.title);
  }, [entry?.title]);

  // Apply tags + operation_ids + wiki_ids from a dropped routine
  useEffect(() => {
    if (!isEditing || !entry) return;
    const handler = (e: Event) => {
      const { tags: routineTags, operation_ids: routineOpIds = [], wiki_ids: routineWikiIds = [] } = (e as CustomEvent<{ tags: string[]; operation_ids: string[]; wiki_ids: string[] }>).detail;
      if (routineTags.length > 0) {
        setTags((prev) => {
          const nextTags = [...new Set([...prev, ...routineTags])];
          triggerAutoSave();
          return nextTags;
        });
      }
      if ((routineOpIds.length > 0 || routineWikiIds.length > 0) && entryIdRef.current) {
        const patch: Partial<import('../../types').JournalEntry> = {};
        if (routineOpIds.length > 0) patch.linked_operation_ids = [...new Set([...linkedOpIdsRef.current, ...routineOpIds])];
        if (routineWikiIds.length > 0) patch.linked_wiki_ids = [...new Set([...linkedWikiIdsRef.current, ...routineWikiIds])];
        updateEntry(entryIdRef.current, patch);
      }
    };
    document.addEventListener('routine-drop', handler);
    return () => document.removeEventListener('routine-drop', handler);
  }, [isEditing, entry?.id, triggerAutoSave, updateEntry]);

  const handleNew = async () => {
    const e = await createEntry();
    setActiveView({ type: 'journal', id: e.id, mode: 'edit' });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newEntry = await duplicateEntry(id);
    if (newEntry) setActiveView({ type: 'journal', id: newEntry.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = entries.find((e) => e.id === id);
    if (!src) return;
    setRenameValue(src.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateEntry(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(id) });
    if (activeView.id === id) setActiveView({ type: 'journal' });
  };

  const handleDone = async () => {
    if (!entry) return;
    cancelAutoSave();
    await updateEntry(entry.id, { title, content: pendingHtmlRef.current, tags });
    setActiveView({ type: 'journal', id: entry.id, mode: 'view' });
  };

  const handleCancel = () => {
    cancelAutoSave();
    if (entry) {
      setTitle(entry.title);
      setTags(entry.tags ?? []);
      pendingHtmlRef.current = entry.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'journal', id: entry!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!entry) return;
    cancelAutoSave();
    const id = entry.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'journal' });
  };

  const handleContentChange = useCallback((html: string) => {
    pendingHtmlRef.current = html;
    triggerAutoSave();
  }, [triggerAutoSave]);

  const editHandlersRef = useRef({ onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
  editHandlersRef.current = { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete };

  useEffect(() => {
    if (!isEditing) return;
    setEditActions({
      onSave: () => editHandlersRef.current.onSave(),
      onCancel: () => editHandlersRef.current.onCancel(),
      onDelete: () => editHandlersRef.current.onDelete(),
    });
    return () => setEditActions(null);
  }, [isEditing]);

  const enterEditMode = () => {
    if (!isEditing && entry) setActiveView({ type: 'journal', id: entry.id, mode: 'edit' });
  };

  // List view
  if (!entry) {
    const { view, sort } = journalPrefs;

    const searchFiltered = search
      ? entries.filter((e) =>
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          e.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
        )
      : entries;

    const phaseFiltered = filterPhases.length === 0
      ? searchFiltered
      : searchFiltered.filter((e) => e.moon_phase != null && filterPhases.includes(e.moon_phase));

    const filtered = phaseFiltered;

    const phaseChips = MOON_PHASE_ORDER
      .filter((p) => entries.some((e) => e.moon_phase === p))
      .map((p) => ({ value: p, label: t(`moonPhase.${p}`), emoji: MOON_PHASE_SYMBOLS[p] }));

    const activeFilterCount = filterPhases.length > 0 ? 1 : 0;

    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'alpha_asc') return a.title.localeCompare(b.title);
      if (sort === 'alpha_desc') return b.title.localeCompare(a.title);
      if (sort === 'category') return (a.moon_phase ?? '').localeCompare(b.moon_phase ?? '');
      if (sort === 'date_asc') return a.created_at.localeCompare(b.created_at);
      return b.created_at.localeCompare(a.created_at); // date_desc
    });

    // Group for timeline (by month) or category sort (by moon phase)
    const grouped: { label: string; items: JournalEntry[] }[] = (() => {
      if (view === 'timeline' || sort === 'category') {
        const map = new Map<string, JournalEntry[]>();
        sorted.forEach((e) => {
          const key = view === 'timeline'
            ? format(new Date(e.created_at), 'MMMM yyyy')
            : t(`moonPhase.${e.moon_phase}`);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(e);
        });
        return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
      }
      return [{ label: '', items: sorted }];
    })();

    const go = (e: JournalEntry) => setActiveView({ type: 'journal', id: e.id, mode: 'view' });

    const renderEntry = (e: JournalEntry) => {
      const icon = MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓';
      if (renamingId === e.id) {
        return view === 'cards' ? (
          <div className="panel-interactive px-4 py-4 text-left">
            <div className="text-2xl mb-2">{icon}</div>
            <input autoFocus value={renameValue} onChange={(ev) => setRenameValue(ev.target.value)}
              onBlur={commitRename} onKeyDown={(ev) => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenamingId(null); }}
              className="text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1" />
            <div className="text-xs text-parchment-500/70">{format(new Date(e.created_at), 'MMM d, yyyy')}</div>
          </div>
        ) : (
          <div className="panel-interactive w-full flex items-center gap-3 px-4 py-3">
            <span className="text-base flex-shrink-0">{icon}</span>
            <input autoFocus value={renameValue} onChange={(ev) => setRenameValue(ev.target.value)}
              onBlur={commitRename} onKeyDown={(ev) => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenamingId(null); }}
              className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
            <span className="text-xs text-parchment-500/70 flex-shrink-0">{format(new Date(e.created_at), 'MMM d, yyyy')}</span>
          </div>
        );
      }
      return view === 'cards' ? (
        <button onClick={() => go(e)} onContextMenu={(ev) => openCtxMenu(ev, e.id)} className="panel-interactive px-4 py-4 text-left">
          <div className="text-2xl mb-2">{icon}</div>
          <div className="text-sm font-medium text-stone-200 truncate mb-1">{e.title}</div>
          <div className="text-xs text-parchment-500/70">{format(new Date(e.created_at), 'MMM d, yyyy')}</div>
          {e.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {e.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-stone-700/60 text-stone-500">{tag}</span>
              ))}
            </div>
          )}
        </button>
      ) : (
        <button onClick={() => go(e)} onContextMenu={(ev) => openCtxMenu(ev, e.id)} className="panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group">
          <span className="text-base flex-shrink-0">{icon}</span>
          <span className="flex-1 text-sm text-stone-300 truncate">{e.title}</span>
          <span className="text-xs text-parchment-500/70 flex-shrink-0">{format(new Date(e.created_at), 'MMM d, yyyy')}</span>
        </button>
      );
    };

    return (
      <Dashboard<JournalEntry>
        title={t('journal.title')}
        primaryAction={{ label: t('journal.newEntry'), onClick: handleNew }}
        view={view}
        sort={sort}
        onView={(v) => setJournalPrefs({ view: v })}
        onSort={(s) => setJournalPrefs({ sort: s })}
        search={search}
        onSearch={setSearch}
        filters={{
          showFilters,
          onToggleFilters: () => setShowFilters((v) => !v),
          activeFilterCount,
          panelProps: {
            chipLabel: t('filters.moonPhase'),
            chips: phaseChips,
            selectedChips: filterPhases,
            onChipToggle: (v) => setFilterPhases((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onClearAll: () => setFilterPhases([]),
          },
        }}
        items={sorted}
        itemKey={(e) => e.id}
        renderItem={renderEntry}
        isEmpty={entries.length === 0}
        emptyState={{ message: t('journal.noEntries'), actionLabel: t('journal.startWriting'), onAction: handleNew }}
        hasNoResults={filtered.length === 0}
        noResultsMessage={t('search.noResults')}
        grouping={
          view === 'timeline' || sort === 'category'
            ? { mode: 'timeline', groups: grouped }
            : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'journal' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.journal')}
          </button>
          <span>{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</span>
          <span>{format(new Date(entry.created_at), 'MMMM d, yyyy')}</span>
          {entry.moon_phase && <span>· {t(`moonPhase.${entry.moon_phase}`)}</span>}
          {isEditing && <span className="text-stone-700 italic ml-1">{t('editor.editing')}</span>}
        </div>
      </div>

      {/* Title — double-click enters edit mode */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0" onDoubleClick={enterEditMode}>
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => { const nextTitle = e.target.value; setTitle(nextTitle); triggerAutoSave(); }}
            placeholder={t('journal.untitled')}
            className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100
                       placeholder-stone-700 outline-none selectable"
          />
        ) : (
          <h1 className="entry-view-title text-2xl font-semibold text-stone-100 cursor-text"
              title={t('editor.doubleClickEdit')}>
            {entry.title || t('journal.untitled')}
          </h1>
        )}
      </div>

      {/* Paradigm + Bannung + Meditation — one row */}
      {(entry.paradigm_id || entry.is_bannung || entry.is_meditation) && (() => {
        const chipCls = 'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors';
        const spanCls = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40 text-stone-400';

        const renderIcon = (icon: string) => icon.startsWith('data:')
          ? <img src={icon} alt="" className="w-3.5 h-3.5 object-cover rounded flex-shrink-0" />
          : <span>{icon}</span>;

        const paradigm = entry.paradigm_id ? getWikiArticle(entry.paradigm_id) : null;
        const bannungArticle = entry.bannung_type_wiki_id ? getWikiArticle(entry.bannung_type_wiki_id) : null;
        const meditationArticle = entry.meditation_type_wiki_id ? getWikiArticle(entry.meditation_type_wiki_id) : null;

        return (
          <div className="px-8 pb-2 flex-shrink-0 flex flex-wrap gap-1.5">
            {paradigm && (() => {
              const icon = paradigm.icon || (wikiCategories.find((c) => c.id === paradigm.category_id)?.emoji ?? getCategoryEmoji(paradigm.category_id));
              return (
                <button onClick={() => setActiveView({ type: 'wiki', id: paradigm.id, mode: 'view' })} className={chipCls}>
                  {renderIcon(icon)}<span>{paradigm.title}</span>
                </button>
              );
            })()}
            {entry.is_bannung && (() => {
              const icon = bannungArticle
                ? (bannungArticle.icon || (wikiCategories.find((c) => c.id === bannungArticle.category_id)?.emoji ?? getCategoryEmoji(bannungArticle.category_id)))
                : '🚫';
              const label = bannungArticle ? bannungArticle.title : 'Bannung';
              return bannungArticle
                ? <button onClick={() => setActiveView({ type: 'wiki', id: bannungArticle.id, mode: 'view' })} className={chipCls}>{renderIcon(icon)}<span>{label}</span></button>
                : <span className={spanCls}>{renderIcon(icon)}<span>{label}</span></span>;
            })()}
            {entry.is_meditation && (() => {
              const icon = meditationArticle
                ? (meditationArticle.icon || (wikiCategories.find((c) => c.id === meditationArticle.category_id)?.emoji ?? getCategoryEmoji(meditationArticle.category_id)))
                : '🧘';
              const label = meditationArticle ? meditationArticle.title : 'Meditation';
              return (
                <>
                  {meditationArticle
                    ? <button onClick={() => setActiveView({ type: 'wiki', id: meditationArticle.id, mode: 'view' })} className={chipCls}>{renderIcon(icon)}<span>{label}</span></button>
                    : <span className={spanCls}>{renderIcon(icon)}<span>{label}</span></span>}
                  {entry.meditation_duration != null && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40 text-stone-400">
                      <span>⏱</span><span>{entry.meditation_duration} min</span>
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        );
      })()}

      {/* Linked operations chips */}
      {(entry.linked_operation_ids ?? []).length > 0 && (
        <div className="px-8 pb-2 flex-shrink-0 flex flex-wrap gap-1.5">
          {(entry.linked_operation_ids ?? []).map((opId) => {
            const op = operations.find((o) => o.id === opId);
            if (!op) return null;
            const cat = opCategories.find((c) => c.id === op.category_id);
            const opIcon = op.icon || cat?.emoji || '⚡';
            return (
              <button
                key={opId}
                onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
              >
                {opIcon.startsWith('data:')
                  ? <img src={opIcon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
                  : <span>{opIcon}</span>}
                <span>{op.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Linked wiki chips */}
      {(entry.linked_wiki_ids ?? []).length > 0 && (
        <div className="px-8 pb-2 flex-shrink-0 flex flex-wrap gap-1.5">
          {(entry.linked_wiki_ids ?? []).map((wikiId) => {
            const article = getWikiArticle(wikiId);
            if (!article || article.category_id === 'paradigm') return null;
            const cat = wikiCategories.find((c) => c.id === article.category_id);
            const icon = cat?.emoji ?? getCategoryEmoji(article.category_id);
            return (
              <button
                key={wikiId}
                onClick={() => setActiveView({ type: 'wiki', id: article.id, mode: 'view' })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
              >
                <span>{icon}</span>
                <span>{article.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tags */}
      <div className="px-8 pb-3 flex-shrink-0" onDoubleClick={enterEditMode}>
        <TagInput
          tags={tags}
          onChange={(newTags) => { setTags(newTags); triggerAutoSave(); }}
          readOnly={true}
        />
      </div>

      {/* Editor — double-click enters edit mode */}
      <div className="flex-1 overflow-hidden px-8 pb-8" onDoubleClick={enterEditMode}>
        {loadedEntryId === entry.id && (
          <RichEditor
            key={`${entry.id}:${editorEpoch}`}
            initialContent={entry.content}
            placeholder={t('journal.placeholder')}
            onChange={handleContentChange}
            editable={isEditing}
          />
        )}
      </div>
    </div>
  );
}
