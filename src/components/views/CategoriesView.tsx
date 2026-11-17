import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { AUX_VIEWS, CONTENT_MODULE_IDS } from '../../lib/modules';
import { categoryLabel, categoryUsageCounts, emptyCategoryUsage } from '../../lib/categories';
import { dashboardLabel } from '../../lib/dashboards';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { useCategoryStore } from '../../store/categoryStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { useEntryStore } from '../../store/entryStore';
import { useTaskStore } from '../../store/taskStore';
import { useTemplateStore } from '../../store/templateStore';
import { useUndoStore } from '../../store/undoStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { usePointerReorder } from '../../hooks/usePointerReorder';
import { generateId } from '../../lib/helpers';
import DashboardItem, { RowContent } from '../ui/DashboardItem';
import ModuleCounts from '../ui/ModuleCounts';
import CategoryEditModal from '../categories/CategoryEditModal';
import type { Category } from '../../types';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

/** How long the row jumped to via deep link stays highlighted. */
const HIGHLIGHT_MS = 2000;

/** The dialog: a new category, or the one being edited. */
type Editing = { category?: Category } | null;

/**
 * The categories as a collection: search, a filter by the dashboards that
 * show them, sorting (their own hand-dragged order, name, frequency), list or
 * cards. A click opens the dialog with name, emoji and start template
 * (`CategoryEditModal`). In the list under "Custom order", without search and
 * filter, the rows can be dragged into a new order — every category list of
 * the app follows it.
 */
