/**
 * The module registry: one source of truth for "which modules exist and what belongs
 * to each" — icon, nav label, untitled key, view type vocabulary.
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
  FolderOpen,
  Home,
  Languages,
  LayoutList,
  Library,
  ListTodo,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { AltarIcon } from './altarIcon';
import type { ContentType, EntryType } from '../types';

/**
 * Emoji fallback per link type, when neither a custom icon nor a
 * category emoji applies — one source of truth for the chip NodeView, editor lookups,
 * picker, export and migration v36. It lives here instead of in `SuggestionList`
 * because `lib/` modules (down to `db.ts`) need it too and no component
 * may be imported there; `SuggestionList` re-exports it
 * for the components that already get it from there.
 */
export const DEFAULT_ENTRY_EMOJI: Record<ContentType, string> = {
  journal: '📓',
  wiki: '📚',
  operation: '⚡',
  task: '✅',
  altar: '🔥',
};

/**
 * The icon of a wiki article or an operation in lists, on Home, in
 * the left list and in the export: its own (emoji or image), otherwise the
 * category's emoji, otherwise the module's. Either an emoji or an image address
 * — `isImageIcon` tells them apart. Journal entries show their moon phase.
 */
export function entryIcon(
  type: 'wiki' | 'operation',
  entry: { icon?: string | null },
  category: { emoji: string } | null | undefined,
): string {
  return entry.icon || category?.emoji || DEFAULT_ENTRY_EMOJI[type];
}

/**
 * Order = rail and entry-list tab order. Via
 * `CATEGORY_MODULE_IDS` two more things hang on it: the column order of the
 * usage counters in `CategoriesView` and, on a tie, which module
 * `dominantCategoryModule` names as the hint on a search hit. A rearrangement
 * here therefore also renames search hits.
 */
export const ENTRY_MODULE_IDS = ['journal', 'tasks', 'operations', 'wiki', 'altar'] as const;
export type EntryModuleId = (typeof ENTRY_MODULE_IDS)[number];

export const AUX_VIEW_IDS = ['home', 'tags', 'categories', 'blocks', 'templates', 'lexicon', 'trash'] as const;
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

/** Everything `ActiveView.type` can be. */
export type ViewId = EntryModuleId | AuxViewId;

export type LeftListTabId = 'all' | EntryModuleId;
/** The tabs of the entry list in their order — "All" first. */
export const LEFT_LIST_TAB_IDS: readonly LeftListTabId[] = ['all', ...ENTRY_MODULE_IDS];

/** Modules whose entries carry a category — all except journal. */
export const CATEGORY_MODULE_IDS: readonly Exclude<EntryModuleId, 'journal'>[] = ENTRY_MODULE_IDS.filter(
  (id): id is Exclude<EntryModuleId, 'journal'> => id !== 'journal',
);
export type CategoryModuleId = (typeof CATEGORY_MODULE_IDS)[number];

/** Modules whose entries carry tags — all except altar and tasks. */
export const TAG_MODULE_IDS: readonly Exclude<EntryModuleId, 'altar' | 'tasks'>[] = ENTRY_MODULE_IDS.filter(
  (id): id is Exclude<EntryModuleId, 'altar' | 'tasks'> => id !== 'altar' && id !== 'tasks',
);
export type TagModuleId = (typeof TAG_MODULE_IDS)[number];

export interface ModuleMeta {
  id: EntryModuleId;
  icon: LucideIcon;
  navLabelKey: string;
  untitledKey: string;
  /**
   * The data-model counterpart in `task_links.target_type`/drag payloads —
   * `'operation'` singular! tasks/altar are called `'task'`/`'altar'` there.
   */
  entryType: ContentType;
  /** Save/Cancel/Delete live in the right sidebar. */
  usesEditorSidebar: boolean;
  /** The content is a block stack — the sidebar shows the block management. */
  usesBlocks: boolean;
}

export const MODULES: Record<EntryModuleId, ModuleMeta> = {
  journal: { id: 'journal', icon: BookOpen, navLabelKey: 'nav.journal', untitledKey: 'journal.untitled', entryType: 'journal', usesEditorSidebar: true, usesBlocks: true },
  tasks: { id: 'tasks', icon: CheckSquare, navLabelKey: 'nav.tasks', untitledKey: 'tasks.untitled', entryType: 'task', usesEditorSidebar: false, usesBlocks: false },
  operations: { id: 'operations', icon: Wand2, navLabelKey: 'nav.operations', untitledKey: 'operations.untitled', entryType: 'operation', usesEditorSidebar: true, usesBlocks: true },
  wiki: { id: 'wiki', icon: Library, navLabelKey: 'nav.wiki', untitledKey: 'wiki.untitled', entryType: 'wiki', usesEditorSidebar: true, usesBlocks: true },
  altar: { id: 'altar', icon: AltarIcon, navLabelKey: 'nav.altar', untitledKey: 'altar.untitled', entryType: 'altar', usesEditorSidebar: true, usesBlocks: false },
};

