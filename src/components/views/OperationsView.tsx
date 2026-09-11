import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy, PanelTopOpen } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId, isImageIcon } from '../../lib/helpers';
import { discardNewEntry } from '../../lib/discardNewEntry';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { imageSrc } from '../../lib/images';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView, isWideCardView } from '../../lib/viewMode';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';


export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab, operationsPrefs, setOperationsPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab, operationsPrefs: s.operationsPrefs, setOperationsPrefs: s.setOperationsPrefs }))
  );
  const { operations, createOperation, duplicateOperation, updateOperation, deleteOperation, restoreOperation, permanentlyDeleteOperation, getOperation } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, createOperation: s.createOperation, duplicateOperation: s.duplicateOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation, permanentlyDeleteOperation: s.permanentlyDeleteOperation, getOperation: s.getOperation }))
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
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const { triggerAutoSave, cancelAutoSave, restoreOnCancel, contentRef, handleContentChange } = useEntryEditor({
    entityId: operation?.id,
    isEditing,
    ready: !!operation && loadedOperationId === operation.id,
    buildPatch: (content) => ({ title, content, category_id: categoryId, tags }),
    // Kategorie und Tags gehören dem Properties-Panel
    // (sofort gespeichert) — Cancel setzt nur zurück, was der Editor besitzt.
    buildRestorePatch: (content) => ({ title, content }),
    update: updateOperation,
  });

  useEffect(() => {
    if (operation) {
      setTitle(operation.title);
      contentRef.current = operation.content;
      setCategoryId(operation.category_id);
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
      setCategoryId(operation.category_id);
    }
  }, [operation?.tags, operation?.category_id]);

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
    await updateOperation(operation.id, { title, content: contentRef.current, category_id: categoryId, tags });
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

  useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });

  const getCatById = (id: string | null) => (id ? categories.find((c) => c.id === id) : undefined);

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
    const catChips = [
      ...usedCategories.map((c) => ({ value: c.id, label: catName(c), emoji: c.emoji })),
      ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄' }] : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    const sortedOps = sortItems(filtered, sort, { date: (o) => o.updated_at });


    const timelineGroups = groupByMonth(sortedOps, (o) => o.updated_at);

    const renderOp = (op: typeof operations[0]) => {
      const cat = lookupCategory(catById, op.category_id);
      const iconValue = op.icon || cat?.emoji || '⚡';
      const catDisplayName = cat ? catName(cat) : '';
      // Eine Operation mit Sigillen-Blöcken bekommt die Sigillen-Karte — egal in welcher Kategorie.
      const sigil = entryBlockSummary(op.id, op.content).sigil;
      const isSigil = !!sigil;
      const dateStr = `${catDisplayName}${catDisplayName ? ' · ' : ''}${formatEntryDate(op.updated_at)}`;
      const createdDate = formatEntryDate(op.created_at);
      const opView = { type: 'operations', id: op.id, mode: 'view' } as const;
      if (renamingId === op.id) return (
        <DashboardItem view={opView} layout={isCardView(view) ? 'card' : 'row'} editing>
          {isCardView(view) ? (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                : <div className="text-xl mb-2">{iconValue}</div>
              }
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1" />
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
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </DashboardItem>
      );
      return (
        <DashboardItem view={opView} layout={isCardView(view) ? 'card' : 'row'} onContextMenu={(e) => openCtxMenu(e, op.id)}>
          {isCardView(view) ? (
            <>
              {isSigil ? (
                // In voller Breite gedeckelt: der 4:3-Kasten wäre sonst so
                // breit wie die Karte und machte die Sigillen-Zeile fünfmal
                // so hoch wie jede andere. Im Dreier-Raster gleicht das Grid
                // die Zeilenhöhe selbst aus, dort darf er die Spalte füllen.
                <div className={`mb-3 overflow-hidden rounded-lg border border-stone-700/40 bg-stone-900/70 ${isWideCardView(view) ? 'w-16 mx-auto' : ''}`}>
                  <div className="aspect-[4/3] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(0,230,153,0.08),transparent_60%)]">
                    {sigil?.image && !sigil.concealed ? (
                      <img src={imageSrc(sigil.image)} alt="" loading="lazy" className="h-full w-full object-contain" />
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
                    {sigil?.revealDate && (
                      <span className="text-jade-400/80">{t('creation.targetDate')}: {formatEntryDate(sigil.revealDate)}</span>
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
                <div className="mt-1">
                  <span className="text-xs text-parchment-500/70">{dateStr}</span>
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
        onView={(v) => setOperationsPrefs({ view: v })}
        onSort={(s) => setOperationsPrefs({ sort: s })}
        groupBy={{ value: grouping, onChange: (g) => setOperationsPrefs({ grouping: g }) }}
        search={search}
        onSearch={setSearch}
        filters={{
          activeFilterCount,
          panelProps: {
            chipLabel: t('filters.category'),
            chips: catChips,
            selectedChips: filterCatIds,
            onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterCatIds([]),
            onClearAll: () => setFilterCatIds([]),
          },
        }}
        items={sortedOps}
        itemKey={(o) => o.id}
        renderItem={renderOp}
        isEmpty={operations.length === 0 && categories.length === 0}
        emptyState={{ message: t('operations.none'), actionLabel: t('operations.start'), onAction: handleNew }}
        // Im gruppierten Modus entscheidet Dashboard selbst: überlebt keine
        // Gruppe, zeigt es „Keine Ergebnisse". Dieser Zweig darf ihm also
        // nicht zuvorkommen.
        hasNoResults={filtered.length === 0 && !(grouping === 'grouped' && view !== 'timeline')}
        noResultsMessage={t('search.noResults')}
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
    );
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
          <span>{categoryLabel(t, currentCat, '—')}</span>
          <span>·</span>
          <span>{formatEntryDate(operation.updated_at)}</span>
        </>
      }
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
        />
      )}
    </EntryDetailFrame>
  );
}
