import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { TAG_COLORS, TAG_NAME_TAKEN, randomTagColor, useTagStore } from '../../store/tagStore';
import { useEntryStore } from '../../store/entryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTemplateStore } from '../../store/templateStore';
import { useImageStore } from '../../store/imageStore';
import { useCategoryStore } from '../../store/categoryStore';
import { TAGS_SORTS, isTagsSort, useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { generateId } from '../../lib/helpers';
import { categoryLabel, lookupCategory } from '../../lib/categories';
import { entryIcon } from '../../lib/entryIcon';
import { formatEntryDate } from '../../lib/formatDate';
import { AUX_VIEWS } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { sortItems } from '../../lib/sortItems';
import CollapseChevron from '../ui/CollapseChevron';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem, { DashboardRow, ItemGlyph, RowContent } from '../ui/DashboardItem';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { Entry, Tag } from '../../types';
import { entryView } from '../../store/entryViews';
import { useSessionState } from '../../store/sessionStore';

/** A tagged entry — the row under a tag. Only entries carry tags (templates and pictures are counted apart). */
type TaggedItem = Entry;

/** Creating and renaming exclude each other — one state instead of two. */
type FormState = { mode: 'add' } | { mode: 'rename'; id: string };

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
 * The management of tags, in the same dashboard as every list: title, "New
 * tag", search and sorting sit in the right sidebar;
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
  const entries = useEntryStore((s) => s.entries);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const templates = useTemplateStore((s) => s.templates);
  const images = useImageStore((s) => s.images);
  const categories = useCategoryStore((s) => s.categories);
  const sort = useUIStore((s) => s.tagsSort);
  const setSort = useUIStore((s) => s.setTagsSort);
  const { isCollapsed, toggle, expand } = useCollapsedSet('tags', { defaultCollapsed: true });

  const [search, setSearch] = useSessionState('tags.search', '');
  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ tagId: string; x: number; y: number } | null>(null);

  // The deep link from the global search expands the tag; the search is
  // cleared, otherwise it might not be in the list at all.
  const { scrollTo } = useDeepLink({
    type: 'tags',
    items: tags,
    rowAttribute: 'data-tag-id',
    onOpen: (tag) => {
      setSearch('');
      expand(tag.id);
    },
  });

  /** Tag ID → tagged entries, by title. */
  const itemsByTag = useMemo(() => {
    const map = new Map<string, TaggedItem[]>();
    for (const e of entries) {
      for (const tagId of e.tags ?? []) {
        const list = map.get(tagId);
        if (list) list.push(e);
        else map.set(tagId, [e]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [entries]);

  /** Tag ID → number of templates carrying it. A tag used only there is not unused. */
  const templateUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const template of templates) for (const tagId of template.tags) map.set(tagId, (map.get(tagId) ?? 0) + 1);
    return map;
  }, [templates]);

  /** Tag IDs some picture of "Images" carries: such a tag is not unused either. */
  const imageTags = useMemo(() => new Set(images.flatMap((image) => image.tags)), [images]);

  const query = search.trim().toLowerCase();

  /** What the search leaves of a tag: if its name matches, all its
   *  entries, otherwise those whose title matches. */
  const matchTag = useCallback((tag: Tag) => {
    const all = itemsByTag.get(tag.id) ?? [];
    const nameMatches = !query || tag.name.toLowerCase().includes(query);
    return { nameMatches, items: nameMatches ? all : all.filter((item) => item.title.toLowerCase().includes(query)) };
  }, [itemsByTag, query]);

  /**
   * A tag is in the list if its name matches the search or entries under
   * it do.
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
      const { nameMatches, items } = matchTag(tag);
      if (items.length === 0 && !nameMatches) continue;
      if (!nameMatches) openIds.add(tag.id);
      result.push({ key: tag.id, label: tag.name, items });
    }
    return { groups: result, openBySearch: openIds };
  }, [tags, sort, itemsByTag, matchTag]);

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
        // The search could hide the new, still unused tag.
        setSearch('');
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
    const usage = itemsByTag.get(tag.id)?.length ?? 0;
    const collapsed = groupCollapsed(group);
    return (
      <DashboardRow
        data-tag-id={tag.id}
        onClick={() => toggle(tag.id)}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ tagId: tag.id, x: e.clientX, y: e.clientY }); }}
      >
        {/* A button of its own for the keyboard; the row's click is for the pointer. */}
        <span onClick={(e) => e.stopPropagation()} className="flex flex-shrink-0">
          <CollapseChevron collapsed={collapsed} onToggle={() => toggle(tag.id)} />
        </span>
        <span onClick={(e) => e.stopPropagation()} className="w-5 flex items-center justify-center flex-shrink-0">
          <TagColorDot color={tag.color} onPick={(color) => updateTag(tag.id, { color })} />
        </span>
        <RowContent title={tag.name} />
        {usage
          ? <ModuleCounts modules={['entries'] as const} counts={{ entries: usage }} />
          : <span className="text-xs text-muted flex-shrink-0">
              {templateUsage.has(tag.id) ? t('tags.onlyInTemplates') : imageTags.has(tag.id) ? t('tags.onlyInImages') : t('tags.unused')}
            </span>}
      </DashboardRow>
    );
  };

  const renderItem = (item: TaggedItem) => {
    const cat = lookupCategory(catById, item.category_id);
    const meta = [categoryLabel(t, cat), formatEntryDate(item.updated_at)].filter(Boolean).join(' · ');
    return (
      <DashboardItem view={entryView(item.id)} layout="row">
        <RowContent
          icon={<ItemGlyph icon={entryIcon(item, cat, showMoonPhase)} />}
          title={displayTitle(t, 'entry', item.title)}
          meta={meta}
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
      contentHeader={form?.mode === 'add' && <div className="mb-1.5">{editRow}</div>}
      items={groups.flatMap((g) => g.items)}
      itemKey={(item) => item.id}
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