export default function CategoriesView() {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);
  const restoreCategory = useCategoryStore((s) => s.restoreCategory);
  const reorderCategories = useCategoryStore((s) => s.reorderCategories);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const templates = useTemplateStore((s) => s.templates);
  const pushUndo = useUndoStore((s) => s.push);
  const state = useCollectionState('categories');

  // No fetch on mount: reloadAllStores() loads entries and tasks
  // along with categories at startup and on vault switch.
  const entries = useEntryStore((s) => s.entries);
  const tasks = useTaskStore((s) => s.tasks);

  const [editing, setEditing] = useState<Editing>(null);

  /**
   * The deep link from the global search scrolls to the row and briefly
   * highlights it — there is no selection here a hit could otherwise
   * get stuck on.
   */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const { scrollTo } = useDeepLink({
    type: 'categories',
    items: categories,
    rowAttribute: 'data-category-id',
    onOpen: (cat) => {
      state.reset();
      setHighlightId(cat.id);
    },
  });

  // The fade-out hangs on `highlightId`, not on the deep link: there, every
  // category change within the two seconds would clear the timer — the
  // highlight would stay until the view is left.
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  /**
   * Two subtleties of the numbers: subtasks count too (they carry their own
   * `category_id`, which a permanent delete reassigns as well), and the
   * stores only hold live rows — what is in the trash does not count.
   */
  const countsById = useMemo(() => categoryUsageCounts({ entries, tasks }), [entries, tasks]);
  const countsOf = (cat: Category) => countsById.get(cat.id) ?? emptyCategoryUsage();
  const usage = (cat: Category) => {
    const counts = countsOf(cat);
    return CONTENT_MODULE_IDS.reduce((sum, module) => sum + counts[module], 0);
  };

  /** The start template a category shows — only an active one, as `resolveStartTemplate` sees it. */
  const startTemplateMeta = (cat: Category) => {
    const tpl = cat.template_id ? templates.find((x) => x.id === cat.template_id) : undefined;
    return tpl ? t('categories.startTemplateMeta', { name: templateLabel(t, tpl) }) : undefined;
  };

  // ── Drag sorting ──────────────────────────────────────────────────────────
  // The block list's pointer pattern (`usePointerReorder`): no HTML5 drag, no
  // package; the hook measures each row wrapper by its first child, the row.
  const { listRef, visualItems, draggingId, startDrag } = usePointerReorder(
    categories, (ordered) => void reorderCategories(ordered.map((c) => c.id)),
  );

  /** To the trash without confirmation, like everything else — the notice offers undo. */
  const handleDelete = async (cat: Category) => {
    // The store rejects built-in categories. Without this check the interface
    // would report "Category deleted" with an undo button for something that
    // never happened.
    if ((await deleteCategory(cat.id)) === false) return;
    pushUndo({
      id: generateId(),
      description: t('undo.categoryDeleted'),
      undo: async () => { await restoreCategory(cat.id); },
    });
  };

  /**
   * Dragging needs the whole list in its own order: `reorderCategories` writes
   * the complete order, and from a searched or filtered list the order of the
   * hidden categories would not come back.
   */
  const unnarrowed = !state.query && state.filter.length === 0;

  const renderRow = (cat: Category, openMenu: (cat: Category, e: React.MouseEvent) => void, sortsManually: boolean) => {
    const draggable = sortsManually && unnarrowed;
    const isDragging = draggingId === cat.id;
    return (
      <div
        key={cat.id}
        data-category-id={cat.id}
        title={cat.is_builtin ? t('categories.builtinHint') : undefined}
        className={`relative rounded-xl ${isDragging || highlightId === cat.id ? 'row-target' : ''} ${isDragging ? 'opacity-50' : ''}`}
      >
        <DashboardItem layout="row" onOpen={() => setEditing({ category: cat })} onContextMenu={(e) => openMenu(cat, e)}>
          {/* The handle is why this row has more than symbol and name: under
              "Custom order" the order of this list is the hand-dragged one.
              Elsewhere the space is held so names line up. */}
          {sortsManually && (draggable ? (
            <span
              onPointerDown={(e) => { e.stopPropagation(); startDrag(e, cat.id); }}
              onClick={(e) => e.stopPropagation()}
              title={t('categories.dragHint')}
              className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none text-subtle hover:text-muted transition-colors"
            >
              <GripVertical size={12} />
            </span>
          ) : <span className="w-3 flex-shrink-0" />)}
          <RowContent icon={cat.emoji} title={categoryLabel(t, cat)} meta={startTemplateMeta(cat)} />
          <ModuleCounts modules={CONTENT_MODULE_IDS} counts={countsOf(cat)} />
        </DashboardItem>
      </div>
    );
  };

  /** The dashboards with a category filter: each a filter value "shows it". */
  const filteringDashboards = dashboards.filter((d) => d.filter.categories?.length);

  return (
    <>
      <CollectionDashboard<Category>
        state={state}
        title={t('nav.categories')}
        primaryAction={{ label: t('categories.add'), onClick: () => setEditing({}) }}
        // The drag's preview order; without a drag it is `categories` itself.
        items={visualItems}
        itemKey={(cat) => cat.id}
        itemTitle={(cat) => categoryLabel(t, cat)}
        itemCount={usage}
        manualOrder
        filter={{
          label: t('dashboards.dashboard'),
          chips: filteringDashboards.map((d) => ({
            value: d.id,
            label: dashboardLabel(t, d),
            test: (cat) => !!d.filter.categories?.includes(cat.id),
          })),
        }}
        describe={(cat) => ({
          icon: cat.emoji,
          title: categoryLabel(t, cat),
          meta: startTemplateMeta(cat),
          trailing: <ModuleCounts modules={CONTENT_MODULE_IDS} counts={countsOf(cat)} />,
          onOpen: () => setEditing({ category: cat }),
        })}
        renderList={(shown, openMenu, sort) => (
          <div ref={listRef} className="space-y-1.5">
            {shown.map((cat) => renderRow(cat, openMenu, sort === 'manual'))}
          </div>
        )}
        // Cards too: the search's deep link finds and marks the category.
        itemAttribute="data-category-id"
        highlighted={(cat) => cat.id === highlightId}
        contextActions={(cat) => [
          { label: t('editor.edit'), icon: <Pencil size={12} />, onClick: () => setEditing({ category: cat }) },
          ...(cat.is_builtin ? [] : [
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, danger: true, onClick: () => void handleDelete(cat) },
          ]),
        ]}
        emptyState={{
          icon: AUX_VIEWS.categories.icon,
          title: t('emptyState.categories.title'),
          description: t('emptyState.categories.description'),
          actionLabel: t('categories.add'),
          onAction: () => setEditing({}),
        }}
      />
      {editing && (
        <CategoryEditModal
          key={editing.category?.id ?? 'new'}
          category={editing.category}
          onClose={() => setEditing(null)}
          onDelete={(cat) => void handleDelete(cat)}
          // Search and filter could hide the new one: cleared, and it is shown.
          onCreated={(id) => { state.reset(); setHighlightId(id); scrollTo(id); }}
        />
      )}
    </>
  );
}
