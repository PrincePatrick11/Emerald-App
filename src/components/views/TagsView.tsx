import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { TAG_COLORS, TAG_NAME_TAKEN, randomTagColor, useTagStore } from '../../store/tagStore';
import { useEntryStore } from '../../store/entryStore';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { TAGS_SORTS, isTagsSort, useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { generateId } from '../../lib/helpers';
import { categoryLabel } from '../../lib/categories';
import { formatEntryDate } from '../../lib/formatDate';
import { AUX_VIEWS, MODULES, TAG_MODULE_IDS, type TagModuleId } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { sortItems } from '../../lib/sortItems';
import CollapseChevron from '../ui/CollapseChevron';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem, { DashboardRow, RowContent } from '../ui/DashboardItem';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { ActiveView, Tag } from '../../types';
import { useSessionState } from '../../store/sessionStore';

/** A tagged entry, whatever module it belongs to — the row under a tag. */
interface TaggedItem {
  module: TagModuleId;
  id: string;
  title: string;
  updated_at: string;
  /** Only operations show their category instead of the module name. */
  categoryId?: string | null;
}

type TagUsage = Record<TagModuleId, number>;

const emptyUsage = (): TagUsage => ({ journal: 0, operations: 0, wiki: 0 });

/** Creating and renaming exclude each other — one state instead of two. */
type FormState = { mode: 'add' } | { mode: 'rename'; id: string };

/** Where a click on the row leads. */
function itemView(item: TaggedItem): ActiveView {
  return { type: item.module, id: item.id, mode: 'view' };
}

/** A tag's colour dot; with `onPick`, a click opens the palette. */
function TagColorDot({ color, onPick }: { color: string; onPick?: (color: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutsideClick(open, () => setOpen(false), { refs: [ref], escape: true });

  const dot = <span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />;
  if (!onPick) return dot;
  return (
    <span ref={ref} className="relative flex">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('tags.color')}
        aria-label={t('tags.color')}
        className="rounded-full hover:ring-2 hover:ring-white/30 transition-all"
      >
        {dot}
      </button>
      {open && (
        <div className="tag-color-popover absolute left-0 top-full mt-1.5 z-50 border rounded-lg shadow-menu p-2 flex flex-wrap gap-1.5 w-40">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { onPick(c); setOpen(false); }}
              aria-label={c}
              className={`w-5 h-5 rounded-full hover:scale-125 transition-transform ${c === color ? 'ring-2 ring-white/40' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </span>
  );
}

/** Colour dot in front of the name editor — for creating as well as renaming. */
function TagEditRow({
  color, onColor, name, onName, error, onSave, onCancel,
}: {
  color: string;
  onColor: (color: string) => void;
  name: string;
  onName: (value: string) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DashboardRow>
      {/* Placeholder for the read row's chevron — without it dot
          and name would jump to the left when switching to edit mode. */}
      <span className="w-3.5 flex-shrink-0" />
      <span className="w-5 flex items-center justify-center flex-shrink-0">
        <TagColorDot color={color} onPick={onColor} />
      </span>
      <InlineNameEditor value={name} onChange={onName} error={error} onSave={onSave} onCancel={onCancel}
        placeholder={t('tags.name')} />
    </DashboardRow>
  );
}

/**
 * The management of tags, in the same dashboard as every module: title, "New
 * tag", search, sorting and module filter sit in the right sidebar;
 * in the main area every tag is a row that starts collapsed — the rows are
 * the overview (colour, name, where it occurs), a click on one opens the tagged
 * entries below it, indented like a task's subtasks.
 *
 * Entries carry tag IDs: counting, grouping and collapsing are done by ID.
 */
export default function TagsView() {
  const { t } = useTranslation();
  const { tags, createTag, updateTag, deleteTag, restoreTag } = useTagStore(
    useShallow((s) => ({
      tags: s.tags,
      createTag: s.createTag,
      updateTag: s.updateTag,
      deleteTag: s.deleteTag,
      restoreTag: s.restoreTag,
    })),
  );
  const pushUndo = useUndoStore((s) => s.push);
  // No fetch on mount: reloadAllStores() loads tags and content at startup
  // and on vault switch.
  const entries = useEntryStore((s) => s.entries.journal);
  const articles = useEntryStore((s) => s.entries.wiki);
  const operations = useEntryStore((s) => s.entries.operation);
  const templates = useTemplateStore((s) => s.templates);
  const categories = useCategoryStore((s) => s.categories);
  const sort = useUIStore((s) => s.tagsSort);
  const setSort = useUIStore((s) => s.setTagsSort);
  const { isCollapsed, toggle, expand } = useCollapsedSet('tags', { defaultCollapsed: true });

  const [search, setSearch] = useSessionState('tags.search', '');
  const [moduleFilter, setModuleFilter] = useSessionState<TagModuleId[]>('tags.filter', []);
  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ tagId: string; x: number; y: number } | null>(null);

  // The deep link from the global search expands the tag; search and
  // filter are cleared, otherwise it might not be in the list at all.
  const { scrollTo } = useDeepLink({
    type: 'tags',
    items: tags,
    rowAttribute: 'data-tag-id',
    onOpen: (tag) => {
      setSearch('');
      setModuleFilter([]);
      expand(tag.id);
    },
  });

  /** Tag ID → tagged entries, in module order, within that by title. */
  const itemsByTag = useMemo(() => {
    const map = new Map<string, TaggedItem[]>();
    const add = (tagIds: string[] | undefined, item: TaggedItem) => {
      for (const tagId of tagIds ?? []) {
        const list = map.get(tagId);
        if (list) list.push(item);
        else map.set(tagId, [item]);
      }
    };
    for (const e of entries) add(e.tags, { module: 'journal', id: e.id, title: e.title, updated_at: e.updated_at });
    for (const op of operations) add(op.tags, { module: 'operations', id: op.id, title: op.title, updated_at: op.updated_at, categoryId: op.category_id });
    for (const a of articles) add(a.tags, { module: 'wiki', id: a.id, title: a.title, updated_at: a.updated_at });
    for (const list of map.values()) {
      list.sort((a, b) =>
        TAG_MODULE_IDS.indexOf(a.module) - TAG_MODULE_IDS.indexOf(b.module) || a.title.localeCompare(b.title));
    }
    return map;
  }, [entries, operations, articles]);

  const usageByTag = useMemo(() => {
    const map = new Map<string, TagUsage>();
    for (const [tagId, items] of itemsByTag) {
      const usage = emptyUsage();
      for (const item of items) usage[item.module]++;
      map.set(tagId, usage);
    }
    return map;
  }, [itemsByTag]);

  /** Tag ID → number of templates carrying it. A tag used only there is not unused. */
  const templateUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const template of templates) for (const tagId of template.tags) map.set(tagId, (map.get(tagId) ?? 0) + 1);
    return map;
  }, [templates]);

  const query = search.trim().toLowerCase();
  const filterActive = moduleFilter.length > 0;

  /** What the search leaves of a tag: if its name matches, all its
   *  entries, otherwise those whose title matches. The list and the module
   *  counts share this one rule so the numbers match the list. */
  const matchTag = useCallback((tag: Tag) => {
    const all = itemsByTag.get(tag.id) ?? [];
    const nameMatches = !query || tag.name.toLowerCase().includes(query);
    return { nameMatches, items: nameMatches ? all : all.filter((item) => item.title.toLowerCase().includes(query)) };
  }, [itemsByTag, query]);

  /**
   * A tag is in the list if its name matches the search or entries under
   * it do; a module filter hides tags without a hit entirely.
   * If the search only hits entries, the tag appears with exactly those — and
   * open (`openBySearch`), otherwise the reason for the hit would not be visible.
   */
  const { groups, openBySearch } = useMemo(() => {
    const openIds = new Set<string>();
    const sortedTags = sortItems(tags, sort, {
      date: () => '',
      title: (tag) => tag.name,
      count: (tag) => itemsByTag.get(tag.id)?.length ?? 0,
      tiebreak: (a, b) => a.name.localeCompare(b.name),
    });
    const result: DashboardGroup<TaggedItem>[] = [];
    for (const tag of sortedTags) {
      const { nameMatches, items: matched } = matchTag(tag);
      const items = filterActive ? matched.filter((item) => moduleFilter.includes(item.module)) : matched;
      // Without a hit underneath, a tag stays only if its name matches and no
      // module filter leaves it empty.
      const keep = items.length > 0 || (nameMatches && !filterActive);
      if (!keep) continue;
      if (!nameMatches) openIds.add(tag.id);
      result.push({ key: tag.id, label: tag.name, items });
    }
    return { groups: result, openBySearch: openIds };
  }, [tags, sort, itemsByTag, filterActive, moduleFilter, matchTag]);

  /**
   * Counts for the module filters: how many tags would be there if only this
   * module were chosen — by the same rule as the list, over the search, without
   * the module filter itself. `all` is the number without a module filter.
   */
  const moduleCounts = useMemo(() => {
    const byModule = new Map<string, number>();
    let all = 0;
    for (const tag of tags) {
      const { nameMatches, items } = matchTag(tag);
      if (items.length > 0 || nameMatches) all++;
      for (const module of new Set(items.map((item) => item.module))) {
        byModule.set(module, (byModule.get(module) ?? 0) + 1);
      }
    }
    return { byModule, all };
  }, [tags, matchTag]);

  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // ── Create / rename / delete ──────────────────────────────────────────────
  const openForm = (next: FormState, withName: string, withColor: string) => {
    setNameError(null);
    setName(withName);
    setColor(withColor);
    setForm(next);
  };

  /** A new tag starts with a random colour — like one created in the editor. */
  const openAddForm = () => openForm({ mode: 'add' }, '', randomTagColor());
  const startRename = (tag: Tag) => openForm({ mode: 'rename', id: tag.id }, tag.name, tag.color);

  const closeForm = () => {
    setNameError(null);
    setForm(null);
  };

  const submitForm = async () => {
    const trimmed = name.trim();
    if (!form || !trimmed) return;
    try {
      if (form.mode === 'add') {
        const tag = await createTag(trimmed, color);
        // Search and filter could hide the new, still unused tag.
        setSearch('');
        setModuleFilter([]);
        scrollTo(tag.id);
      } else {
        await updateTag(form.id, { name: trimmed, color });
      }
    } catch (err) {
      // The store throws on a taken name instead of returning an error value.
      if (err instanceof Error && err.message === TAG_NAME_TAKEN) setNameError(t('tags.nameTaken'));
      else console.error('[TagsView] saving the tag failed:', err);
      return;
    }
    closeForm();
  };

  /** To the trash without confirmation, like everything else — the notice offers undo. */
  const handleDelete = async (tag: Tag) => {
    await deleteTag(tag.id);
    pushUndo({
      id: generateId(),
      description: t('undo.tagDeleted'),
      undo: () => restoreTag(tag.id),
    });
  };

  /** One row for creating (at the top of the content) and renaming (in place of the read row). */
  const editRow = (
    <TagEditRow color={color} onColor={setColor} name={name} onName={(v) => { setName(v); setNameError(null); }}
      error={nameError} onSave={submitForm} onCancel={closeForm} />
  );

  // ── Tag rows and tagged entries ─────────────────────────────────────────────────
  const groupCollapsed = (group: DashboardGroup<TaggedItem>) =>
    !openBySearch.has(group.key!) && isCollapsed(group.key!);

  const renderTagHeader = (group: DashboardGroup<TaggedItem>) => {
    const tag = tagById.get(group.key!);
    if (!tag) return null;
    if (form?.mode === 'rename' && form.id === tag.id) {
      return (
        <div data-tag-id={tag.id}>{editRow}</div>
      );
    }
    const usage = usageByTag.get(tag.id);
    const collapsed = groupCollapsed(group);
    return (
      <DashboardRow
        data-tag-id={tag.id}
        onClick={() => toggle(tag.id)}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ tagId: tag.id, x: e.clientX, y: e.clientY }); }}
      >
        {/* The row's own click does the toggling; the chevron only shows it. */}
        <CollapseChevron collapsed={collapsed} onToggle={() => {}} />
        <span onClick={(e) => e.stopPropagation()} className="w-5 flex items-center justify-center flex-shrink-0">
          <TagColorDot color={tag.color} onPick={(color) => updateTag(tag.id, { color })} />
        </span>
        <RowContent title={tag.name} />
        {usage
          ? <ModuleCounts modules={TAG_MODULE_IDS} counts={usage} />
          : <span className="text-xs text-muted flex-shrink-0">
              {templateUsage.has(tag.id) ? t('tags.onlyInTemplates') : t('tags.unused')}
            </span>}
      </DashboardRow>
    );
  };

  const renderItem = (item: TaggedItem) => {
    const meta = MODULES[item.module];
    const Icon = meta.icon;
    let label = t(meta.navLabelKey);
    if (item.module === 'operations') {
      const cat = item.categoryId ? catById.get(item.categoryId) : undefined;
      label = cat ? `${cat.emoji} ${categoryLabel(t, cat)}` : label;
    }
    return (
      <DashboardItem view={itemView(item)} layout="row">
        <RowContent
          icon={<Icon size={14} className="text-subtle" />}
          title={displayTitle(t, meta.entryType, item.title)}
          meta={`${label} · ${formatEntryDate(item.updated_at)}`}
        />
      </DashboardItem>
    );
  };

  const ctxTag = ctxMenu ? tagById.get(ctxMenu.tagId) : undefined;

  return (
    <Dashboard<TaggedItem>
      title={t('nav.tags')}
      primaryAction={{ label: t('tags.new'), onClick: openAddForm }}
      sort={sort}
      onSort={(s) => { if (isTagsSort(s)) setSort(s); }}
      sortModes={TAGS_SORTS}
      search={search}
      onSearch={setSearch}
      filters={{
        activeFilterCount: filterActive ? 1 : 0,
        onClearAll: () => setModuleFilter([]),
        panelProps: {
          chipLabel: t('filters.module'),
          chips: TAG_MODULE_IDS.map((id) => {
            const Icon = MODULES[id].icon;
            return { value: id, label: t(MODULES[id].navLabelKey), icon: <Icon size={14} />, count: moduleCounts.byModule.get(id) ?? 0 };
          }),
          selectedChips: moduleFilter,
          onChipToggle: (v) => setModuleFilter((prev) =>
            prev.includes(v as TagModuleId) ? prev.filter((x) => x !== v) : [...prev, v as TagModuleId]),
          onAllChips: () => setModuleFilter([]),
          allChipsCount: moduleCounts.all,
        },
      }}
      contentHeader={form?.mode === 'add' && <div className="mb-1.5">{editRow}</div>}
      items={groups.flatMap((g) => g.items)}
      itemKey={(item) => `${item.module}:${item.id}`}
      renderItem={renderItem}
      isEmpty={tags.length === 0}
      emptyState={{
        icon: AUX_VIEWS.tags.icon,
        title: t('emptyState.tags.title'),
        description: t('emptyState.tags.description'),
        actionLabel: t('tags.new'),
        onAction: openAddForm,
      }}
      // If no group is left, the category mode reports that itself.
      hasNoResults={false}
      groupsClassName="space-y-1.5"
      listClassName="ml-6 mt-1.5 space-y-1.5"
      grouping={{
        mode: 'category',
        groups,
        renderGroupHeader: renderTagHeader,
        renderEmptyGroup: () => <p className="ml-6 mt-1.5 text-xs text-subtle px-1 py-1">{t('tags.unusedHint')}</p>,
        isGroupCollapsed: groupCollapsed,
        // The selection above has already decided which tags are shown — an
        // unused tag is still one without search and filter.
        keepEmptyGroups: true,
      }}
      contextMenuSlot={ctxMenu && ctxTag && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => startRename(ctxTag) },
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, danger: true, onClick: () => handleDelete(ctxTag) },
          ]}
        />
      )}
    />
  );
}
