import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Trash2, RotateCcw, CheckSquare, Square, X } from 'lucide-react';
import { AUX_VIEWS, TRASH_KIND_ICONS } from '../../lib/modules';
import { useTrashStore } from '../../store/trashStore';
import { useUIStore, type ViewMode } from '../../store/uiStore';
import { useCategoryStore } from '../../store/categoryStore';
import { differenceInDays } from 'date-fns';
import { useSettingsStore } from '../../store/settingsStore';
import { formatTimeDistance } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView, isWideCardView } from '../../lib/viewMode';
import { groupBy, groupByMonth } from '../../lib/groupBy';
import { categoryLabel } from '../../lib/categories';
import Dashboard from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import Button from '../ui/Button';
import ContextMenu from '../ui/ContextMenu';
import { DashboardRow, RowContent } from '../ui/DashboardItem';
import EmptyState, { NoResults } from '../ui/EmptyState';
import InlineConfirm from '../ui/InlineConfirm';
import type { TrashedItem } from '../../types';
import { useSessionState } from '../../store/sessionStore';

function typeIcon(type: TrashedItem['type']) {
  const Icon = TRASH_KIND_ICONS[type];
  return <Icon size={14} className="text-subtle flex-shrink-0" />;
}

interface ItemSharedProps {
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  restore: (item: TrashedItem) => Promise<void>;
  deleteNow: (item: TrashedItem) => Promise<void>;
  onContextMenu: (e: React.MouseEvent, item: TrashedItem) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any>;
}

function SelectCheckbox({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="flex-shrink-0 text-subtle hover:text-accent-raise transition-colors"
    >
      {selected
        ? <CheckSquare size={14} className="text-accent" />
        : <Square size={14} />}
    </button>
  );
}

/** Days until automatic deletion — `null` if the vault never empties automatically. */
function useDaysLeft(deletedAt: string): number | null {
  const retentionDays = useSettingsStore((s) => s.settings.trash.retentionDays);
  if (retentionDays === null) return null;
  return Math.max(0, retentionDays - differenceInDays(new Date(), new Date(deletedAt)));
}

function DaysLeft({ days, t }: { days: number; t: ItemSharedProps['t'] }) {
  return (
    <span className={days <= 3 ? 'text-danger' : 'text-subtle'}>
      {t('trash.daysLeft', { count: days })}
    </span>
  );
}

