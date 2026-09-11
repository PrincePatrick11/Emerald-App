import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { TAG_COLORS, TAG_NAME_TAKEN, randomTagColor, useTagStore } from '../../store/tagStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
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
import { sortItems } from '../../lib/sortItems';
import Button from '../ui/Button';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import InlineConfirm from '../ui/InlineConfirm';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { ActiveView, Tag } from '../../types';

/** Ein getaggter Eintrag, gleich welchen Moduls — die Zeile unter einem Tag. */
interface TaggedItem {
  module: TagModuleId;
  id: string;
  title: string;
  updated_at: string;
  /** Nur Operationen zeigen ihre Kategorie statt des Modulnamens. */
  categoryId?: string | null;
}

type TagUsage = Record<TagModuleId, number>;

const emptyUsage = (): TagUsage => ({ journal: 0, tasks: 0, operations: 0, wiki: 0 });

/** Anlegen und Umbenennen schließen sich aus — ein Zustand statt zwei. */
type FormState = { mode: 'add' } | { mode: 'rename'; id: string };

/** Wohin ein Klick auf die Zeile führt — Aufgaben öffnen ihre Liste mit Sprungziel. */
function itemView(item: TaggedItem): ActiveView {
  return item.module === 'tasks'
    ? { type: 'tasks', id: item.id }
    : { type: item.module, id: item.id, mode: 'view' };
}

/** Der Farbpunkt eines Tags; mit `onPick` öffnet ein Klick die Palette. */
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
        <div className="tag-color-popover absolute left-0 top-full mt-1.5 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2 flex flex-wrap gap-1.5 w-40">
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

/** Farbpunkt vor dem Namens-Editor — für Anlegen wie Umbenennen. */
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
    <div className="flex items-center gap-2 mb-2">
      {/* Platzhalter für den Chevron der Lesezeile — ohne ihn sprängen Punkt
          und Name beim Wechsel in den Bearbeitungsmodus nach links. */}
      <span className="w-3.5 flex-shrink-0" />
      <span className="w-5 flex items-center justify-center flex-shrink-0">
        <TagColorDot color={color} onPick={onColor} />
      </span>
      <InlineNameEditor value={name} onChange={onName} error={error} onSave={onSave} onCancel={onCancel}
        placeholder={t('tags.name')} />
    </div>
  );
}

