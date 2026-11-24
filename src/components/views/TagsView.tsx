import { Fragment, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { TAG_COLORS, TAG_NAME_TAKEN, randomTagColor, useTagStore } from '../../store/tagStore';
import { useEntryStore } from '../../store/entryStore';
import { useUIStore } from '../../store/uiStore';
import { useTemplateStore } from '../../store/templateStore';
import { useImageStore } from '../../store/imageStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { dashboardLabel, entryDateOf } from '../../lib/dashboards';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useNewFormRequest } from '../../hooks/useNewFormRequest';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { useEntryItems, useEntryRows } from '../../hooks/useEntryRows';
import { generateId, listOf } from '../../lib/helpers';
import { sortItems } from '../../lib/sortItems';
import { AUX_VIEWS } from '../../lib/modules';
import CollapseChevron from '../ui/CollapseChevron';
import { DashboardRow, RowContent } from '../ui/DashboardItem';
import InlineConfirm from '../ui/InlineConfirm';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { Entry, Tag } from '../../types';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

/** The date the entries under a tag show and sort by. */
const TAG_ENTRY_DATE = 'updated' as const;

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
 * The tags as a collection: search, a filter by where a tag is used, sorting
 * by name or frequency, list or cards. In the list every tag is a row that
 * starts collapsed — a click on one opens the tagged entries below it,
 * indented like a task's subtasks. A card shows the tag at a glance; a click
 * on it renames it.
 *
 * Entries carry tag IDs: counting, grouping and collapsing are done by ID.
 */
export default function TagsView() {
  const { t, i18n } = useTranslation();
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
  // The entries under a tag open in "All entries" and have an order of their own.
  const entrySort = useUIStore((s) => s.tagEntriesPrefs.sort);
  const setTagEntriesPrefs = useUIStore((s) => s.setTagEntriesPrefs);
  const rows = useEntryRows({ dateField: TAG_ENTRY_DATE });
  const { render: renderEntry, menu: entryMenu } = useEntryItems(rows, entries);
  const templates = useTemplateStore((s) => s.templates);
  const images = useImageStore((s) => s.images);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const state = useCollectionState('tags');
  const { query } = state;
  const { isCollapsed, toggle, expand } = useCollapsedSet('tags', { defaultCollapsed: true });

  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [nameError, setNameError] = useState<string | null>(null);
  /** The tag whose deletion waits for the answer to the warning. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // The deep link from the global search expands the tag; the search and the
  // filter are cleared, otherwise it might not be in the list at all.
  const { scrollTo } = useDeepLink({
    type: 'tags',
    items: tags,
    rowAttribute: 'data-tag-id',
    onOpen: (tag) => {
      state.reset();
      expand(tag.id);
    },
  });

  /** Tag ID → tagged entries, in the chosen order (by the date the rows show). */
  const itemsByTag = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      for (const tagId of e.tags ?? []) {
        const list = map.get(tagId);
        if (list) list.push(e);
        else map.set(tagId, [e]);
      }
    }
    for (const [tagId, list] of map) map.set(tagId, sortItems(list, entrySort, { date: (e) => entryDateOf(e, TAG_ENTRY_DATE) }));
    return map;
  }, [entries, entrySort]);

  /** Tag IDs some template carries. A tag used only there is not unused. */
  const templateTags = useMemo(() => new Set(templates.flatMap((tpl) => tpl.tags)), [templates]);
  /** Tag IDs some picture of "Images" carries: such a tag is not unused either. */
  const imageTags = useMemo(() => new Set(images.flatMap((image) => image.tags)), [images]);

  /** Tag ID → names of the dashboards whose filter names it. */
  const dashboardsByTag = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dashboards) {
      for (const tagId of d.filter.tags ?? []) {
        const names = map.get(tagId);
        if (names) names.push(dashboardLabel(t, d));
        else map.set(tagId, [dashboardLabel(t, d)]);
      }
    }
    return map;
  }, [dashboards, t]);

  const usage = (tag: Tag) => itemsByTag.get(tag.id)?.length ?? 0;
  const inEntries = (tag: Tag) => usage(tag) > 0;
  const inTemplates = (tag: Tag) => templateTags.has(tag.id);
  const inImages = (tag: Tag) => imageTags.has(tag.id);
  const inDashboards = (tag: Tag) => dashboardsByTag.has(tag.id);
  const unused = (tag: Tag) => !inEntries(tag) && !inTemplates(tag) && !inImages(tag) && !inDashboards(tag);

  /** The places a tag without entries is used, as a sentence part: "templates, images". `hint` names the dashboards. */
  const placesOf = (tag: Tag, hint: boolean) => {
    const places: string[] = [];
    if (inTemplates(tag)) places.push(t('tags.placeTemplates'));
    if (inImages(tag)) places.push(t('tags.placeImages'));
    if (inDashboards(tag)) {
      places.push(hint
        ? t('tags.placeDashboardsNamed', { names: listOf(dashboardsByTag.get(tag.id)!, i18n.language) })
        : t('tags.placeDashboards'));
    }
    return listOf(places, i18n.language);
  };

  /** The entries of a tag the search leaves: all if its name matches, otherwise those whose title does. */
  const entriesShown = (tag: Tag) => {
    const all = itemsByTag.get(tag.id) ?? [];
    return !query || tag.name.toLowerCase().includes(query) ? all : all.filter((e) => e.title.toLowerCase().includes(query));
  };
  /** Found only through its entries: then it is open, otherwise the reason for the hit would not be visible. */
  const openBySearch = (tag: Tag) => !!query && !tag.name.toLowerCase().includes(query);

  // ── Create / rename / delete ──────────────────────────────────────────────
  const openForm = (next: FormState, withName: string, withColor: string) => {
    setNameError(null);
    setName(withName);
    setColor(withColor);
    setForm(next);
  };

  /** A new tag starts with a random colour — like one created in the editor. */
  const openAddForm = () => openForm({ mode: 'add' }, '', randomTagColor());
  // The rail's plus: "Tag" opens this view with the row for a new one.
  useNewFormRequest(openAddForm);
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
        // The search and the filter could hide the new, still unused tag.
        state.reset();
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

  /** To the trash with Undo. A tag still on entries warns first: deleting
   *  takes it off all of them at once (Undo puts it back on them). */
  const askOrDelete = (tag: Tag) => {
    if (inEntries(tag)) setConfirmingId(tag.id);
    else void handleDelete(tag);
  };

  const handleDelete = async (tag: Tag) => {
    setConfirmingId(null);
    try {
      await deleteTag(tag.id);
    } catch (err) {
      console.error('[TagsView] deleting the tag failed:', err);
      return;
    }
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

  /** Where a tag occurs: the number of entries, else where else it is used. */
  const usageLabel = (tag: Tag) => (inEntries(tag)
    ? <ModuleCounts modules={['entries'] as const} counts={{ entries: usage(tag) }} />
    : <span className="text-xs text-muted flex-shrink-0">
        {unused(tag) ? t('tags.unused') : t('tags.onlyIn', { places: placesOf(tag, false) })}
      </span>);

  /** In place of the usage, while the warning before deleting is up. */
  const deleteWarning = (tag: Tag, wrap?: boolean) => (
    <span onClick={(e) => e.stopPropagation()} className={wrap ? 'flex min-w-0' : 'flex flex-shrink-0'}>
      <InlineConfirm
        small
        wrap={wrap}
        message={t('tags.deleteWarning', { count: usage(tag) })}
        onConfirm={() => void handleDelete(tag)}
        onCancel={() => setConfirmingId(null)}
      />
    </span>
  );

  // ── The list: tag rows with their entries below ──────────────────────────

  /** Below an open tag without entries: why — it hangs on templates, pictures, dashboard filters, or nowhere. */
  const emptyHint = (tag: Tag) => (unused(tag) ? t('tags.unusedHint') : t('tags.onlyInHint', { places: placesOf(tag, true) }));

  const renderTagRow = (tag: Tag, openMenu: (tag: Tag, e: React.MouseEvent) => void) => {
    if (form?.mode === 'rename' && form.id === tag.id) {
      return <div key={tag.id} data-tag-id={tag.id}>{editRow}</div>;
    }
    const collapsed = !openBySearch(tag) && isCollapsed(tag.id);
    const shownEntries = entriesShown(tag);
    return (
      <div key={tag.id}>
        <DashboardRow
          data-tag-id={tag.id}
          onClick={() => toggle(tag.id)}
          onContextMenu={(e) => openMenu(tag, e)}
        >
          {/* A button of its own for the keyboard; the row's click is for the pointer. */}
          <span onClick={(e) => e.stopPropagation()} className="flex flex-shrink-0">
            <CollapseChevron collapsed={collapsed} onToggle={() => toggle(tag.id)} />
          </span>
          <span onClick={(e) => e.stopPropagation()} className="w-5 flex items-center justify-center flex-shrink-0">
            <TagColorDot color={tag.color} onPick={(c) => updateTag(tag.id, { color: c })} />
          </span>
          <RowContent title={tag.name} />
          {confirmingId === tag.id ? deleteWarning(tag) : usageLabel(tag)}
        </DashboardRow>
        {!collapsed && (shownEntries.length === 0
          ? <p className="ml-6 mt-1.5 text-xs text-subtle px-1 py-1">{emptyHint(tag)}</p>
          : (
            <div className="ml-6 mt-1.5 space-y-1.5">
              {shownEntries.map((e) => <Fragment key={e.id}>{renderEntry(e, 'row', undefined, `${tag.id}:${e.id}`)}</Fragment>)}
            </div>
          ))}
      </div>
    );
  };

  return (
    <>
      <CollectionDashboard<Tag>
        state={state}
        title={t('nav.tags')}
        primaryAction={{ label: t('tags.new'), onClick: openAddForm }}
        items={tags}
        itemKey={(tag) => tag.id}
        itemTitle={(tag) => tag.name}
        itemCount={usage}
        // A tag is found by its name or by the titles of the entries under it.
        matchesSearch={(tag, q) => (itemsByTag.get(tag.id) ?? []).some((e) => e.title.toLowerCase().includes(q))}
        filter={{
          label: t('tags.usage'),
          chips: [
            { value: 'entries', label: t('tags.inEntries'), test: inEntries },
            { value: 'elsewhere', label: t('tags.onlyElsewhereFilter'), hint: t('tags.onlyElsewhereHint'), test: (tag) => !inEntries(tag) && !unused(tag) },
            { value: 'unused', label: t('tags.unusedFilter'), test: unused },
          ],
        }}
        describe={(tag) => ({
          icon: <TagColorDot color={tag.color} />,
          title: tag.name,
          trailing: usageLabel(tag),
          onOpen: () => startRename(tag),
        })}
        renderItem={(tag, layout) => {
          if (layout !== 'card') return undefined;
          if (form?.mode === 'rename' && form.id === tag.id) return editRow;
          if (confirmingId !== tag.id) return undefined;
          // Like renaming: the card turns into a row holding the warning.
          return (
            <DashboardRow className="h-auto min-h-11 py-2">
              <span className="w-5 flex items-center justify-center flex-shrink-0"><TagColorDot color={tag.color} /></span>
              {deleteWarning(tag, true)}
            </DashboardRow>
          );
        }}
        // Cards too: the deep link and a newly created tag scroll to it.
        itemAttribute="data-tag-id"
        renderList={(shown, openMenu) => (
          <div className="space-y-1.5">{shown.map((tag) => renderTagRow(tag, openMenu))}</div>
        )}
        subSort={{
          label: t('tags.entrySort'),
          sort: entrySort,
          onSort: (sort) => setTagEntriesPrefs({ sort }),
          sortDate: TAG_ENTRY_DATE,
        }}
        contextActions={(tag) => [
          { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => startRename(tag) },
          { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, danger: true, onClick: () => askOrDelete(tag) },
        ]}
        emptyState={{
          icon: AUX_VIEWS.tags.icon,
          title: t('emptyState.tags.title'),
          description: t('emptyState.tags.description'),
          actionLabel: t('tags.new'),
          onAction: openAddForm,
        }}
        contentHeader={form?.mode === 'add' && <div className="mb-1.5">{editRow}</div>}
      />
      {entryMenu}
    </>
  );
}