export const MODULE_LIST: readonly ModuleMeta[] = ENTRY_MODULE_IDS.map((id) => MODULES[id]);

/** The tabs of the entry list with their icon — "All" is the only one without a module. */
export const LEFT_LIST_TABS: ReadonlyArray<{ id: LeftListTabId; icon: LucideIcon }> = LEFT_LIST_TAB_IDS.map((id) => ({
  id,
  icon: id === 'all' ? LayoutList : MODULES[id].icon,
}));

export const AUX_VIEWS: Record<AuxViewId, { icon: LucideIcon; navLabelKey: string }> = {
  home: { icon: Home, navLabelKey: 'nav.home' },
  tags: { icon: Tag, navLabelKey: 'nav.tags' },
  // The same glyph as `TRASH_KIND_ICONS.category`: a deleted category
  // in the trash and its management should read as the same thing.
  categories: { icon: FolderOpen, navLabelKey: 'nav.categories' },
  trash: { icon: Trash2, navLabelKey: 'nav.trash' },
  blocks: { icon: Box, navLabelKey: 'nav.blocks' },
  // The same glyph as `TRASH_KIND_ICONS.template`.
  templates: { icon: CopyPlus, navLabelKey: 'nav.templates' },
  // The same glyph as `TRASH_KIND_ICONS.language`.
  lexicon: { icon: Languages, navLabelKey: 'nav.lexicon' },
};

const VIEW_ID_SET: ReadonlySet<string> = new Set<string>([...ENTRY_MODULE_IDS, ...AUX_VIEW_IDS]);

/** Guard for persisted tabs: outdated or foreign view types drop out cleanly. */
export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && VIEW_ID_SET.has(value);
}

/** ModuleMeta for a view type — null for home/tags/categories/blocks/templates/trash. */
export function moduleMeta(viewType: string): ModuleMeta | null {
  return (MODULES as Record<string, ModuleMeta | undefined>)[viewType] ?? null;
}

/**
 * The view type an entry of `entryType` opens in.
 *
 * The one rename in the app: the data model says `operation`, singular — it is
 * what `task_links.target_type`, the drag payload and the internal-link mark all
 * carry — while `ActiveView` says `operations`, plural, after the module rather
 * than the record. Journal and wiki spell both the same, which is why the
 * mismatch is easy to forget at exactly the fourth call site.
 *
 * A reverse lookup via the registry instead of a mapping of its own — which makes
 * `ModuleMeta.entryType` the single source of truth for this assignment.
 */
export function viewTypeForEntryType(entryType: ContentType): EntryModuleId {
  const mod = MODULE_LIST.find((meta) => meta.entryType === entryType);
  if (!mod) throw new Error(`No module for entry type "${entryType}"`);
  return mod.id;
}

/**
 * The entry type (`entries.type`) of a view — `undefined` for everything that is
 * not a journal, wiki or operations entry. Like `viewTypeForEntryType`
 * via `ModuleMeta.entryType`, only in the other direction.
 */
export function entryTypeForView(viewType: string): EntryType | undefined {
  const entryType = (MODULES as Partial<Record<string, ModuleMeta>>)[viewType]?.entryType;
  return entryType === 'journal' || entryType === 'wiki' || entryType === 'operation' ? entryType : undefined;
}

/** All trash item types (`TrashedItem['type']`). */
export const TRASH_KINDS = [
  'journal', 'wiki', 'tag', 'operation', 'task', 'category', 'blockDefinition', 'template', 'language', 'altar',
  'altarItem',
] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const TRASH_KIND_ICONS: Record<TrashKind, LucideIcon> = {
  journal: BookOpen,
  wiki: Library,
  tag: Tag,
  operation: Wand2,
  // Deliberately ListTodo instead of the rail icon CheckSquare: in the trash it is
  // the list that stands, not the single completed task.
  task: ListTodo,
  category: FolderOpen,
  blockDefinition: Box,
  template: CopyPlus,
  language: Languages,
  altar: AltarIcon,
  altarItem: Sparkles,
};
