import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy, PanelTopOpen } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import CategoryHeaderRow from '../ui/CategoryHeaderRow';
import CategoryAddModal from '../ui/CategoryAddModal';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId, isImageIcon } from '../../lib/helpers';
import { discardNewEntry } from '../../lib/discardNewEntry';
import { categoryLabel } from '../../lib/categories';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import RichEditor from '../editor/RichEditor';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import OperationSigilView from './OperationSigilView';


export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab, operationsPrefs, setOperationsPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab, operationsPrefs: s.operationsPrefs, setOperationsPrefs: s.setOperationsPrefs }))
  );
  const { operations, categories, createOperation, duplicateOperation, updateOperation, deleteOperation, restoreOperation, permanentlyDeleteOperation, getOperation, addCategory, updateCategory, deleteCategory, restoreCategory } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, categories: s.categories, createOperation: s.createOperation, duplicateOperation: s.duplicateOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation, permanentlyDeleteOperation: s.permanentlyDeleteOperation, getOperation: s.getOperation, addCategory: s.addCategory, updateCategory: s.updateCategory, deleteCategory: s.deleteCategory, restoreCategory: s.restoreCategory }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const operation = activeView.id ? getOperation(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';
  const isSigilOperation = operation?.category_id === 'sigils';

  // Die Listen-Query laesst drawing_data weg; der Sigil-Editor braucht es.
  // needsDrawing statt nur der id in den Deps: ein Refetch (Import, Restore)
  // setzt drawing_data auf undefined zurueck, ohne dass die id wechselt —
  // der Effekt muss dann erneut nachladen, sonst bleibt das Gate unten leer.
  const ensureDrawingLoaded = useOperationStore((s) => s.ensureDrawingLoaded);
  const needsDrawing = isSigilOperation && operation?.drawing_data === undefined;
  useEffect(() => {
    if (needsDrawing && operation) void ensureDrawingLoaded(operation.id);
  }, [needsDrawing, operation?.id, ensureDrawingLoaded]);

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const [hideEmptyCats, setHideEmptyCats] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const { collapsed: collapsedCats, toggle: toggleCatCollapse } = useCollapsedSet('operations');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [endDate, setEndDate] = useState<string>('');
  const [version, setVersion] = useState<string>('');

  const [editorEpoch, setEditorEpoch] = useState(0);

  const { triggerAutoSave, cancelAutoSave, restoreOnCancel, contentRef, handleContentChange } = useEntryEditor({
    entityId: operation?.id,
    isEditing,
    ready: !!operation && loadedOperationId === operation.id,
    buildPatch: (content) => ({ title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null }),
    // Kategorie, Tags, Status, Enddatum, Version gehören dem Properties-Panel
    // (sofort gespeichert) — Cancel setzt nur zurück, was der Editor besitzt.
    buildRestorePatch: (content) => ({ title, content }),
    update: updateOperation,
  });

  const catEditor = useCategoryEditor(
    { addCategory, updateCategory, deleteCategory, restoreCategory },
    {
      defaultEmoji: '⚡',
      onAdded: (cat) => { setCategoryId(cat.id); triggerAutoSave(); },
    },
  );

  useEffect(() => {
    if (operation) {
      setTitle(operation.title);
      contentRef.current = operation.content;
      setCategoryId(operation.category_id);
      setTags(operation.tags ?? []);
      setIsActive(operation.is_active ?? true);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
      setLoadedOperationId(operation.id);
    } else {
      setLoadedOperationId(null);
    }
  }, [operation?.id]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (operation) {
      setTags(operation.tags ?? []);
      setCategoryId(operation.category_id);
      setIsActive(!!operation.is_active);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
    }
  }, [operation?.tags, operation?.category_id, operation?.is_active, operation?.end_date, operation?.version]);

  // Titel ebenso: ein Rename aus der Sidebar bei offenem Edit-Modus wuerde
  // sonst vom naechsten Autosave zurueckgedreht.
  useEffect(() => {
    if (operation) setTitle(operation.title);
  }, [operation?.title]);

  // Apply tags from a dropped routine
  useEffect(() => {
    if (!isEditing || !operation) return;
    const handler = (e: Event) => {
      const { tags: routineTags } = (e as CustomEvent<{ tags: string[] }>).detail;
      setTags((prev) => {
        const nextTags = [...new Set([...prev, ...routineTags])];
        triggerAutoSave();
        return nextTags;
      });
    };
    document.addEventListener('routine-drop', handler);
    return () => document.removeEventListener('routine-drop', handler);
  }, [isEditing, operation?.id, triggerAutoSave]);

  const handleNew = async () => {
    const defaultCat = categories[0];
    if (!defaultCat) return;
    const op = await createOperation(defaultCat.id);
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
    await updateOperation(operation.id, { title, content: contentRef.current, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null });
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = async () => {
    cancelAutoSave();
    if (activeView.isNew && operation) {
      await discardNewEntry(operation.id, deleteOperation, permanentlyDeleteOperation);
      setActiveView({ type: 'operations' });
      return;
    }
    if (operation) {
      // Nicht auf den Store-Stand zurück — nach dem ersten Debounce-Autosave
      // IST der Store der editierte Stand. restoreOnCancel schreibt die beim
      // Betreten des Edit-Modus gemerkten Editor-Felder zurück; die Setter
      // hier fangen den Fall vor dem ersten Autosave ab (Store unverändert,
      // Sync-Effekte laufen nicht). Panel-Felder bleiben Store-Wahrheit.
      const from = (await restoreOnCancel()) ?? { title: operation.title, content: operation.content };
      setTitle(from.title);
      setCategoryId(operation.category_id);
      setTags(operation.tags ?? []);
      setIsActive(operation.is_active ?? true);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'operations', id: operation!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!operation) return;
    cancelAutoSave();
    const id = operation.id;
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    setActiveView({ type: 'operations' });
  };

  // Sigil operations delegate rendering (and editActions registration) to OperationSigilView.
  useEditActions(isEditing && !isSigilOperation, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });

  const getCatById = (id: string) => categories.find((c) => c.id === id);

  // List view
  if (!operation) {
    const { view, sort } = operationsPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

    const searchFiltered = search
      ? operations.filter((o) =>
          o.title.toLowerCase().includes(search.toLowerCase()) ||
          o.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
        )
      : operations;

    const catFiltered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((o) =>
          filterCatIds.includes(o.category_id) ||
          // Der „Ohne Kategorie"-Chip wählt die Waisen aus — deren category_id
          // (gelöschte Kategorie) steht nie selbst in der Chip-Auswahl.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !catById[o.category_id]));

    const statusFiltered = filterStatus.length === 0
      ? catFiltered
      : catFiltered.filter((o) => {
          const active = (o.is_active as unknown as number) !== 0;
          return filterStatus.includes(active ? 'active' : 'inactive');
        });

    const filtered = statusFiltered;

    const opCatName = (c: typeof categories[0]) => categoryLabel(t, 'operations', c);

    // Alle Kategorien anbieten, auch leere — die Leiste ist auch der Weg, sich
    // gezielt EINE Kategorie anzeigen zu lassen, nicht nur ein Ausschlussfilter.
    // „Ohne Kategorie" immer dabei, auch ohne Waisen.
    const catChips = [
      ...categories.map((c) => ({ value: c.id, label: opCatName(c), emoji: c.emoji })),
      { value: UNCATEGORIZED_KEY, label: t('operations.uncategorized'), emoji: '📄' },
    ];

    const statusChips = [
      { value: 'active', label: t('operations.active'), emoji: '●' },
      { value: 'inactive', label: t('operations.inactive'), emoji: '○' },
    ];

    const activeFilterCount =
      (filterCatIds.length > 0 ? 1 : 0) +
      (filterStatus.length > 0 ? 1 : 0) +
      (hideEmptyCats ? 1 : 0);

    const sortedOps = sortItems(filtered, sort, {
      date: (o) => o.updated_at,
      category: (o) => catById[o.category_id]?.name ?? '',
    });


    const timelineGroups = groupByMonth(sortedOps, (o) => o.updated_at);

    const renderOp = (op: typeof operations[0]) => {
      const cat = catById[op.category_id];
      const iconValue = op.icon || cat?.emoji || '⚡';
      const catDisplayName = cat ? opCatName(cat) : '';
      const isSigil = op.category_id === 'sigils';
      const dateStr = `${catDisplayName}${catDisplayName ? ' · ' : ''}${formatEntryDate(op.updated_at)}`;
      const createdDate = formatEntryDate(op.created_at);
      const activeDot = <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${op.is_active ? 'bg-jade-400' : 'bg-stone-700'}`} />;
      if (renamingId === op.id) return (
        <div key={op.id} className={view === 'cards' ? 'panel-interactive px-4 py-4 text-left' : 'panel-interactive w-full flex items-center gap-3 px-4 py-3'}>
          {view === 'cards' ? (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                : <div className="text-xl mb-2">{iconValue}</div>
              }
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1" />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-parchment-500/70">{dateStr}</span>
                {activeDot}
              </div>
            </>
          ) : (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                : <span className="text-base flex-shrink-0">{iconValue}</span>
              }
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
              {activeDot}
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </div>
      );
      return (
        <button
          key={op.id}
          onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' });
            }
          }}
          onContextMenu={(e) => openCtxMenu(e, op.id)}
          className={view === 'cards'
            ? 'panel-interactive px-4 py-4 text-left'
            : 'panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group'
          }
        >
          {view === 'cards' ? (
            <>
              {isSigil ? (
                <div className="mb-3 overflow-hidden rounded-lg border border-stone-700/40 bg-stone-900/70">
                  <div className="aspect-[4/3] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(0,230,153,0.08),transparent_60%)]">
                    {op.thumbnail_data && op.show_sigil ? (
                      <img src={op.thumbnail_data} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xl">{iconValue}</span>
                    )}
                  </div>
                </div>
              ) : (
                isImageIcon(iconValue)
                  ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                  : <div className="text-xl mb-2">{iconValue}</div>
              )}
              <div className="text-sm font-medium text-stone-200 truncate mb-1">{op.title}</div>
              {isSigil ? (
                <>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {op.target_reveal_date && (
                      <span className="text-jade-400/80">{t('creation.targetDate')}: {formatEntryDate(op.target_reveal_date)}</span>
                    )}
                    <span className="text-parchment-500/70">{createdDate}</span>
                  </div>
                  {op.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {op.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-stone-700/60 px-1.5 py-0.5 text-xs text-stone-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-parchment-500/70">{dateStr}</span>
                  {activeDot}
                </div>
              )}
            </>
          ) : (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                : <span className="text-base flex-shrink-0">{iconValue}</span>
              }
              <span className="flex-1 text-sm text-stone-300 truncate">{op.title}</span>
              {isSigil ? (
                <span className="text-xs text-parchment-500/70 flex-shrink-0">
                  {op.target_reveal_date ? `${t('creation.targetDate')}: ${formatEntryDate(op.target_reveal_date)}` : createdDate}
                </span>
              ) : (
                <>
                  {activeDot}
                  <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
                </>
              )}
            </>
          )}
        </button>
      );
    };

    type Operation = typeof operations[number];

    // Abgewählte Kategorien ganz ausblenden statt sie leer stehen zu lassen —
    // wie visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? categories.filter((c) => filterCatIds.includes(c.id))
      : categories;
    // Der Waisen-Bucket fängt Operationen auf, deren Kategorie im Papierkorb
    // liegt — sonst verschwänden sie aus der Kategorien-Gruppierung.
    const catGroups: DashboardGroup<Operation>[] = groupByCategory(
      sortedOps, visibleCategories, (o) => o.category_id,
      opCatName, t('operations.uncategorized'),
      filterCatIds.includes(UNCATEGORIZED_KEY),
    );

    const renderCategoryHeader = (group: DashboardGroup<Operation>) => {
      if (group.key === UNCATEGORIZED_KEY) {
        return (
          <CollapsibleGroupHeader
            collapsed={collapsedCats.has(UNCATEGORIZED_KEY)}
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
        <CategoryHeaderRow
          category={cat}
          label={categoryLabel(t, 'operations', cat)}
          editor={catEditor}
          canDelete={!cat.is_builtin}
          collapsed={collapsedCats.has(cat.id)}
          onToggleCollapse={() => toggleCatCollapse(cat.id)}
          count={group.items.length}
          onAdd={() => handleNewInCategory(cat.id)}
          addTitle={t('operations.new')}
        />
      );
    };

    return (
      <>
      <Dashboard<Operation>
        title={t('nav.operations')}
        primaryAction={{ label: t('operations.new'), onClick: handleNew }}
        secondaryAction={{ label: t('operations.addCategory'), onClick: () => catEditor.setAddingCategory(true) }}
        view={view}
        sort={sort}
        onView={(v) => setOperationsPrefs({ view: v })}
        onSort={(s) => setOperationsPrefs({ sort: s })}
        search={search}
        onSearch={setSearch}
        filters={{
          showFilters,
          onToggleFilters: () => setShowFilters((v) => !v),
          activeFilterCount,
          panelProps: {
            chipLabel: t('filters.category'),
            chips: catChips,
            selectedChips: filterCatIds,
            onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterCatIds([]),
            nonEmptyOnly: hideEmptyCats,
            onNonEmptyToggle: () => setHideEmptyCats((v) => !v),
            statusChips,
            selectedStatus: filterStatus,
            onStatusToggle: (v) => setFilterStatus((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onClearAll: () => { setFilterCatIds([]); setFilterStatus([]); setHideEmptyCats(false); },
          },
        }}
        items={sortedOps}
        itemKey={(o) => o.id}
        renderItem={renderOp}
        isEmpty={operations.length === 0 && categories.length === 0}
        emptyState={{ message: t('operations.none'), actionLabel: t('operations.start'), onAction: handleNew }}
        // Bei aktivem Kategorie-Filter ohne Suchtext trotzdem die Gruppierung
        // rendern: eine ausgewählte leere Kategorie soll ihren Kopf samt
        // Leer-Hinweis zeigen, nicht „Keine Ergebnisse". („Nur mit Einträgen"
        // wertet Dashboard selbst aus und zeigt notfalls den Hinweis.)
        hasNoResults={filtered.length === 0 && !(sort === 'category' && view !== 'timeline' && filterCatIds.length > 0 && !search)}
        noResultsMessage={t('search.noResults')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : sort === 'category'
              ? {
                  mode: 'category',
                  groups: catGroups,
                  renderGroupHeader: renderCategoryHeader,
                  renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('operations.none')}</p>,
                  isGroupCollapsed: (g) => collapsedCats.has(g.key!),
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'operations', id: ctxMenu.id, mode: 'view' }) },
              // Sigil-Operationen waren hier frueher ausgenommen, weil das
              // Duplizieren die Zeichnung verlor. duplicateOperation laedt sie
              // inzwischen nach und entsperrt die Kopie — die Ausnahme ist weg.
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
      <CategoryAddModal editor={catEditor} title={t('operations.addCategory')} placeholder={t('operations.categoryName')} />
      </>
    );
  }

  if (isSigilOperation) {
    // Kurz leer rendern, bis ensureDrawingLoaded die Zeichnung nachgeladen hat —
    // sonst initialisiert der Canvas seine Historie mit "keine Zeichnung".
    if (operation.drawing_data === undefined) return null;
    return <OperationSigilView operation={operation} />;
  }

  const currentCat = getCatById(isEditing ? categoryId : operation.category_id);
  const operationIcon = operation.icon || currentCat?.emoji || '⚡';

  return (
    <EntryDetailFrame
      module="operations"
      isEditing={isEditing}
      breadcrumbMeta={
        <>
          {isImageIcon(operationIcon)
            ? <img src={operationIcon} alt="" className="w-5 h-5 object-cover rounded" />
            : <span>{operationIcon}</span>
          }
          <span>{categoryLabel(t, 'operations', currentCat, '—')}</span>
          <span>·</span>
          <span>{formatEntryDate(operation.updated_at)}</span>
        </>
      }
      title={isEditing ? title : operation.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      belowTitle={
        <>
          {/* Cover image — read mode hero (bewusst nach dem Titel, anders als im Wiki) */}
          {!isEditing && operation.cover_image && (
            <div className="flex-shrink-0 px-8 pt-5">
              <img src={operation.cover_image} alt="" className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40" />
            </div>
          )}

          {/* Built-in properties */}
          <div className="px-8 pb-3 flex-shrink-0 flex flex-wrap gap-2">
            {/* Active / Inactive — clickable toggle */}
            <button
              onClick={() => updateOperation(operation.id, { is_active: !operation.is_active })}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                !!operation.is_active
                  ? 'bg-jade-900/40 text-jade-400 border-jade-800/40 hover:bg-jade-900/60'
                  : 'bg-stone-800/60 text-stone-500 border-stone-700/40 hover:bg-stone-700/60'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${!!operation.is_active ? 'bg-jade-400' : 'bg-stone-600'}`} />
              {!!operation.is_active ? t('operations.active') : t('operations.inactive')}
            </button>

            {operation.end_date && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40">
                <span className="text-stone-600">{t('operations.endDate')}:</span>
                <span className="text-stone-300">
                  {formatEntryDate(operation.end_date)}
                </span>
              </span>
            )}

            {operation.version && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40">
                <span className="text-stone-600">{t('operations.version')}:</span>
                <span className="text-stone-300">{operation.version}</span>
              </span>
            )}
          </div>
        </>
      }
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedOperationId === operation.id && (
        <RichEditor
          key={`${operation.id}:${editorEpoch}`}
          initialContent={operation.content}
          placeholder={t('operations.placeholder')}
          onChange={handleContentChange}
          editable={isEditing}
        />
      )}
    </EntryDetailFrame>
  );
}
