/**
 * The module registry: one source of truth for "which modules exist and what belongs
 * to each" — icon, nav label, view type vocabulary.
 *
 * Import rule of this file: only lucide-react and type imports. No stores,
 * no React components — `store/moduleWiring.ts` wires the stores, and the
 * lazily loaded views are held by `components/layout/moduleViews.ts`. This
 * layering prevents import cycles (uiStore needs the types here) and
 * keeps the view chunks out of the startup bundle.
 *
 * The edge to `types/index.ts` runs in both directions, but only at
 * type level (`import type`) — it is erased at compile time. As soon as one
 * side imports a runtime value from the other, it becomes a real
 * cycle: don't.
 */
import {
  BookOpen,
  Box,
  CheckSquare,
  CopyPlus,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Languages,
  LayoutList,
  Library,
  Images,
  ListTodo,
  Tag,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { BuiltinDashboard, Dashboard } from '../types';

/**
 * The content modules: the entries (one store, shown by the dashboards) and
 * the tasks. What `moduleWiring` reloads; an entry has no module of its own
 * beyond that — what it is follows from its category.
 */
export const CONTENT_MODULE_IDS = ['entries', 'tasks'] as const;
export type ContentModuleId = (typeof CONTENT_MODULE_IDS)[number];

/**
 * `dashboard` is a dashboard's list by its ID (`{ type: 'dashboard', id }`):
 * "All entries" (`id: 'all'`), the built-ins and the user's own. `entry` is
 * the one entry page (`{ type: 'entry', id, dashboard }`), shown inside the
 * dashboard it was opened from.
 */
export const AUX_VIEW_IDS = ['dashboard', 'entry', 'tags', 'categories', 'images', 'blocks', 'templates', 'lexicon', 'trash'] as const;
export type AuxViewId = (typeof AUX_VIEW_IDS)[number];

/**
 * Libraries whose entries open as a page of their own (`{ type, id }`).
 * Such a page is always in edit mode, gets its own tab and
 * needs the right sidebar.
 *
 * Two of them — custom blocks and templates — only save on "Done"
 * (`LibraryPageFrame`, `useDraftPage`). The lexicon's language page does not:
 * it saves every row immediately and has no draft. What this list
 * governs is only the three things above, and that holds for all three.
 */
export const LIBRARY_VIEW_IDS = ['blocks', 'templates', 'lexicon'] as const;
export type LibraryViewId = (typeof LIBRARY_VIEW_IDS)[number];

export function isLibraryView(viewType: string): viewType is LibraryViewId {
  return (LIBRARY_VIEW_IDS as readonly string[]).includes(viewType);
}

/** What can be newly created besides entries (`createEntryIn`): tasks and the libraries. */
export type CreatableViewId = 'tasks' | LibraryViewId;

/** The rail's "All entries" — the one dashboard that cannot go. */
export const ALL_ENTRIES_ICON: LucideIcon = LayoutList;

/** The rail glyph of a dashboard without an icon of its own. */
export const DEFAULT_DASHBOARD_ICON: LucideIcon = LayoutDashboard;

/** The glyph of "an entry" where no entry icon is drawn — the same as `TRASH_KIND_ICONS.entry`. */
export const ENTRY_ICON: LucideIcon = FileText;

/** Everything `ActiveView.type` can be. */
export type ViewId = 'tasks' | AuxViewId;

/**
 * Which list the left sidebar shows: `all` (every entry and task), `tasks`, or
 * a dashboard by ID. A dashboard that is gone falls back to `all`.
 */
export type LeftListTabId = string;

/** The tasks view in the rail and the plus. */
export const TASKS_VIEW: { icon: LucideIcon; navLabelKey: string } = { icon: CheckSquare, navLabelKey: 'nav.tasks' };

export const AUX_VIEWS: Record<Exclude<AuxViewId, 'entry'>, { icon: LucideIcon; navLabelKey: string }> = {
  dashboard: { icon: ALL_ENTRIES_ICON, navLabelKey: 'nav.allEntries' },
  tags: { icon: Tag, navLabelKey: 'nav.tags' },
  // The same glyph as `TRASH_KIND_ICONS.category`: a deleted category
  // in the trash and its management should read as the same thing.
  categories: { icon: FolderOpen, navLabelKey: 'nav.categories' },
  // The same glyph as `TRASH_KIND_ICONS.image`.
  images: { icon: Images, navLabelKey: 'nav.images' },
  trash: { icon: Trash2, navLabelKey: 'nav.trash' },
  blocks: { icon: Box, navLabelKey: 'nav.blocks' },
  // The same glyph as `TRASH_KIND_ICONS.template`.
  templates: { icon: CopyPlus, navLabelKey: 'nav.templates' },
  // The same glyph as `TRASH_KIND_ICONS.language`.
  lexicon: { icon: Languages, navLabelKey: 'nav.lexicon' },
};

/**
 * What the rail's plus offers besides the dashboards (`CreateItemModal` puts
 * one tile per dashboard first): tasks, then the libraries.
 */
export const CREATABLE_VIEWS: ReadonlyArray<{ id: CreatableViewId; icon: LucideIcon; navLabelKey: string }> = [
  { id: 'tasks', ...TASKS_VIEW },
  { id: 'lexicon', ...AUX_VIEWS.lexicon },
  { id: 'templates', ...AUX_VIEWS.templates },
  { id: 'blocks', ...AUX_VIEWS.blocks },
];

/**
 * The glyphs of the built-in dashboards — of the dashboard rows, not of the
 * entries they show.
 */
const BUILTIN_DASHBOARD_ICONS: Record<BuiltinDashboard, LucideIcon> = {
  all: ALL_ENTRIES_ICON,
  journal: BookOpen,
  wiki: Library,
  operations: Wand2,
};

/**
 * The rail glyph of a dashboard without an icon of its own: a built-in's
 * glyph, or the dashboard glyph. Callers draw an own icon (`FaviconGlyph`)
 * first, each in its own size.
 */
export function dashboardIcon(dashboard: Pick<Dashboard, 'builtin'>): LucideIcon {
  return dashboard.builtin ? BUILTIN_DASHBOARD_ICONS[dashboard.builtin] : DEFAULT_DASHBOARD_ICON;
}

const VIEW_ID_SET: ReadonlySet<string> = new Set<string>(['tasks', ...AUX_VIEW_IDS]);

/** Guard for persisted tabs: outdated or foreign view types drop out cleanly. */
export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && VIEW_ID_SET.has(value);
}

/** All trash item types (`TrashedItem['type']`). Entries are one kind: they have no type of their own. */
export const TRASH_KINDS = [
  'entry', 'dashboard', 'tag', 'task', 'category', 'blockDefinition', 'template', 'language', 'image',
] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const TRASH_KIND_ICONS: Record<TrashKind, LucideIcon> = {
  entry: FileText,
  dashboard: LayoutDashboard,
  tag: Tag,
  // Deliberately ListTodo instead of the rail icon CheckSquare: in the trash it is
  // the list that stands, not the single completed task.
  task: ListTodo,
  category: FolderOpen,
  blockDefinition: Box,
  template: CopyPlus,
  language: Languages,
  image: Images,
};
