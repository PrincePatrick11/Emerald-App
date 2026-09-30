import { useState, useEffect } from 'react';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, Pencil } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useUIStore } from '../../store/uiStore';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import { useJournalStore } from '../../store/journalStore';
import { useUndoStore } from '../../store/undoStore';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId } from '../../lib/helpers';
import { MODULES } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { countByCategory, groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import type { JournalEntry, MoonPhase } from '../../types';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import { useSessionState } from '../../store/sessionStore';

export default function JournalView() {
  const { t } = useTranslation();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { activeView, setActiveView, journalPrefs, setJournalPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, journalPrefs: s.journalPrefs, setJournalPrefs: s.setJournalPrefs }))
  );
  const { entries, createEntry, duplicateEntry, updateEntry, deleteEntry, restoreEntry, getEntry } = useJournalStore(
    useShallow((s) => ({ entries: s.entries, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const entry = activeView.id ? getEntry(activeView.id) : null;
  // Eine geladene Sigille mit Sperre „ganzer Eintrag" öffnet nie im Bearbeitungsmodus.
  const locked = !!entry && !!entryBlockSummary(entry.id, entry.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useSessionState('journal.search', '');
  const [filterPhases, setFilterPhases] = useSessionState<string[]>('journal.filter', []);
  const { isCollapsed: isPhaseCollapsed, toggle: togglePhaseCollapse } = useCollapsedSet('journal');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedEntryId, setLoadedEntryId] = useState<string | null>(null);

  // Cancel verwirft die ungespeicherten letzten Sekunden, indem der Editor
  // ueber den Key frisch vom wiederhergestellten Stand mountet.
  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (e: NonNullable<typeof entry>) => ({ title: e.title, content: e.content, tags: e.tags ?? [] });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'journal',
    entityId: entry?.id,
    isEditing,
    ready: !!entry && loadedEntryId === entry.id,
    // Auch, was Cancel wiederherstellt: der Eintrag, wie er beim Betreten des
    // Bearbeitens war — samt den Tags, die die Seitenleiste inzwischen gespeichert hat.
    buildPatch: (content) => ({ title, content, tags }),
    readStored: (id) => {
      const stored = getEntry(id);
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id)?.updated_at,
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

  const handleNew = async () => {
    const e = await createEntry();
    setActiveView({ type: 'journal', id: e.id, mode: 'edit', isNew: true });
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

  const handleCancel = async () => {
    // Ein nie mit „Fertig" bestätigter Eintrag geht, wie jeder gelöschte, in den Papierkorb.
    if (activeView.isNew && entry) return handleDelete();
    cancelAutoSave();
    if (entry) {
      // Nicht auf den Store-Stand zurück — nach dem ersten Debounce-Autosave
      // IST der Store der editierte Stand. restoreOnCancel schreibt den beim
      // Betreten des Edit-Modus gemerkten Stand des Eintrags zurück; die Setter
      // hier fangen den Fall vor dem ersten Autosave ab (Store unverändert,
      // Sync-Effekte laufen nicht).
      const from = (await restoreOnCancel()) ?? fieldsOf(entry);
      setTitle(from.title);
      setTags(from.tags);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'journal', id: entry!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!entry) return;
    // Erst schreiben, was noch aufgeschoben ist: im Papierkorb liegt der letzte Stand.
    await flushAutoSave().catch(console.error);
    const id = entry.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'journal' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: entry ? {
      key: guardKey('journal', entry.id),
      title: () => title.trim() || getEntry(entry.id)?.title.trim() || t('journal.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // List view
  if (!entry) {
    const { view, sort, grouping } = journalPrefs;

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
          // Der „Ohne Mondphase"-Chip wählt Einträge ohne Phase aus — und
          // solche mit einer, die nicht zum Zyklus gehört: die landen auch in
          // der Waisen-Gruppe, der Chip muss sie also erwischen.
          (filterPhases.includes(UNCATEGORIZED_KEY)
            && !MOON_PHASE_ORDER.includes(e.moon_phase as MoonPhase)));

    const filtered = phaseFiltered;

    // Alle acht Phasen anbieten, auch die ohne Einträge — sie sind ein fester
    // Zyklus, keine wachsende Liste; die Gruppen darunter zeigen trotzdem nur
    // die belegten. „Ohne Mondphase" dagegen nur, wenn es solche Einträge
    // gibt — oder solange der Chip ausgewählt ist, sonst bliebe ein Filter
    // wirksam, den nichts mehr anzeigt.
    //
    // Nicht `!e.moon_phase`, sondern die Zugehörigkeit zum Zyklus: ein Import
    // kann eine unbekannte Phase schreiben (emeraldFormat reicht sie
    // ungeprüft durch), und die landet in derselben Waisen-Gruppe.
    const showNoPhaseChip = entries.some((e) => !MOON_PHASE_ORDER.includes(e.moon_phase as MoonPhase))
      || filterPhases.includes(UNCATEGORIZED_KEY);
    // Gezählt über die Suche, ohne den Phasen-Filter selbst.
    const phaseCounts = countByCategory(
      searchFiltered, (p) => MOON_PHASE_ORDER.includes(p as MoonPhase), (e) => e.moon_phase ?? null,
    );
    const phaseChips = [
      ...MOON_PHASE_ORDER.map((p) => ({ value: p, label: t(`moonPhase.${p}`), emoji: MOON_PHASE_SYMBOLS[p], count: phaseCounts.get(p) ?? 0 })),
      ...(showNoPhaseChip ? [{ value: UNCATEGORIZED_KEY, label: t('journal.noPhase'), emoji: '📓', count: phaseCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
    ];

    const activeFilterCount = filterPhases.length > 0 ? 1 : 0;

    const sorted = sortItems(filtered, sort, { date: (e) => e.created_at });

    const timelineGroups = groupByMonth(sorted, (e) => e.created_at);

    // Gruppiert heißt im Journal: nach Mondphase — gerendert mit denselben
    // Gruppenköpfen wie die Kategorie-Gruppen der anderen Module, in fester
    // Zyklus-Reihenfolge. Abgewählte Phasen fallen weg, leere ebenso (das
    // erledigt Dashboard zentral); der Waisen-Bucket fängt Einträge ohne
    // Phase auf.
    const visiblePhases = filterPhases.length > 0
      ? MOON_PHASE_ORDER.filter((p) => filterPhases.includes(p))
      : MOON_PHASE_ORDER;
    const phaseGroups: DashboardGroup<JournalEntry>[] = groupByCategory(
      sorted, visiblePhases.map((p) => ({ id: p })), (e) => e.moon_phase ?? '',
      (c) => t(`moonPhase.${c.id}`), t('journal.noPhase'),
    );

    const renderPhaseHeader = (group: DashboardGroup<JournalEntry>) => (
      <CollapsibleGroupHeader
        collapsed={isPhaseCollapsed(group.key!)}
        onToggleCollapse={() => togglePhaseCollapse(group.key!)}
        emoji={group.key === UNCATEGORIZED_KEY ? '📓' : MOON_PHASE_SYMBOLS[group.key as MoonPhase]}
        label={group.label}
        count={group.items.length}
      />
    );

    const renderEntry = (e: JournalEntry) => {
      const icon = MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓';
      const renaming = renamingId === e.id;
      const renameInput = (className: string) => (
        <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
          onCancel={() => setRenamingId(null)} className={className} />
      );
      return (
        <DashboardItem
          view={{ type: 'journal', id: e.id, mode: 'view' }}
          layout={isCardView(view) ? 'card' : 'row'}
          editing={renaming}
          onContextMenu={(ev) => openCtxMenu(ev, e.id)}
        >
          {isCardView(view) ? (
            <>
              <div className="text-2xl mb-2">{icon}</div>
              {renaming
                ? renameInput('text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1')
                : <div className="text-sm font-medium text-stone-200 truncate mb-1">{displayTitle(t, 'journal', e.title)}</div>}
              <div className="text-xs text-parchment-500/70">{formatEntryDate(e.created_at)}</div>
              {!renaming && e.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {e.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-stone-700/60 text-stone-500">{tag}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <span className="text-base flex-shrink-0">{icon}</span>
              {renaming
                ? renameInput('flex-1 bg-transparent text-sm text-stone-300 outline-none selectable')
                : <span className="flex-1 text-sm text-stone-300 truncate">{displayTitle(t, 'journal', e.title)}</span>}
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{formatEntryDate(e.created_at)}</span>
            </>
          )}
        </DashboardItem>
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
        // Das Journal gruppiert nach Mondphase, nicht nach Kategorie — der
        // Schalter trägt deshalb das Wort, das auch über seinen Filtern steht.
        groupBy={{ value: grouping, onChange: (g) => setJournalPrefs({ grouping: g }), label: t('filters.moonPhase') }}
        search={search}
        onSearch={setSearch}
        filters={{
          activeFilterCount,
          onClearAll: () => setFilterPhases([]),
          panelProps: {
            chipLabel: t('filters.moonPhase'),
            chips: phaseChips,
            selectedChips: filterPhases,
            onChipToggle: (v) => setFilterPhases((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterPhases([]),
            allChipsCount: searchFiltered.length,
          },
        }}
        items={sorted}
        itemKey={(e) => e.id}
        renderItem={renderEntry}
        isEmpty={entries.length === 0}
        emptyState={{
          icon: MODULES.journal.icon,
          title: t('emptyState.journal.title'),
          description: t('emptyState.journal.description'),
          actionLabel: t('emptyState.journal.action'),
          onAction: handleNew,
        }}
        // Im gruppierten Modus entscheidet Dashboard selbst: überlebt keine
        // Gruppe, zeigt es „Keine Ergebnisse" — und ein leerer Kopf (die
        // gerade angelegte Kategorie) hat dort Vorrang. Dieser Zweig darf ihm
        // also nicht zuvorkommen.
        hasNoResults={filtered.length === 0 && !(grouping === 'grouped' && view !== 'timeline')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : grouping === 'grouped'
              ? {
                  mode: 'category',
                  groups: phaseGroups,
                  renderGroupHeader: renderPhaseHeader,
                  isGroupCollapsed: (g) => isPhaseCollapsed(g.key!),
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              saveAsTemplateAction('journal', ctxMenu.id),
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  // Unter dem Titel steht beim Journal nichts mehr: die Verlinkungs-Badges sind
  // seit v36 Chips im Fließtext, die Paradigma-/Bannung-/Meditations-Chips seit
  // v37 ebenfalls. Gesammelt zeigt beides das Verlinkungs-Feld der rechten
  // Seitenleiste, nach Kategorie sortiert.
  return (
    <EntryDetailFrame
      module="journal"
      isEditing={isEditing}
      meta={(
        <>
          {entry.moon_phase && (
            <span title={t(`moonPhase.${entry.moon_phase}`)}>{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase]}</span>
          )}
          <span>{formatEntryDate(entry.created_at)}</span>
        </>
      )}
      title={isEditing ? title : entry.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedEntryId === entry.id && (
        <BlockStack
          key={`${entry.id}:${editorEpoch}`}
          entryId={entry.id}
          initialContent={entry.content}
          placeholder={t('journal.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(entry.id, { content })}
          isEditing={isEditing}
          templateTarget={{ entryType: 'journal', categoryId: null, flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
