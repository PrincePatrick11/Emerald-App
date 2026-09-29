import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId, isImageIcon } from '../../lib/helpers';
import { MODULES } from '../../lib/modules';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY, countByCategory } from '../../lib/groupBy';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';

export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, operationsPrefs, setOperationsPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, operationsPrefs: s.operationsPrefs, setOperationsPrefs: s.setOperationsPrefs }))
  );
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { operations, createOperation, duplicateOperation, updateOperation, deleteOperation, restoreOperation, getOperation } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, createOperation: s.createOperation, duplicateOperation: s.duplicateOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation, getOperation: s.getOperation }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const operation = activeView.id ? getOperation(activeView.id) : null;
  // Eine geladene Sigille mit Sperre „ganzer Eintrag" öffnet nie im
  // Bearbeitungsmodus — gleich, woher der kommt (Seitenleiste, Home, Tab).
  const locked = !!operation && !!entryBlockSummary(operation.id, operation.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet('operations');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (o: NonNullable<typeof operation>) => ({
    title: o.title, content: o.content, tags: o.tags ?? [],
    category_id: o.category_id ?? null, icon: o.icon, cover_image: o.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'operations',
    entityId: operation?.id,
    isEditing,
    ready: !!operation && loadedOperationId === operation.id,
    // Die Kategorie gehört dem Properties-Panel (sofort gespeichert) und steht
    // deshalb nicht im Patch: ein Autosave direkt nach dem Wechsel schriebe
    // sonst den alten Stand zurück.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel stellt die Operation her, wie sie beim Betreten des Bearbeitens war —
    // auch, was die Seitenleiste inzwischen gespeichert hat.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: operation?.category_id ?? null, icon: operation?.icon, cover_image: operation?.cover_image,
    }),
    readStored: (id) => {
      const stored = getOperation(id);
      return stored ? { ...fieldsOf(stored), updated_at: stored.updated_at } : null;
    },
    update: updateOperation,
  });

  useEffect(() => {
    if (operation) {
      setTitle(operation.title);
      contentRef.current = operation.content;
      setTags(operation.tags ?? []);
      setLoadedOperationId(operation.id);
    } else {
      setLoadedOperationId(null);
    }
  }, [operation?.id]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (operation) {
      setTags(operation.tags ?? []);
    }
  }, [operation?.tags]);

  // Titel ebenso: ein Rename aus der Sidebar bei offenem Edit-Modus wuerde
  // sonst vom naechsten Autosave zurueckgedreht.
  useEffect(() => {
    if (operation) setTitle(operation.title);
  }, [operation?.title]);

  const handleNew = async () => {
    const op = await createOperation();
    setActiveView({ type: 'operations', id: op.id, mode: 'edit', isNew: true });
  };

  // Der „+"-Knopf am Kategorienkopf — wie handleCreateTask(cat.id) in TasksView.
  const handleNewInCategory = async (categoryId: string) => {
    const op = await createOperation(categoryId);
    setActiveView({ type: 'operations', id: op.id, mode: 'edit', isNew: true });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newOp = await duplicateOperation(id);
    if (newOp) setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = operations.find((o) => o.id === id);
    if (!src) return;
    setRenameValue(src.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateOperation(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    if (activeView.id === id) setActiveView({ type: 'operations' });
  };

  const handleDone = async () => {
    if (!operation) return;
    cancelAutoSave();
    await updateOperation(operation.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = async () => {
    // Eine nie mit „Fertig" bestätigte Operation geht, wie jede gelöschte, in den Papierkorb.
    if (activeView.isNew && operation) return handleDelete();
    cancelAutoSave();
    if (operation) {
      // Nicht auf den Store-Stand zurück — nach dem ersten Debounce-Autosave
      // IST der Store der editierte Stand. restoreOnCancel schreibt den beim
      // Betreten des Edit-Modus gemerkten Stand der Operation zurück; die Setter
      // hier fangen den Fall vor dem ersten Autosave ab (Store unverändert,
      // Sync-Effekte laufen nicht).
      const from = (await restoreOnCancel()) ?? fieldsOf(operation);
      setTitle(from.title);
      setTags(from.tags);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'operations', id: operation!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!operation) return;
    // Erst schreiben, was noch aufgeschoben ist: im Papierkorb liegt der letzte Stand.
    await flushAutoSave().catch(console.error);
    const id = operation.id;
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    setActiveView({ type: 'operations' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: operation ? {
      key: guardKey('operations', operation.id),
      title: () => title.trim() || getOperation(operation.id)?.title.trim() || t('operations.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // List view
  if (!operation) {
    const { view, sort, grouping } = operationsPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    // Chips und Gruppen zeigen nur, was bei den Operationen vorkommt (plus
    // Sonstiges); catById bleibt die Volliste, damit fremde Kategorien auflösen.
    const usedCategories = categoriesUsedBy(categories, operations);

    const searchFiltered = search
      ? operations.filter((o) =>
          o.title.toLowerCase().includes(search.toLowerCase()) ||
          o.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
        )
      : operations;

    const filtered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((o) =>
          (!!o.category_id && filterCatIds.includes(o.category_id)) ||
          // Der „Ohne Kategorie"-Chip wählt die Waisen aus — deren category_id
          // (gelöschte Kategorie) steht nie selbst in der Chip-Auswahl.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !lookupCategory(catById, o.category_id)));

    const catName = (c: typeof categories[0]) => categoryLabel(t, c);

    // Nur die hier benutzten Kategorien (plus Sonstiges und eine gerade
    // angelegte) — die Liste ist global, die anderen Module sollen hier keine
    // leeren Chips hinterlassen.
    // „Ohne Kategorie" nur, wenn es Waisen gibt — oder solange der Chip noch
    // ausgewählt ist: verschwände er unter der aktiven Auswahl, bliebe ein
    // Filter wirksam, den nichts mehr anzeigt.
    const showUncatChip = hasUncategorized(categories, operations) || filterCatIds.includes(UNCATEGORIZED_KEY);
    // Gezählt über die Suche, ohne den Kategorie-Filter selbst: die Zahl bleibt
    // stehen, während man Kategorien an- und abwählt.
    const catCounts = countByCategory(searchFiltered, (id) => !!lookupCategory(catById, id), (o) => o.category_id);
    const catChips = [
      ...usedCategories.map((c) => ({ value: c.id, label: catName(c), emoji: c.emoji, count: catCounts.get(c.id) ?? 0 })),
      ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: catCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    const sortedOps = sortItems(filtered, sort, { date: (o) => o.updated_at });

    const timelineGroups = groupByMonth(sortedOps, (o) => o.updated_at);

    const renderOp = (op: typeof operations[0]) => {
      const cat = lookupCategory(catById, op.category_id);
      const iconValue = op.icon || cat?.emoji || '⚡';
      const catDisplayName = cat ? catName(cat) : '';
      // Sigillen-Operationen zeigen in der Zeile das Zieldatum statt Kategorie · Datum.
      const sigil = entryBlockSummary(op.id, op.content).sigil;
      const isSigil = !!sigil;
      const dateStr = `${catDisplayName}${catDisplayName ? ' · ' : ''}${formatEntryDate(op.updated_at)}`;
      const createdDate = formatEntryDate(op.created_at);
      const renaming = renamingId === op.id;
      const renameInput = (className: string) => (
        <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
          onCancel={() => setRenamingId(null)} className={className} />
      );
      return (
        <DashboardItem
          view={{ type: 'operations', id: op.id, mode: 'view' }}
          layout={isCardView(view) ? 'card' : 'row'}
          editing={renaming}
          onContextMenu={(e) => openCtxMenu(e, op.id)}
        >
          {isCardView(view) ? (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                : <div className="text-xl mb-2">{iconValue}</div>}
              {renaming
                ? renameInput('text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1')
                : <div className="text-sm font-medium text-stone-200 truncate mb-1">{op.title}</div>}
              <div className="mt-1">
                <span className="text-xs text-parchment-500/70">{dateStr}</span>
              </div>
            </>
          ) : (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                : <span className="text-base flex-shrink-0">{iconValue}</span>
              }
              {renaming
                ? renameInput('flex-1 bg-transparent text-sm text-stone-300 outline-none selectable')
                : <span className="flex-1 text-sm text-stone-300 truncate">{op.title}</span>}
              {isSigil ? (
                <span className="text-xs text-parchment-500/70 flex-shrink-0">
                  {sigil?.revealDate ? `${t('creation.targetDate')}: ${formatEntryDate(sigil.revealDate)}` : createdDate}
                </span>
              ) : (
                <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
              )}
            </>
          )}
        </DashboardItem>
      );
    };

    type Operation = typeof operations[number];

    // Abgewählte Kategorien ganz ausblenden statt sie leer stehen zu lassen —
    // wie visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? usedCategories.filter((c) => filterCatIds.includes(c.id))
      : usedCategories;
    // Der Waisen-Bucket fängt Operationen auf, deren Kategorie im Papierkorb
    // liegt — sonst verschwänden sie aus der Kategorien-Gruppierung.
    const catGroups: DashboardGroup<Operation>[] = groupByCategory(
      sortedOps, visibleCategories, (o) => o.category_id,
      catName, t('categories.uncategorized'),
    );

    const renderCategoryHeader = (group: DashboardGroup<Operation>) => {
      if (group.key === UNCATEGORIZED_KEY) {
        return (
          <CollapsibleGroupHeader
            collapsed={isCatCollapsed(UNCATEGORIZED_KEY)}
            onToggleCollapse={() => toggleCatCollapse(UNCATEGORIZED_KEY)}
            emoji="📄"
            label={group.label}
            count={group.items.length}
          />
        );
      }
      const cat = catById[group.key!];
      if (!cat) return null;
      return (
        <CollapsibleGroupHeader
          emoji={cat.emoji}
          label={categoryLabel(t, cat)}
          collapsed={isCatCollapsed(cat.id)}
          onToggleCollapse={() => toggleCatCollapse(cat.id)}
          count={group.items.length}
          add={{ title: t('operations.new'), onClick: () => handleNewInCategory(cat.id) }}
        />
      );
    };

    return (
      <Dashboard<Operation>
        title={t('nav.operations')}
        primaryAction={{ label: t('operations.new'), onClick: handleNew }}
        view={view}
        sort={sort}
        sortDate="updated"
        onView={(v) => setOperationsPrefs({ view: v })}
        onSort={(s) => setOperationsPrefs({ sort: s })}
        groupBy={{ value: grouping, onChange: (g) => setOperationsPrefs({ grouping: g }) }}
        search={search}
        onSearch={setSearch}
        filters={{
          activeFilterCount,
          onClearAll: () => setFilterCatIds([]),
          panelProps: {
            chipLabel: t('filters.category'),
            chips: catChips,
            selectedChips: filterCatIds,
            onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterCatIds([]),
            allChipsCount: searchFiltered.length,
          },
        }}
        items={sortedOps}
        itemKey={(o) => o.id}
        renderItem={renderOp}
        isEmpty={operations.length === 0}
        emptyState={{
          icon: MODULES.operations.icon,
          title: t('emptyState.operations.title'),
          description: t('emptyState.operations.description'),
          actionLabel: t('operations.new'),
          onAction: handleNew,
        }}
        // Im gruppierten Modus entscheidet Dashboard selbst: überlebt keine
        // Gruppe, zeigt es „Keine Ergebnisse". Dieser Zweig darf ihm also
        // nicht zuvorkommen.
        hasNoResults={filtered.length === 0 && !(grouping === 'grouped' && view !== 'timeline')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : grouping === 'grouped'
              ? {
                  mode: 'category',
                  groups: catGroups,
                  renderGroupHeader: renderCategoryHeader,
                  isGroupCollapsed: (g) => isCatCollapsed(g.key!),
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              openInNewTabAction({ type: 'operations', id: ctxMenu.id, mode: 'view' }),
              // Sigil-Operationen waren hier frueher ausgenommen, weil das
              // Duplizieren die Zeichnung verlor. duplicateOperation laedt sie
              // inzwischen nach und entsperrt die Kopie — die Ausnahme ist weg.
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              saveAsTemplateAction('operation', ctxMenu.id),
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  return (
    <EntryDetailFrame
      module="operations"
      isEditing={isEditing}
      meta={formatEntryDate(operation.updated_at)}
      title={isEditing ? title : operation.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      // Cover image — read mode hero (bewusst nach dem Titel, anders als im Wiki)
      belowTitle={!isEditing && operation.cover_image && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img src={operation.cover_image} alt="" className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40" />
        </div>
      )}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedOperationId === operation.id && (
        <BlockStack
          key={`${operation.id}:${editorEpoch}`}
          entryId={operation.id}
          initialContent={operation.content}
          placeholder={t('operations.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateOperation(operation.id, { content })}
          isEditing={isEditing}
          templateTarget={{ entryType: 'operation', categoryId: operation.category_id, flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
