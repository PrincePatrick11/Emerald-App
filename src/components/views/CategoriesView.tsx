import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { CATEGORY_MODULE_IDS } from '../../lib/modules';
import { categoryLabel, categoryUsageCounts, emptyCategoryUsage } from '../../lib/categories';
import { CATEGORY_NAME_TAKEN, useCategoryStore } from '../../store/categoryStore';
import { useEntryStore } from '../../store/entryStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { useUndoStore } from '../../store/undoStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { generateId } from '../../lib/helpers';
import ContextMenu from '../ui/ContextMenu';
import { DashboardRow, RowContent } from '../ui/DashboardItem';
import { NoResults } from '../ui/EmptyState';
import Dashboard from '../ui/Dashboard';
import EmojiPicker from '../ui/EmojiPicker';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { Category } from '../../types';
import { useSessionState } from '../../store/sessionStore';

/** Default on creation: module-neutral, the same glyph as the catch-all. */
const DEFAULT_EMOJI = '📦';

/** How long the row jumped to via deep link stays highlighted. */
const HIGHLIGHT_MS = 2000;

/**
 * Creating and editing exclude each other — one state instead of two parallel
 * triples, so that this does not merely live in the reset lists of several handlers.
 */
type FormState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

/**
 * Emoji trigger in front of the name editor — the one row for draft and
 * editing. As a component with named props: as a helper with six
 * positional parameters, emoji and name (both `string`) or
 * save and cancel (both `() => void`) could be swapped silently.
 */
function CategoryEditRow({
  emoji, onEmoji, name, onName, error, onSave, onCancel,
}: {
  emoji: string;
  onEmoji: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DashboardRow>
      {/* Placeholder for the read row's drag handle — without it emoji
          and name would jump to the left when switching to edit mode. */}
      <span className="w-3 flex-shrink-0" />
      <EmojiPicker
        value={emoji}
        onChange={onEmoji}
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
          >
            {emoji}
          </button>
        )}
      />
      <InlineNameEditor value={name} onChange={onName} error={error} onSave={onSave} onCancel={onCancel}
        placeholder={t('categories.name')} />
    </DashboardRow>
  );
}

/**
 * The one place managing the global category list: create, rename,
 * emoji, delete, order. The modules only assign categories now and
 * group by them — this is where the list belongs as a list, along with the
 * answer to who uses a category at all.
 *
 * `Dashboard` supplies the header — title, "Add category" and the search —
 * and portals it into the right sidebar as in every module, as soon as that
 * is open. View and sorting are left out: this list's order is the
 * hand-dragged `sort_order`, a sort dropdown on top of it would contradict
 * itself. The content runs through `grouping: { mode: 'custom' }`, because
 * the list knows neither groups nor cards.
 */
