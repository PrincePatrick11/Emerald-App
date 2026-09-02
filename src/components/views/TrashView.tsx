import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Trash2, RotateCcw, CheckSquare, Square } from 'lucide-react';
import { TRASH_KIND_ICONS } from '../../lib/modules';
import { useTrashStore } from '../../store/trashStore';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { differenceInDays } from 'date-fns';
import { formatTimeDistance } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { groupBy, groupByMonth } from '../../lib/groupBy';
import { categoryLabel } from '../../lib/categories';
import Dashboard from '../ui/Dashboard';
import Button from '../ui/Button';
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
  handlePermanentDelete: (item: TrashedItem) => Promise<void>;
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

function ItemRow({ item, confirmingId, setConfirmingId, restore, handlePermanentDelete, selectedIds, onToggleSelect, t }: {
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
          <>
            <span className="text-xs text-stone-400">{t('common.confirmSure')}</span>
            <Button
              onClick={() => handlePermanentDelete(item)}
              variant="danger"
              className="text-xs px-2.5 py-1.5"
            >
              {t('common.confirmYes')}
            </Button>
            <Button
              onClick={() => setConfirmingId(null)}
              variant="ghost"
              className="text-xs px-2 py-1.5"
            >
              {t('common.confirmNo')}
            </Button>
          </>
        ) : (
          <>
            <button
              onClick={() => restore(item)}
              className="trash-restore-btn flex items-center gap-1.5 text-xs text-jade-400 hover:text-jade-300 px-2.5 py-1.5 rounded hover:bg-jade-400/10 transition-colors"
            >
              <RotateCcw size={12} />
              {t('trash.restore')}
            </button>
            <Button
              onClick={() => handlePermanentDelete(item)}
              variant="danger"
              className="flex items-center gap-1.5 px-2.5 py-1.5"
            >
              <Trash2 size={12} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ItemCard({ item, confirmingId, setConfirmingId, restore, handlePermanentDelete, selectedIds, onToggleSelect, t }: {
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
          <>
            <span className="text-xs text-stone-400">{t('common.confirmSure')}</span>
            <Button onClick={() => handlePermanentDelete(item)} variant="danger" className="text-xs px-2 py-1">
              {t('common.confirmYes')}
            </Button>
            <Button onClick={() => setConfirmingId(null)} variant="ghost" className="text-xs px-2 py-1">
              {t('common.confirmNo')}
            </Button>
          </>
        ) : (
          <>
            <button onClick={() => restore(item)} className="trash-restore-btn flex items-center gap-1 text-xs text-jade-400 hover:text-jade-300 px-2 py-1 rounded hover:bg-jade-400/10 transition-colors">
              <RotateCcw size={11} />{t('trash.restore')}
            </button>
            <Button onClick={() => handlePermanentDelete(item)} variant="danger" className="flex items-center gap-1 px-2 py-1" title={t('trash.deletePermanently')}>
              <Trash2 size={11} />
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
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const opCategories = useOperationStore((s) => s.categories);
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

  const handleEmptyTrash = async () => {
    if (!confirmingEmpty) { setConfirmingEmpty(true); return; }
    setConfirmingEmpty(false);
    await emptyTrash();
  };

  const handlePermanentDelete = async (item: TrashedItem) => {
    if (confirmingId !== item.id) { setConfirmingId(item.id); return; }
    setConfirmingId(null);
    await permanentlyDelete(item);
  };

  const handleBulkDelete = async () => {
    if (!confirmingBulkDelete) { setConfirmingBulkDelete(true); return; }
    setConfirmingBulkDelete(false);
    const toDelete = items.filter((i) => selectedIds.has(i.id));
    setSelectedIds(new Set());
    for (const item of toDelete) {
      await permanentlyDelete(item);
    }
  };

  const itemProps: ItemSharedProps = { confirmingId, setConfirmingId, restore, handlePermanentDelete, selectedIds, onToggleSelect: toggleSelect, t };

  // Kein category-Getter: 'category' fällt im Helper auf date_desc zurück.
  const sorted = sortItems(items, trashPrefs.sort, { date: (i) => i.deleted_at });

  // ── Grouped by type/category ───────────────────────────────────────────────
  const renderGrouped = (viewMode: 'list' | 'cards') => {
    const journal    = sorted.filter((i) => i.type === 'journal');
    const wiki       = sorted.filter((i) => i.type === 'wiki');
    const operations = sorted.filter((i) => i.type === 'operation');
    const tags       = sorted.filter((i) => i.type === 'tag');
    const tasks      = sorted.filter((i) => i.type === 'task');
    const cats       = sorted.filter((i) => i.type === 'wiki_category' || i.type === 'operation_category' || i.type === 'task_category');

    const renderItems = (subset: TrashedItem[]) =>
      viewMode === 'list'
        ? <div className="space-y-1">{subset.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>
        : <div className="grid grid-cols-3 gap-3">{subset.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>;

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
              const catDef = wikiCategories.find((c) => c.name === catKey);
              const label = catDef ? `${catDef.emoji} ${categoryLabel(t, 'wiki', catDef)}` : catKey;
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
              const catDef = opCategories.find((c) => c.name === catName);
              const label = catDef ? `${catDef.emoji} ${categoryLabel(t, 'operations', catDef)}` : catName;
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
  const headerLeft = (
    <div className="flex items-center gap-3 min-w-0">
      <Trash2 size={18} className="text-stone-500 flex-shrink-0" />
      <h1 className="text-lg font-semibold text-stone-200 truncate">{t('trash.title')}</h1>
      {items.length > 0 && (
        <span className="text-xs text-stone-500 bg-stone-700/50 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      )}
      {items.length > 0 && (
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="text-xs text-stone-500 hover:text-stone-300 transition-colors whitespace-nowrap"
        >
          {allSelected ? t('trash.deselectAll') : t('trash.selectAll')}
        </button>
      )}
    </div>
  );

  const headerRight = (
    <div className="flex items-center gap-2 flex-wrap">
      {hasSelection && (
        <>
          {confirmingBulkDelete && (
            <span className="text-xs text-stone-400">{t('common.confirmSure')}</span>
          )}
          <Button
            onClick={handleBulkDelete}
            variant="danger"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--danger-bg)] border border-[var(--danger-border)] hover:border-[var(--danger-hover-border)]"
          >
            <Trash2 size={12} />
            {confirmingBulkDelete
              ? t('common.confirmYes')
              : t('trash.deleteSelected', { count: selectedIds.size })}
          </Button>
          {confirmingBulkDelete && (
            <Button onClick={() => setConfirmingBulkDelete(false)} variant="ghost" className="text-xs px-2 py-1.5 rounded-md">
              {t('common.confirmNo')}
            </Button>
          )}
          <div className="w-px h-4 bg-stone-700" />
        </>
      )}
      {items.length > 0 && !hasSelection && (
        <div className="flex items-center gap-2 flex-wrap">
          {confirmingEmpty && (
            <span className="text-xs text-stone-400">{t('trash.confirmEmpty')}</span>
          )}
          <Button
            onClick={handleEmptyTrash}
            variant="danger"
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--danger-bg)] border border-[var(--danger-border)] hover:border-[var(--danger-hover-border)]"
          >
            {confirmingEmpty ? t('common.confirmYes') : t('trash.emptyTrash')}
          </Button>
          {confirmingEmpty && (
            <Button onClick={() => setConfirmingEmpty(false)} variant="ghost" className="text-xs px-2 py-1.5 rounded-md">
              {t('common.confirmNo')}
            </Button>
          )}
        </div>
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
          {trashPrefs.sort === 'category' && trashPrefs.view !== 'timeline' && renderGrouped(trashPrefs.view)}
          {trashPrefs.sort !== 'category' && trashPrefs.view === 'list'     && <div className="space-y-1">{sorted.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.sort !== 'category' && trashPrefs.view === 'cards'    && <div className="grid grid-cols-3 gap-3">{sorted.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.view === 'timeline' && renderTimeline()}
        </div>
      )}
    </>
  );

  return (
    <Dashboard<TrashedItem>
      headerLeft={headerLeft}
      headerRight={headerRight}
      headerClassName="flex items-center justify-between px-6 h-14 border-b border-stone-700/60"
      contentClassName="flex-1 overflow-y-auto p-6"
      view={trashPrefs.view}
      sort={trashPrefs.sort}
      onView={(v) => setTrashPrefs({ view: v })}
      onSort={(s) => setTrashPrefs({ sort: s })}
      items={items}
      itemKey={(item) => item.id}
      grouping={{ mode: 'custom', render: renderTrashContent }}
    />
  );
}
