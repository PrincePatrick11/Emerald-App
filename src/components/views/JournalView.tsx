import { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, Pencil } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useUIStore } from '../../store/uiStore';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import RichEditor from '../editor/RichEditor';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId } from '../../lib/helpers';
import { formatEntryDate, formatEntryDateLong } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import type { JournalEntry, MoonPhase } from '../../types';

const MOON_PHASE_ORDER: MoonPhase[] = [
  'new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
  'full', 'waning_gibbous', 'last_quarter', 'waning_crescent',
];

export default function JournalView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, journalPrefs, setJournalPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, journalPrefs: s.journalPrefs, setJournalPrefs: s.setJournalPrefs }))
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
  const { collapsed: collapsedPhases, toggle: togglePhaseCollapse } = useCollapsedSet('journal');
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

  // Cancel verwirft die ungespeicherten letzten Sekunden, indem der Editor
  // ueber den Key frisch vom letzten gespeicherten Stand mountet.
  const [editorEpoch, setEditorEpoch] = useState(0);

  const { triggerAutoSave, cancelAutoSave, contentRef, handleContentChange } = useEntryEditor({
    entityId: entry?.id,
    isEditing,
    ready: !!entry && loadedEntryId === entry.id,
    buildPatch: (content) => ({ title, content, tags }),
    update: updateEntry,
  });

  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      contentRef.current = entry.content;
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
    await updateEntry(entry.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'journal', id: entry.id, mode: 'view' });
  };

  const handleCancel = () => {
    cancelAutoSave();
    if (entry) {
      setTitle(entry.title);
      setTags(entry.tags ?? []);
      contentRef.current = entry.content;
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

  useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });

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
      : searchFiltered.filter((e) =>
          (e.moon_phase != null && filterPhases.includes(e.moon_phase)) ||
          // Der „Ohne Mondphase"-Chip wählt Einträge ohne Phase aus.
          (filterPhases.includes(UNCATEGORIZED_KEY) && e.moon_phase == null));

    const filtered = phaseFiltered;

    // Alle Phasen anbieten, auch die ohne Einträge — wie die Kategorie-Chips
    // in Wiki/Operations/Tasks. „Ohne Mondphase" nur, wenn es solche Einträge gibt.
    const phaseChips = [
      ...MOON_PHASE_ORDER.map((p) => ({ value: p, label: t(`moonPhase.${p}`), emoji: MOON_PHASE_SYMBOLS[p] })),
      ...(entries.some((e) => e.moon_phase == null)
        ? [{ value: UNCATEGORIZED_KEY, label: t('journal.noPhase'), emoji: '📓' }]
        : []),
    ];

    const activeFilterCount = filterPhases.length > 0 ? 1 : 0;

    const sorted = sortItems(filtered, sort, {
      date: (e) => e.created_at,
      // 'category' heißt im Journal: nach Mondphase.
      category: (e) => e.moon_phase ?? '',
    });

    const timelineGroups = groupByMonth(sorted, (e) => e.created_at);

    // „Kategorie" heißt im Journal: nach Mondphase — gerendert mit denselben
    // Gruppenköpfen wie die Kategorie-Gruppen der anderen Module. Die Phasen
    // sind fest (Mondzyklus-Reihenfolge), abgewählte werden ausgeblendet;
    // der Waisen-Bucket fängt Einträge ohne Phase auf.
    const visiblePhases = filterPhases.length > 0
      ? MOON_PHASE_ORDER.filter((p) => filterPhases.includes(p))
      : MOON_PHASE_ORDER;
    const phaseGroups: DashboardGroup<JournalEntry>[] = groupByCategory(
      sorted, visiblePhases.map((p) => ({ id: p })), (e) => e.moon_phase ?? '',
      (c) => t(`moonPhase.${c.id}`), t('journal.noPhase'),
    );

    const renderPhaseHeader = (group: DashboardGroup<JournalEntry>) => (
      <CollapsibleGroupHeader
        collapsed={collapsedPhases.has(group.key!)}
        onToggleCollapse={() => togglePhaseCollapse(group.key!)}
        emoji={group.key === UNCATEGORIZED_KEY ? '📓' : MOON_PHASE_SYMBOLS[group.key as MoonPhase]}
        label={group.label}
        meta={<span className="text-xs text-stone-500">({group.items.length})</span>}
      />
    );

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
            <div className="text-xs text-parchment-500/70">{formatEntryDate(e.created_at)}</div>
          </div>
        ) : (
          <div className="panel-interactive w-full flex items-center gap-3 px-4 py-3">
            <span className="text-base flex-shrink-0">{icon}</span>
            <input autoFocus value={renameValue} onChange={(ev) => setRenameValue(ev.target.value)}
              onBlur={commitRename} onKeyDown={(ev) => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenamingId(null); }}
              className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
            <span className="text-xs text-parchment-500/70 flex-shrink-0">{formatEntryDate(e.created_at)}</span>
          </div>
        );
      }
      return view === 'cards' ? (
        <button onClick={() => go(e)} onContextMenu={(ev) => openCtxMenu(ev, e.id)} className="panel-interactive px-4 py-4 text-left">
          <div className="text-2xl mb-2">{icon}</div>
          <div className="text-sm font-medium text-stone-200 truncate mb-1">{e.title}</div>
          <div className="text-xs text-parchment-500/70">{formatEntryDate(e.created_at)}</div>
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
          <span className="text-xs text-parchment-500/70 flex-shrink-0">{formatEntryDate(e.created_at)}</span>
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
            onAllChips: () => setFilterPhases([]),
            onClearAll: () => setFilterPhases([]),
          },
        }}
        items={sorted}
        itemKey={(e) => e.id}
        renderItem={renderEntry}
        isEmpty={entries.length === 0}
        emptyState={{ message: t('journal.noEntries'), actionLabel: t('journal.startWriting'), onAction: handleNew }}
        // Bei aktivem Phasen-Filter ohne Suchtext trotzdem die Gruppierung
        // rendern: eine ausgewählte leere Phase soll ihren Kopf samt
        // Leer-Hinweis zeigen, nicht „Keine Ergebnisse".
        hasNoResults={filtered.length === 0 && !(sort === 'category' && view !== 'timeline' && filterPhases.length > 0 && !search)}
        noResultsMessage={t('search.noResults')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : sort === 'category'
              ? {
                  mode: 'category',
                  groups: phaseGroups,
                  renderGroupHeader: renderPhaseHeader,
                  renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('journal.noEntries')}</p>,
                  isGroupCollapsed: (g) => collapsedPhases.has(g.key!),
                }
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

  // Paradigma-/Bannung-/Meditations-Chips plus verknuepfte Operationen und
  // Wiki-Artikel — der Journal-eigene Inhalt des belowTitle-Slots.
  const propertyChips = (
    <>
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

    </>
  );

  return (
    <EntryDetailFrame
      module="journal"
      isEditing={isEditing}
      onEnterEditMode={enterEditMode}
      breadcrumbMeta={
        <>
          <span>{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</span>
          <span>·</span>
          <span>{formatEntryDateLong(entry.created_at)}</span>
          {entry.moon_phase && <><span>·</span><span>{t(`moonPhase.${entry.moon_phase}`)}</span></>}
        </>
      }
      title={isEditing ? title : entry.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      belowTitle={propertyChips}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedEntryId === entry.id && (
        <RichEditor
          key={`${entry.id}:${editorEpoch}`}
          initialContent={entry.content}
          placeholder={t('journal.placeholder')}
          onChange={handleContentChange}
          editable={isEditing}
        />
      )}
    </EntryDetailFrame>
  );
}
