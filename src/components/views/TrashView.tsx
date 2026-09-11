import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Trash2, RotateCcw, CheckSquare, Square } from 'lucide-react';
import { AUX_VIEWS, TRASH_KIND_ICONS } from '../../lib/modules';
import { useTrashStore } from '../../store/trashStore';
import { useUIStore, type ViewMode } from '../../store/uiStore';
import { useCategoryStore } from '../../store/categoryStore';
import { differenceInDays } from 'date-fns';
import { formatTimeDistance } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView, isWideCardView } from '../../lib/viewMode';
import { groupBy, groupByMonth } from '../../lib/groupBy';
import { categoryLabel } from '../../lib/categories';
import Dashboard, { DashboardTitle } from '../ui/Dashboard';
import Button from '../ui/Button';
import InlineConfirm from '../ui/InlineConfirm';
import type { TrashedItem } from '../../types';

function typeIcon(type: TrashedItem['type']) {
  const Icon = TRASH_KIND_ICONS[type];
  return <Icon size={14} className="text-stone-500 flex-shrink-0" />;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-2 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{label}</p>
      <span className="text-xs text-stone-700">{count}</span>
    </div>
  );
}

function SubSectionHeader({ label }: { label: string }) {
  return (
    <p className="text-xs text-stone-600 italic mt-3 mb-1.5 pl-1">{label}</p>
  );
}

interface ItemSharedProps {
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  restore: (item: TrashedItem) => Promise<void>;
  deleteNow: (item: TrashedItem) => Promise<void>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any>;
}

function SelectCheckbox({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="flex-shrink-0 text-stone-500 hover:text-jade-400 transition-colors"
    >
      {selected
        ? <CheckSquare size={15} className="text-jade-400" />
        : <Square size={15} />}
    </button>
  );
}