function ItemRow({ item, confirmingId, setConfirmingId, restore, deleteNow, onContextMenu, selectedIds, onToggleSelect, t }: {
  item: TrashedItem;
} & ItemSharedProps) {
  const daysLeft = useDaysLeft(item.deleted_at);
  const selected = selectedIds.has(item.id);
  const confirming = confirmingId === item.id;

  return (
    <DashboardRow
      className={selected ? 'row-selected' : ''}
      onClick={() => onToggleSelect(item.id)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <SelectCheckbox label={item.title} selected={selected} onToggle={() => onToggleSelect(item.id)} />
      <RowContent
        icon={typeIcon(item.type)}
        title={item.title}
        meta={confirming ? undefined : (
          <>
            {t('trash.deletedAgo', { time: formatTimeDistance(item.deleted_at) })}
            {daysLeft !== null && <> &middot; <DaysLeft days={daysLeft} t={t} /></>}
          </>
        )}
      />
      {/* Restoring is what this page is for, so it stays in the row, in jade.
          Deleting for good is in the context menu and asks here. */}
      <span className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {confirming
          ? <InlineConfirm small onConfirm={() => deleteNow(item)} onCancel={() => setConfirmingId(null)} />
          : (
            <Button tone="jade" small onClick={() => restore(item)}>
              <RotateCcw size={12} />
              {t('trash.restore')}
            </Button>
          )}
      </span>
    </DashboardRow>
  );
}

function ItemCard({ item, confirmingId, setConfirmingId, restore, deleteNow, onContextMenu, selectedIds, onToggleSelect, t }: {
  item: TrashedItem;
} & ItemSharedProps) {
  const daysLeft = useDaysLeft(item.deleted_at);
  const selected = selectedIds.has(item.id);

  return (
    <div
      className={`panel-interactive p-4 flex flex-col gap-2 ${selected ? 'row-selected' : ''}`}
      onClick={() => onToggleSelect(item.id)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <div className="flex items-start gap-2">
        <SelectCheckbox label={item.title} selected={selected} onToggle={() => onToggleSelect(item.id)} />
        {typeIcon(item.type)}
        <p className="text-sm text-soft font-medium leading-snug line-clamp-2 flex-1">
          {item.title}
        </p>
      </div>
      <div className="text-xs text-muted">
        {t('trash.deletedAgo', { time: formatTimeDistance(item.deleted_at) })}
      </div>
      {daysLeft !== null && (
        <div className="text-xs font-medium">
          <DaysLeft days={daysLeft} t={t} />
        </div>
      )}
      <div className="flex items-center gap-1 pt-1 border-t border-edge" onClick={(e) => e.stopPropagation()}>
        {confirmingId === item.id
          ? <InlineConfirm small onConfirm={() => deleteNow(item)} onCancel={() => setConfirmingId(null)} />
          : (
            <Button tone="jade" small onClick={() => restore(item)}>
              <RotateCcw size={12} />
              {t('trash.restore')}
            </Button>
          )}
      </div>
    </div>
  );
}

/** For this long after the confirmation opens, a click on "Yes" does not count —
 *  longer than a double click, shorter than a deliberate second click. */
const CONFIRM_GUARD_MS = 400;

export default function TrashView() {
  const { t } = useTranslation();
  const retentionDays = useSettingsStore((s) => s.settings.trash.retentionDays);
  const { items, loading, fetchTrashed, restore, permanentlyDelete, emptyTrash } = useTrashStore(
    useShallow((s) => ({ items: s.items, loading: s.loading, fetchTrashed: s.fetchTrashed, restore: s.restore, permanentlyDelete: s.permanentlyDelete, emptyTrash: s.emptyTrash }))
  );
  const { trashPrefs, setTrashPrefs } = useUIStore(
    useShallow((s) => ({ trashPrefs: s.trashPrefs, setTrashPrefs: s.setTrashPrefs }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useSessionState<Set<string>>('trash.selection', new Set());
  // Which confirmation the primary button is currently asking. One state for
  // both, and every change of the selection resets it: otherwise an old
  // "Yes, delete everything" would reappear after selecting and deselecting.
  const [confirm, setConfirm] = useState<'empty' | 'selected' | null>(null);
  // When the confirmation opened. The "Yes" is on the same button as the
  // question — the second click of a double click would otherwise delete immediately.
  const confirmArmedAt = useRef(0);
  const [search, setSearch] = useSessionState('trash.search', '');
  const [ctxMenu, setCtxMenu] = useState<{ item: TrashedItem; x: number; y: number } | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => { fetchTrashed(); }, []);

  // "Select all" selects only the search hits — otherwise the
  // multi-selection would permanently delete what the filter is currently hiding. "Empty
  // trash" deliberately stays global.
  const query = search.trim().toLowerCase();
  const matching = query ? items.filter((i) => i.title.toLowerCase().includes(query)) : items;

  // Clear selection when items change (e.g. after deletion)
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
    setConfirm(null);
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirm(null);
    setRestoreFailed(false);
  };

  const selectAll = () => {
    setSelectedIds(new Set(matching.map((i) => i.id)));
    setConfirm(null);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setConfirm(null);
  };

  // The buttons only pose the confirmation; deletion only happens via the "Yes"
  // of the primary action (empty/selection) or InlineConfirm (single row).
  const emptyTrashNow = async () => {
    setConfirm(null);
    await emptyTrash();
  };

  const deleteNow = async (item: TrashedItem) => {
    setConfirmingId(null);
    await permanentlyDelete(item);
  };

  const bulkDeleteNow = async () => {
    setConfirm(null);
    const toDelete = items.filter((i) => selectedIds.has(i.id));
    setSelectedIds(new Set());
    for (const item of toDelete) {
      await permanentlyDelete(item);
    }
  };

  /** One failure does not stop the rest; what failed stays selected, to try again. */
  const restoreSelected = async () => {
    const failed = new Set<string>();
    for (const item of items.filter((i) => selectedIds.has(i.id))) {
      try {
        await restore(item);
      } catch (err) {
        console.error('[TrashView] restoring failed:', err);
        failed.add(item.id);
      }
    }
    setSelectedIds(failed);
    setRestoreFailed(failed.size > 0);
  };

  const openCtxMenu = (e: React.MouseEvent, item: TrashedItem) => {
    e.preventDefault();
    setCtxMenu({ item, x: e.clientX, y: e.clientY });
  };

  const itemProps: ItemSharedProps = { confirmingId, setConfirmingId, restore, deleteNow, onContextMenu: openCtxMenu, selectedIds, onToggleSelect: toggleSelect, t };

  const sorted = sortItems(matching, trashPrefs.sort, { date: (i) => i.deleted_at });

  // ── Grouped by type/category ───────────────────────────────────────────────
  // One grid for both card views: three columns, one at full width.
  const cardsGridClass = isWideCardView(trashPrefs.view) ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-3 gap-3';

  // Without 'timeline': the timeline has its own branch, otherwise it would
  // silently fall into the card branch here.
  const renderGrouped = (viewMode: Exclude<ViewMode, 'timeline'>) => {
    const journal    = sorted.filter((i) => i.type === 'journal');
    const wiki       = sorted.filter((i) => i.type === 'wiki');
    const operations = sorted.filter((i) => i.type === 'operation');
    const tags       = sorted.filter((i) => i.type === 'tag');
    const tasks      = sorted.filter((i) => i.type === 'task');
    const cats       = sorted.filter((i) => i.type === 'category');
    const blockDefs  = sorted.filter((i) => i.type === 'blockDefinition');
    const templates  = sorted.filter((i) => i.type === 'template');
    const languages  = sorted.filter((i) => i.type === 'language');
    const altars     = sorted.filter((i) => i.type === 'altar');
    const altarItems = sorted.filter((i) => i.type === 'altarItem');
    const images     = sorted.filter((i) => i.type === 'image');

    const renderItems = (subset: TrashedItem[]) =>
      viewMode === 'list'
        ? <div className="space-y-1.5">{subset.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>
        : <div className={cardsGridClass}>{subset.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>;

    // '' = no category; trashStore joins c.name as category — the key is the name, not the id.
    const wikiByCategory = groupBy(wiki, (item) => item.category ?? '');
    const opsByCategory = groupBy(operations, (item) => item.category ?? '');
    const categoryGroupLabel = (name: string) => {
      const catDef = categories.find((c) => c.name === name);
      return catDef ? `${catDef.emoji} ${categoryLabel(t, catDef)}` : name || t('categories.uncategorized');
    };

    const sections: { label: string; items: TrashedItem[]; groups?: { label: string; items: TrashedItem[] }[] }[] = [
      { label: t('nav.journal'), items: journal },
      { label: t('nav.wiki'), items: wiki, groups: wikiByCategory },
      { label: t('nav.operations'), items: operations, groups: opsByCategory },
      { label: t('nav.tasks'), items: tasks },
      { label: t('nav.altar'), items: altars },
      { label: t('trash.altarItems'), items: altarItems },
      { label: t('nav.images'), items: images },
      { label: t('nav.tags'), items: tags },
      { label: t('trash.categories'), items: cats },
      { label: t('trash.blockDefinitions'), items: blockDefs },
      { label: t('trash.templates'), items: templates },
      { label: t('trash.languages'), items: languages },
    ];

    return (
      <div className="space-y-6">
        {sections.filter((section) => section.items.length > 0).map((section) => (
          <div key={section.label}>
            <CollapsibleGroupHeader label={section.label} count={section.items.length} />
            {section.groups && section.groups.length > 1
              ? <div className="space-y-4">
                  {section.groups.map((group) => (
                    <div key={group.label}>
                      <CollapsibleGroupHeader label={categoryGroupLabel(group.label)} />
                      {renderItems(group.items)}
                    </div>
                  ))}
                </div>
              : renderItems(section.items)}
          </div>
        ))}
      </div>
    );
  };

  // ── Timeline ───────────────────────────────────────────────────────────────
  const renderTimeline = () => {
    const byMonth = groupByMonth(sorted, (i) => i.deleted_at);
    return (
      <div className="space-y-6">
        {byMonth.map(({ label, items: monthItems }) => (
          <div key={label}>
            <CollapsibleGroupHeader label={label} />
            <div className="space-y-1.5">
              {monthItems.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const hasSelection = selectedIds.size > 0;
  const allSelected = matching.length > 0 && matching.every((i) => selectedIds.has(i.id));

  // The trash's main action is red and sits at the top of the bar like "+ New …":
  // without a selection "Empty trash", with a selection "Delete
  // selected". The confirmation takes the same spot — the button becomes
  // "Yes", with an X next to it to cancel —, instead of needing a row
  // in the body that would wrap in the narrow bar.
  const confirming = confirm === (hasSelection ? 'selected' : 'empty');
  const confirmNow = () => {
    if (performance.now() - confirmArmedAt.current < CONFIRM_GUARD_MS) return;
    if (hasSelection) void bulkDeleteNow(); else void emptyTrashNow();
  };
  const primaryAction = {
    label: confirming
      ? (hasSelection ? t('trash.confirmDeleteSelected', { count: selectedIds.size }) : t('trash.confirmEmptyAction'))
      : (hasSelection ? t('trash.deleteSelected', { count: selectedIds.size }) : t('trash.emptyTrash')),
    onClick: confirming
      ? confirmNow
      : () => {
          confirmArmedAt.current = performance.now();
          setConfirm(hasSelection ? 'selected' : 'empty');
        },
    danger: true,
    icon: <Trash2 size={14} className="flex-shrink-0" />,
    // An empty trash keeps the button, disabled — the bar stays
    // instead of disappearing on the last deletion.
    disabled: items.length === 0,
  };
  // Beside it: while confirming only the way out, otherwise the selection's own
  // actions, as icons like every secondary action in this bar.
  const extraActions: { label: string; icon: ReactNode; onClick: () => void }[] = [];
  if (confirming) {
    extraActions.push({ label: t('common.cancel'), icon: <X size={14} />, onClick: () => setConfirm(null) });
  } else {
    if (hasSelection) extraActions.push({ label: t('trash.restoreSelected'), icon: <RotateCcw size={14} />, onClick: () => void restoreSelected() });
    if (items.length > 0) {
      extraActions.push(allSelected
        ? { label: t('trash.deselectAll'), icon: <Square size={14} />, onClick: deselectAll }
        : { label: t('trash.selectAll'), icon: <CheckSquare size={14} />, onClick: selectAll });
    }
  }

  const renderTrashContent = () => (
    <>
      {loading && <p className="text-sm text-subtle">{t('common.loading')}</p>}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={AUX_VIEWS.trash.icon}
          title={t('emptyState.trash.title')}
          description={retentionDays === null ? t('trash.retentionNoteNever') : t('trash.retentionNote', { count: retentionDays })}
        />
      )}

      {!loading && items.length > 0 && matching.length === 0 && (
        <NoResults query={search} onReset={() => setSearch('')} />
      )}

      {!loading && matching.length > 0 && (
        <div>
          {restoreFailed && <p className="text-xs text-danger mb-3">{t('trash.restoreFailed')}</p>}
          <p className="text-xs text-subtle mb-3">
            {retentionDays === null ? t('trash.retentionNoteNever') : t('trash.retentionNote', { count: retentionDays })}
          </p>
          {trashPrefs.grouping === 'grouped' && trashPrefs.view !== 'timeline' && renderGrouped(trashPrefs.view)}
          {trashPrefs.grouping !== 'grouped' && trashPrefs.view === 'list'     && <div className="space-y-1.5">{sorted.map((item) => <ItemRow key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.grouping !== 'grouped' && isCardView(trashPrefs.view)  && <div className={cardsGridClass}>{sorted.map((item) => <ItemCard key={item.id} item={item} {...itemProps} />)}</div>}
          {trashPrefs.view === 'timeline' && renderTimeline()}
        </div>
      )}
    </>
  );

  return (
    <Dashboard<TrashedItem>
      title={t('trash.title')}
      primaryAction={primaryAction}
      extraActions={extraActions}
      search={search}
      onSearch={setSearch}
      view={trashPrefs.view}
      sort={trashPrefs.sort}
      sortDate="deleted"
      onView={(v) => setTrashPrefs({ view: v })}
      onSort={(s) => setTrashPrefs({ sort: s })}
      // The trash groups by entry type, not by category.
      groupBy={{ value: trashPrefs.grouping, onChange: (g) => setTrashPrefs({ grouping: g }), label: t('listView.type') }}
      items={items}
      itemKey={(item) => item.id}
      grouping={{ mode: 'custom', render: renderTrashContent }}
      contextMenuSlot={ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('trash.restore'), icon: <RotateCcw size={12} />, onClick: () => void restore(ctxMenu.item) },
            // Nothing can be undone from here, so the row asks first.
            { label: t('trash.deletePermanently'), icon: <Trash2 size={12} />, danger: true, onClick: () => setConfirmingId(ctxMenu.item.id) },
          ]}
        />
      )}
    />
  );
}