export default function CategoriesView() {
  const { t } = useTranslation();
  const { categories, addCategory, updateCategory, deleteCategory, restoreCategory, reorderCategories } =
    useCategoryStore(
      useShallow((s) => ({
        categories: s.categories,
        addCategory: s.addCategory,
        updateCategory: s.updateCategory,
        deleteCategory: s.deleteCategory,
        restoreCategory: s.restoreCategory,
        reorderCategories: s.reorderCategories,
      })),
    );
  const pushUndo = useUndoStore((s) => s.push);

  // No fetch on mount: reloadAllStores() loads entries, tasks and altar
  // along with categories at startup and on vault switch.
  const articles = useEntryStore((s) => s.entries.wiki);
  const operations = useEntryStore((s) => s.entries.operation);
  const tasks = useTaskStore((s) => s.tasks);
  const items = useAltarStore((s) => s.items);

  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [search, setSearch] = useSessionState('categories.search', '');
  /** Error message next to the name field — today only "Name already taken". */
  const [nameError, setNameError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  /**
   * The deep link from the global search scrolls to the row and briefly
   * highlights it — there is no selection here a hit could otherwise
   * get stuck on.
   */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useDeepLink({
    type: 'categories',
    items: categories,
    rowAttribute: 'data-category-id',
    onOpen: (cat) => setHighlightId(cat.id),
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
  const countsById = useMemo(
    () => categoryUsageCounts({ wiki: articles, operations, tasks, altar: items }),
    [articles, operations, tasks, items],
  );

  // ── Drag sorting ──────────────────────────────────────────────────────────
  // The same pointer pattern as the layer list in the altar panel: no
  // HTML5 drag, no package. `visualRef` holds the final order for the
  // pointerup closure, which would otherwise see the state from drag start.
  const [dragState, setDragState] = useState<{ fromId: string; overIndex: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<Category[]>([]);

  const query = search.trim().toLowerCase();
  /**
   * The search only thins the list out. Dragging is locked while it is active:
   * `reorderCategories` writes the complete order, and from a filtered list the
   * order of the hidden categories would not come back.
   */
  const matches = useMemo(
    () => (query ? categories.filter((c) => categoryLabel(t, c).toLowerCase().includes(query)) : categories),
    [categories, query, t],
  );

  const visualCategories = useMemo(() => {
    if (!dragState) return matches;
    const list = [...categories];
    const fromIdx = list.findIndex((c) => c.id === dragState.fromId);
    if (fromIdx < 0) return categories;
    const [item] = list.splice(fromIdx, 1);
    list.splice(Math.min(dragState.overIndex, list.length), 0, item);
    return list;
  }, [dragState, categories, matches]);
  useEffect(() => { visualRef.current = visualCategories; }, [visualCategories]);

  const startDrag = useCallback((e: React.PointerEvent, fromId: string) => {
    e.preventDefault();
    const fromIndex = categories.findIndex((c) => c.id === fromId);
    setDragState({ fromId, overIndex: fromIndex });

    const getOverIndex = (clientY: number): number => {
      if (!listRef.current) return fromIndex;
      const rows = Array.from(listRef.current.children) as HTMLElement[];
      let best = 0, bestDist = Infinity;
      rows.forEach((row, i) => {
        const rect = row.getBoundingClientRect();
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      return best;
    };

    const onMove = (ev: PointerEvent) => {
      setDragState((prev) => (prev ? { ...prev, overIndex: getOverIndex(ev.clientY) } : null));
    };
    const onUp = () => {
      const order = visualRef.current.map((c) => c.id);
      // A misclick on the handle should not trigger an UPDATE across the whole table.
      if (order.some((id, i) => categories[i]?.id !== id)) reorderCategories(order);
      setDragState(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [categories, reorderCategories]);

  // ── Create / edit / delete ────────────────────────────────────────────────
  const openForm = (next: FormState, withName: string, withEmoji: string) => {
    setNameError(null);
    setName(withName);
    setEmoji(withEmoji);
    setForm(next);
  };

  const closeForm = () => {
    setNameError(null);
    setForm(null);
  };

  /** Creates or saves the change — depending on which form is open. */
  const submitForm = async () => {
    const trimmed = name.trim();
    if (!form || !trimmed) return;
    try {
      if (form.mode === 'add') await addCategory(trimmed, emoji);
      else await updateCategory(form.id, trimmed, emoji);
    } catch (err) {
      // The store throws on a taken name instead of returning an error value.
      if (err instanceof Error && err.message === CATEGORY_NAME_TAKEN) setNameError(t('categories.nameTaken'));
      else console.error('[CategoriesView] saving the category failed:', err);
      return;
    }
    closeForm();
  };

  /** To the trash without confirmation, like everything else — the notice offers undo. */
  const handleDelete = async (id: string) => {
    // The store rejects built-in categories. Without this check the interface
    // would report "Category deleted" with an undo button for something that
    // never happened.
    if ((await deleteCategory(id)) === false) return;
    pushUndo({
      id: generateId(),
      description: t('undo.categoryDeleted'),
      undo: async () => { await restoreCategory(id); },
    });
  };

  const formProps = {
    emoji,
    onEmoji: setEmoji,
    name,
    onName: (value: string) => { setName(value); setNameError(null); },
    error: nameError,
    onSave: submitForm,
    onCancel: closeForm,
  };

  // ── Rows ──────────────────────────────────────────────────────────────────
  const renderRow = (cat: Category) => {
    if (form?.mode === 'edit' && form.id === cat.id) {
      return <CategoryEditRow key={cat.id} {...formProps} />;
    }

    const counts = countsById.get(cat.id) ?? emptyCategoryUsage();
    const isDragging = dragState?.fromId === cat.id;

    return (
      <DashboardRow
        key={cat.id}
        data-category-id={cat.id}
        title={cat.is_builtin ? t('categories.builtinHint') : undefined}
        className={`${isDragging || highlightId === cat.id ? 'row-target' : ''} ${isDragging ? 'opacity-50' : ''}`}
        // Sigils: not deletable, and a rename would lead nowhere — the name
        // comes from the locale, not from the row. So no menu for them.
        onContextMenu={cat.is_builtin ? undefined : (e) => {
          e.preventDefault();
          setCtxMenu({ id: cat.id, x: e.clientX, y: e.clientY });
        }}
      >
        {/* The handle is why this row has more than symbol and name: the
            order of this list is the hand-dragged one. */}
        {query ? (
          // Hold the space so the filtered list does not jump by 12px.
          <span className="w-3 flex-shrink-0" />
        ) : (
          <span
            onPointerDown={(e) => startDrag(e, cat.id)}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none text-subtle hover:text-muted transition-colors"
          >
            <GripVertical size={12} />
          </span>
        )}
        <RowContent icon={cat.emoji} title={categoryLabel(t, cat)} />
        <ModuleCounts modules={CATEGORY_MODULE_IDS} counts={counts} />
      </DashboardRow>
    );
  };

  const menuCategory = ctxMenu && categories.find((c) => c.id === ctxMenu.id);

  return (
    <Dashboard<Category>
      title={t('nav.categories')}
      primaryAction={{ label: t('categories.add'), onClick: () => openForm({ mode: 'add' }, '', DEFAULT_EMOJI) }}
      search={search}
      onSearch={setSearch}
      items={categories}
      itemKey={(cat) => cat.id}
      grouping={{
        mode: 'custom',
        render: () => (
          <div>
            {!query && <p className="text-xs text-subtle mb-3">{t('categories.dragHint')}</p>}
            {query && visualCategories.length === 0 && <NoResults query={search} onReset={() => setSearch('')} />}
            <div ref={listRef} className="space-y-1.5">
              {visualCategories.map(renderRow)}
            </div>
            {/* The draft deliberately sits outside the list: it would otherwise
                be one more child for the drag's index calculation to trip over. */}
            {form?.mode === 'add' && (
              <div className="mt-1.5">
                <CategoryEditRow {...formProps} />
              </div>
            )}
          </div>
        ),
      }}
      contextMenuSlot={ctxMenu && menuCategory && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('editor.edit'), icon: <Pencil size={12} />, onClick: () => openForm({ mode: 'edit', id: menuCategory.id }, menuCategory.name, menuCategory.emoji) },
            { label: t('common.delete'), icon: <Trash2 size={12} />, danger: true, onClick: () => void handleDelete(menuCategory.id) },
          ]}
        />
      )}
    />
  );
}