function ItemRow({ item, confirmingId, setConfirmingId, restore, deleteNow, selectedIds, onToggleSelect, t }: {
  item: TrashedItem;
} & ItemSharedProps) {
  const daysLeft = 30 - differenceInDays(new Date(), new Date(item.deleted_at));
  const confirming = confirmingId === item.id;
  const selected = selectedIds.has(item.id);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors cursor-pointer
        ${selected
          ? 'bg-jade-500/8 border-jade-500/30'
          : 'bg-stone-800/50 border-stone-700/40 hover:border-stone-600/40'}`}
      onClick={() => onToggleSelect(item.id)}
    >
      <SelectCheckbox selected={selected} onToggle={() => onToggleSelect(item.id)} />
      {typeIcon(item.type)}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-300 truncate">{item.title}</div>
        <div className="text-xs text-stone-600 mt-0.5">
          {t('trash.deletedAgo', { time: formatTimeDistance(item.deleted_at) })}
          {' '}&middot;{' '}
          <span className={daysLeft <= 3 ? 'text-red-400' : 'text-stone-600'}>
            {t('trash.daysLeft', { count: Math.max(0, daysLeft) })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <InlineConfirm onConfirm={() => deleteNow(item)} onCancel={() => setConfirmingId(null)} />
        ) : (
          <>
            <Button tone="jade" onClick={() => restore(item)}>
              <RotateCcw size={12} />
              {t('trash.restore')}
            </Button>
            <Button tone="danger" compact title={t('trash.deletePermanently')} aria-label={t('trash.deletePermanently')}
              onClick={() => setConfirmingId(item.id)}>
              <Trash2 size={12} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ItemCard({ item, confirmingId, setConfirmingId, restore, deleteNow, selectedIds, onToggleSelect, t }: {
  item: TrashedItem;
} & ItemSharedProps) {
  const daysLeft = 30 - differenceInDays(new Date(), new Date(item.deleted_at));
  const confirming = confirmingId === item.id;
  const selected = selectedIds.has(item.id);

  return (
    <div
      className={`panel p-4 flex flex-col gap-2 cursor-pointer transition-colors
        ${selected ? 'ring-1 ring-jade-500/40 bg-jade-500/5' : ''}`}
      onClick={() => onToggleSelect(item.id)}
    >
      <div className="flex items-start gap-2">
        <SelectCheckbox selected={selected} onToggle={() => onToggleSelect(item.id)} />
        {typeIcon(item.type)}
        <p className="text-sm text-stone-300 font-medium leading-snug line-clamp-2 flex-1">
          {item.title}
        </p>
      </div>
      <div className="text-xs text-stone-600">
        {t('trash.deletedAgo', { time: formatTimeDistance(item.deleted_at) })}
      </div>
      <div className={`text-xs font-medium ${daysLeft <= 3 ? 'text-red-400' : 'text-stone-600'}`}>
        {t('trash.daysLeft', { count: Math.max(0, daysLeft) })}
      </div>
      <div className="flex items-center gap-1 pt-1 border-t border-stone-700/40" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <InlineConfirm small onConfirm={() => deleteNow(item)} onCancel={() => setConfirmingId(null)} />
        ) : (
          <>
            <Button tone="jade" small onClick={() => restore(item)}>
              <RotateCcw size={12} />
              {t('trash.restore')}
            </Button>
            <Button tone="danger" compact small title={t('trash.deletePermanently')} aria-label={t('trash.deletePermanently')}
              onClick={() => setConfirmingId(item.id)}>
              <Trash2 size={12} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function TrashView() {
  const { t } = useTranslation();
  const { items, loading, fetchTrashed, restore, permanentlyDelete, emptyTrash } = useTrashStore(
    useShallow((s) => ({ items: s.items, loading: s.loading, fetchTrashed: s.fetchTrashed, restore: s.restore, permanentlyDelete: s.permanentlyDelete, emptyTrash: s.emptyTrash }))
  );
  const { trashPrefs, setTrashPrefs } = useUIStore(
    useShallow((s) => ({ trashPrefs: s.trashPrefs, setTrashPrefs: s.setTrashPrefs }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);

  useEffect(() => { fetchTrashed(); }, []);

  // Clear selection when items change (e.g. after deletion)
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirmingBulkDelete(false);
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((i) => i.id)));
    setConfirmingBulkDelete(false);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
  };

  // Die Knöpfe stellen nur die Rückfrage (confirming…); gelöscht wird erst
  // über InlineConfirms „Ja".
  const emptyTrashNow = async () => {
    setConfirmingEmpty(false);
    await emptyTrash();
  };

  const deleteNow = async (item: TrashedItem) => {
    setConfirmingId(null);
    await permanentlyDelete(item);
  };

  const bulkDeleteNow = async () => {
    setConfirmingBulkDelete(false);
    const toDelete = items.filter((i) => selectedIds.has(i.id));
    setSelectedIds(new Set());
    for (const item of toDelete) {
      await permanentlyDelete(item);
    }
  };

  const itemProps: ItemSharedProps = { confirmingId, setConfirmingId, restore, deleteNow, selectedIds, onToggleSelect: toggleSelect, t };

  const sorted = sortItems(items, trashPrefs.sort, { date: (i) => i.deleted_at });

  // ── Grouped by type/category ───────────────────────────────────────────────
  // Ein Raster für beide Kartenansichten: drei Spalten, in voller Breite eine.
  const cardsGridClass = isWideCardView(trashPrefs.view) ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-3 gap-3';

  // Ohne 'timeline': der Zeitstrahl hat seinen eigenen Zweig, sonst fiele er
  // hier stillschweigend in den Karten-Ast.
  const renderGrouped = (viewMode: Exclude<ViewMode, 'timeline'>) => {
    const journal    = sorted.filter((i) => i.type === 'journal');
    const wiki       = sorted.filter((i) => i.type === 'wiki');
    const operations = sorted.filter((i) => i.type === 'operation');
    const tags       = sorted.filter((i) => i.type === 'tag');
    const tasks      = sorted.filter((i) => i.type === 'task');
    const cats       = sorted.filter((i) => i.type === 'category');
    const blockDefs  = sorted.filter((i) => i.type === 'blockDefinition');

    const renderItems = (subset: TrashedItem[]) =>
      viewMode === 'list'
        ? <div className="space-y-1">{subset.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>
        : <div className={cardsGridClass}>{subset.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>;

    const wikiByCategory = groupBy(wiki, (item) => item.category ?? 'other');
    const opsByCategory = groupBy(operations, (item) => item.category ?? '—');

    return (
      <div>
        {journal.length > 0 && (
          <>
            <SectionHeader label={t('nav.journal')} count={journal.length} />
            {renderItems(journal)}
          </>
        )}
        {wiki.length > 0 && (
          <>
            <SectionHeader label={t('nav.wiki')} count={wiki.length} />
            {wikiByCategory.map(({ label: catKey, items: catItems }) => {
              // trashStore joint c.name als category — der Schlüssel ist der Name, nicht die id.
              const catDef = categories.find((c) => c.name === catKey);
              const label = catDef ? `${catDef.emoji} ${categoryLabel(t, catDef)}` : catKey;
              return (
                <div key={catKey}>
                  {wikiByCategory.length > 1 && <SubSectionHeader label={label} />}
                  {renderItems(catItems)}
                </div>
              );
            })}
          </>
        )}
        {operations.length > 0 && (
          <>
            <SectionHeader label={t('nav.operations')} count={operations.length} />
            {opsByCategory.map(({ label: catName, items: catItems }) => {
              const catDef = categories.find((c) => c.name === catName);
              const label = catDef ? `${catDef.emoji} ${categoryLabel(t, catDef)}` : catName;
              return (
                <div key={catName}>
                  {opsByCategory.length > 1 && <SubSectionHeader label={label} />}
                  {renderItems(catItems)}
                </div>
              );
            })}
          </>
        )}
        {tasks.length > 0 && (
          <>
            <SectionHeader label={t('nav.tasks')} count={tasks.length} />
            {renderItems(tasks)}
          </>
        )}
        {tags.length > 0 && (
          <>
            <SectionHeader label={t('nav.tags')} count={tags.length} />
            {renderItems(tags)}
          </>
        )}
        {cats.length > 0 && (
          <>
            <SectionHeader label={t('trash.categories')} count={cats.length} />
            {renderItems(cats)}
          </>
        )}
        {blockDefs.length > 0 && (
          <>
            <SectionHeader label={t('trash.blockDefinitions')} count={blockDefs.length} />
            {renderItems(blockDefs)}
          </>
        )}
      </div>
    );
  };

  // ── Timeline ───────────────────────────────────────────────────────────────
  const renderTimeline = () => {
    const byMonth = groupByMonth(sorted, (i) => i.deleted_at);
    return (
      <div className="space-y-5">
        {byMonth.map(({ label, items: monthItems }) => (
          <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2 px-1">{label}</p>
            <div className="space-y-1">
              {monthItems.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const hasSelection = selectedIds.size > 0;
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  // min-w-0/truncate und flex-wrap: die beiden Slots landen im Seitenleisten-
  // Experiment in einer schmalen Spalte (Dashboard portalt den Kopf dorthin)
  // und müssen dort umbrechen statt überzulaufen.
  // Der leere Papierkorb zeigt keine Null — anders als die Listen, deren
  // Null etwas sagt („noch keine Tags").
  const headerLeft = (
    <DashboardTitle icon={AUX_VIEWS.trash.icon} title={t('trash.title')} count={items.length > 0 ? items.length : undefined}>
      {items.length > 0 && (
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="text-xs text-stone-500 hover:text-stone-300 transition-colors whitespace-nowrap"
        >
          {allSelected ? t('trash.deselectAll') : t('trash.selectAll')}
        </button>
      )}
    </DashboardTitle>
  );

  const headerRight = (
    <div className="flex items-center gap-2 flex-wrap">
      {hasSelection && (
        <>
          {confirmingBulkDelete ? (
            // Die Anzahl steht auf dem Bestätigen — sonst sagte die Rückfrage
            // nicht mehr, wie viele Einträge gehen.
            <InlineConfirm wrap confirmLabel={t('trash.deleteSelected', { count: selectedIds.size })}
              onConfirm={bulkDeleteNow} onCancel={() => setConfirmingBulkDelete(false)} />
          ) : (
            <Button tone="danger" onClick={() => setConfirmingBulkDelete(true)}>
              <Trash2 size={12} />
              {t('trash.deleteSelected', { count: selectedIds.size })}
            </Button>
          )}
          <div className="w-px h-4 bg-stone-700" />
        </>
      )}
      {items.length > 0 && !hasSelection && (
        confirmingEmpty ? (
          <InlineConfirm wrap message={t('trash.confirmEmpty')} onConfirm={emptyTrashNow} onCancel={() => setConfirmingEmpty(false)} />
        ) : (
          <Button tone="danger" onClick={() => setConfirmingEmpty(true)}>
            {t('trash.emptyTrash')}
          </Button>
        )
      )}
    </div>
  );

  const renderTrashContent = () => (
    <>
      {loading && <p className="text-sm text-stone-600">{t('common.loading')}</p>}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
          <Trash2 size={40} className="text-stone-700" />
          <p className="text-stone-600 text-sm">{t('trash.empty')}</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-stone-600 mb-3">{t('trash.retentionNote')}</p>
          {trashPrefs.grouping === 'grouped' && trashPrefs.view !== 'timeline' && renderGrouped(trashPrefs.view)}
          {trashPrefs.grouping !== 'grouped' && trashPrefs.view === 'list'     && <div className="space-y-1">{sorted.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.grouping !== 'grouped' && isCardView(trashPrefs.view)  && <div className={cardsGridClass}>{sorted.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.view === 'timeline' && renderTimeline()}
        </div>
      )}
    </>
  );

  return (
    <Dashboard<TrashedItem>
      headerLeft={headerLeft}
      headerRight={headerRight}
      contentClassName="flex-1 overflow-y-auto p-6"
      view={trashPrefs.view}
      sort={trashPrefs.sort}
      onView={(v) => setTrashPrefs({ view: v })}
      onSort={(s) => setTrashPrefs({ sort: s })}
      // Der Papierkorb gruppiert nach Eintragstyp, nicht nach Kategorie.
      groupBy={{ value: trashPrefs.grouping, onChange: (g) => setTrashPrefs({ grouping: g }), label: t('listView.type') }}
      items={items}
      itemKey={(item) => item.id}
      grouping={{ mode: 'custom', render: renderTrashContent }}
    />
  );
}