/**
 * Die Verwaltung der Tags, im selben Dashboard wie jedes Modul: Titel, „Neuer
 * Tag", Suche, Sortierung und Modul-Filter stehen in der rechten Seitenleiste;
 * im Hauptbereich ist jeder Tag eine Gruppe, die zugeklappt startet — die
 * Köpfe sind die Übersicht (Farbe, Name, wo er vorkommt), aufgeklappt stehen
 * die getaggten Einträge darunter.
 *
 * Einträge speichern Tag-*Namen*, keine ids. Gezählt und gruppiert wird darum
 * nach Namen; geklappt nach id, damit ein umbenannter Tag offen bleibt.
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
  // Kein fetch beim Mount: reloadAllStores() lädt Tags und Inhalte beim Start
  // und beim Vault-Wechsel.
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  const tasks = useTaskStore((s) => s.tasks);
  const categories = useCategoryStore((s) => s.categories);
  const sort = useUIStore((s) => s.tagsSort);
  const setSort = useUIStore((s) => s.setTagsSort);
  const { isCollapsed, toggle, expand } = useCollapsedSet('tags', { defaultCollapsed: true });

  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<TagModuleId[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ tagId: string; x: number; y: number } | null>(null);

  // Der Tiefenlink aus der globalen Suche klappt den Tag auf; Suche und
  // Filter werden geleert, sonst stünde er womöglich gar nicht in der Liste.
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

  /** Tag-Name → getaggte Einträge, in Modul-Reihenfolge, darin nach Titel. */
  const itemsByTag = useMemo(() => {
    const map = new Map<string, TaggedItem[]>();
    const add = (tagNames: string[] | undefined, item: TaggedItem) => {
      for (const tagName of tagNames ?? []) {
        const list = map.get(tagName);
        if (list) list.push(item);
        else map.set(tagName, [item]);
      }
    };
    for (const e of entries) add(e.tags, { module: 'journal', id: e.id, title: e.title, updated_at: e.updated_at });
    for (const task of tasks) add(task.tags, { module: 'tasks', id: task.id, title: task.title, updated_at: task.updated_at });
    for (const op of operations) add(op.tags, { module: 'operations', id: op.id, title: op.title, updated_at: op.updated_at, categoryId: op.category_id });
    for (const a of articles) add(a.tags, { module: 'wiki', id: a.id, title: a.title, updated_at: a.updated_at });
    for (const list of map.values()) {
      list.sort((a, b) =>
        TAG_MODULE_IDS.indexOf(a.module) - TAG_MODULE_IDS.indexOf(b.module) || a.title.localeCompare(b.title));
    }
    return map;
  }, [entries, tasks, operations, articles]);

  const usageByTag = useMemo(() => {
    const map = new Map<string, TagUsage>();
    for (const [tagName, items] of itemsByTag) {
      const usage = emptyUsage();
      for (const item of items) usage[item.module]++;
      map.set(tagName, usage);
    }
    return map;
  }, [itemsByTag]);

  const query = search.trim().toLowerCase();
  const filterActive = moduleFilter.length > 0;

  /**
   * Ein Tag steht in der Liste, wenn sein Name zur Suche passt oder Einträge
   * darunter es tun; ein Modul-Filter blendet Tags ohne Treffer ganz aus.
   * Trifft die Suche nur Einträge, steht der Tag mit genau denen da — und
   * offen (`openBySearch`), sonst sähe man den Grund für den Treffer nicht.
   */
  const { groups, openBySearch } = useMemo(() => {
    const openIds = new Set<string>();
    const sortedTags = sortItems(tags, sort, {
      date: () => '',
      title: (tag) => tag.name,
      count: (tag) => itemsByTag.get(tag.name)?.length ?? 0,
      tiebreak: (a, b) => a.name.localeCompare(b.name),
    });
    const result: DashboardGroup<TaggedItem>[] = [];
    for (const tag of sortedTags) {
      const all = itemsByTag.get(tag.name) ?? [];
      const inModules = filterActive ? all.filter((item) => moduleFilter.includes(item.module)) : all;
      const nameMatches = !query || tag.name.toLowerCase().includes(query);
      const items = nameMatches ? inModules : inModules.filter((item) => item.title.toLowerCase().includes(query));
      // Ohne Treffer darunter bleibt ein Tag nur, wenn sein Name passt und kein
      // Modul-Filter ihn leer zurücklässt.
      const keep = items.length > 0 || (nameMatches && !filterActive);
      if (!keep) continue;
      if (!nameMatches) openIds.add(tag.id);
      result.push({ key: tag.id, label: tag.name, items });
    }
    return { groups: result, openBySearch: openIds };
  }, [tags, sort, itemsByTag, filterActive, moduleFilter, query]);

  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // ── Anlegen / Umbenennen / Löschen ────────────────────────────────────────
  const openForm = (next: FormState, withName: string, withColor: string) => {
    setConfirmDeleteId(null);
    setNameError(null);
    setName(withName);
    setColor(withColor);
    setForm(next);
  };

  /** Ein neuer Tag startet mit einer Zufallsfarbe — wie ein im Editor angelegter. */
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
        // Suche und Filter könnten den neuen, noch unbenutzten Tag verbergen.
        setSearch('');
        setModuleFilter([]);
        scrollTo(tag.id);
      } else {
        await updateTag(form.id, { name: trimmed, color });
      }
    } catch (err) {
      // Der Store wirft bei vergebenem Namen, statt einen Fehlerwert zu liefern.
      if (err instanceof Error && err.message === TAG_NAME_TAKEN) setNameError(t('tags.nameTaken'));
      else console.error('[TagsView] saving the tag failed:', err);
      return;
    }
    closeForm();
  };

  /** Erster Aufruf fragt nach, zweiter löscht. */
  const handleDelete = async (tag: Tag) => {
    if (confirmDeleteId !== tag.id) {
      setConfirmDeleteId(tag.id);
      return;
    }
    setConfirmDeleteId(null);
    await deleteTag(tag.name);
    pushUndo({
      id: generateId(),
      description: t('undo.tagDeleted'),
      undo: () => restoreTag(tag.id),
    });
  };

  /** Eine Zeile für Anlegen (oben im Inhalt) und Umbenennen (statt des Kopfes). */
  const editRow = (
    <TagEditRow color={color} onColor={setColor} name={name} onName={(v) => { setName(v); setNameError(null); }}
      error={nameError} onSave={submitForm} onCancel={closeForm} />
  );

  // ── Gruppenkopf und Zeilen ────────────────────────────────────────────────
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
    const confirming = confirmDeleteId === tag.id;
    const usage = usageByTag.get(tag.name);
    return (
      <div
        data-tag-id={tag.id}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ tagId: tag.id, x: e.clientX, y: e.clientY }); }}
      >
        <CollapsibleGroupHeader
          collapsed={groupCollapsed(group)}
          onToggleCollapse={() => toggle(tag.id)}
          leading={<TagColorDot color={tag.color} onPick={(color) => updateTag(tag.id, { color })} />}
          label={tag.name}
          meta={usage
            ? <ModuleCounts modules={TAG_MODULE_IDS} counts={usage} />
            : <span className="text-xs text-stone-600">{t('tags.unused')}</span>}
          actions={confirming ? (
            <InlineConfirm small onConfirm={() => handleDelete(tag)} onCancel={() => setConfirmDeleteId(null)} />
          ) : (
            // Dauerhaft sichtbar wie in der Kategorien-Ansicht.
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <Button tone="amber" compact small title={t('contextMenu.rename')} aria-label={t('contextMenu.rename')}
                onClick={() => startRename(tag)}>
                <Pencil size={12} />
              </Button>
              <Button tone="danger" compact small title={t('contextMenu.delete')} aria-label={t('contextMenu.delete')}
                onClick={() => handleDelete(tag)}>
                <Trash2 size={12} />
              </Button>
            </span>
          )}
        />
      </div>
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
        <Icon size={14} className="text-stone-500 flex-shrink-0" />
        <span className="flex-1 text-sm text-stone-300 truncate">{item.title || t(meta.untitledKey)}</span>
        <span className="text-xs text-parchment-500/70 flex-shrink-0">{label} · {formatEntryDate(item.updated_at)}</span>
      </DashboardItem>
    );
  };

  const ctxTag = ctxMenu ? tagById.get(ctxMenu.tagId) : undefined;

  return (
    <Dashboard<TaggedItem>
      headerLeft={
        <div className="flex items-center gap-3 min-w-0">
          <AUX_VIEWS.tags.icon size={18} className="text-stone-500 flex-shrink-0" />
          <h1 className="text-lg font-semibold text-stone-100 truncate">{t('nav.tags')}</h1>
          <span className="text-xs text-stone-500 bg-stone-700/50 px-2 py-0.5 rounded-full">{tags.length}</span>
        </div>
      }
      primaryAction={{ label: t('tags.new'), onClick: openAddForm }}
      sort={sort}
      onSort={(s) => { if (isTagsSort(s)) setSort(s); }}
      sortModes={TAGS_SORTS}
      search={search}
      onSearch={setSearch}
      filters={{
        activeFilterCount: filterActive ? 1 : 0,
        panelProps: {
          chipLabel: t('filters.module'),
          chips: TAG_MODULE_IDS.map((id) => {
            const Icon = MODULES[id].icon;
            return { value: id, label: t(MODULES[id].navLabelKey), icon: <Icon size={12} /> };
          }),
          selectedChips: moduleFilter,
          onChipToggle: (v) => setModuleFilter((prev) =>
            prev.includes(v as TagModuleId) ? prev.filter((x) => x !== v) : [...prev, v as TagModuleId]),
          onAllChips: () => setModuleFilter([]),
          onClearAll: () => setModuleFilter([]),
        },
      }}
      contentHeader={form?.mode === 'add' && editRow}
      items={groups.flatMap((g) => g.items)}
      itemKey={(item) => `${item.module}:${item.id}`}
      renderItem={renderItem}
      isEmpty={tags.length === 0}
      emptyState={{ message: t('tags.none'), actionLabel: t('tags.new'), onAction: openAddForm }}
      // Bleibt keine Gruppe übrig, meldet der category-Modus das selbst.
      hasNoResults={false}
      noResultsMessage={t('search.noResults')}
      grouping={{
        mode: 'category',
        groups,
        renderGroupHeader: renderTagHeader,
        renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('tags.unusedHint')}</p>,
        isGroupCollapsed: groupCollapsed,
        // Die Auswahl oben hat schon entschieden, welche Tags stehen — ein
        // unbenutzter Tag ist ohne Suche und Filter trotzdem einer.
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
