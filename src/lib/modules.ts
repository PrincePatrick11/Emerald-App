/**
 * Die Modul-Registry: eine Wahrheit für „welche Module gibt es und was gehört
 * zu jedem" — Icon, nav-Label, Untitled-Key, View-Typ-Vokabular.
 *
 * Import-Regel dieser Datei: nur lucide-react und Typ-Importe. Keine Stores,
 * keine React-Komponenten — Stores verdrahtet `store/moduleWiring.ts`, die
 * lazy geladenen Views hält `components/layout/moduleViews.ts`. Diese
 * Schichtung verhindert Import-Zyklen (uiStore braucht die Typen hier) und
 * hält die View-Chunks aus dem Start-Bundle.
 *
 * Die Kante zu `types/index.ts` verläuft in beide Richtungen, aber nur auf
 * Typ-Ebene (`import type`) — sie wird beim Kompilieren gelöscht. Sobald eine
 * Seite einen Laufzeit-Wert der anderen importiert, wird daraus ein echter
 * Zyklus: nicht tun.
 */
import {
  BookOpen,
  CheckSquare,
  Flame,
  FolderOpen,
  Home,
  Library,
  ListTodo,
  Tag,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { ContentType } from '../types';

/** Reihenfolge = Rail- und Eintragslisten-Tab-Reihenfolge. */
export const ENTRY_MODULE_IDS = ['journal', 'tasks', 'operations', 'wiki', 'altar'] as const;
export type EntryModuleId = (typeof ENTRY_MODULE_IDS)[number];

export const AUX_VIEW_IDS = ['home', 'tags', 'trash'] as const;
export type AuxViewId = (typeof AUX_VIEW_IDS)[number];

/** Alles, was `ActiveView.type` sein kann. */
export type ViewId = EntryModuleId | AuxViewId;

export type LeftListTabId = 'all' | EntryModuleId;

/** Module mit eigenem Kategorien-Slice (Suche, Kategorie-Treffer) — alle außer Journal. */
export type CategoryModuleId = Exclude<EntryModuleId, 'journal'>;

export interface ModuleMeta {
  id: EntryModuleId;
  icon: LucideIcon;
  navLabelKey: string;
  untitledKey: string;
  /**
   * Das Datenmodell-Gegenstück in `links.target_type`/Drag-Payloads —
   * `'operation'` singular! tasks/altar sind keine Link-Ziele: null.
   */
  entryType: ContentType | null;
  /** Save/Cancel/Delete leben in der rechten Seitenleiste. */
  usesEditorSidebar: boolean;
}

export const MODULES: Record<EntryModuleId, ModuleMeta> = {
  journal: { id: 'journal', icon: BookOpen, navLabelKey: 'nav.journal', untitledKey: 'journal.untitled', entryType: 'journal', usesEditorSidebar: true },
  tasks: { id: 'tasks', icon: CheckSquare, navLabelKey: 'nav.tasks', untitledKey: 'tasks.untitled', entryType: null, usesEditorSidebar: false },
  operations: { id: 'operations', icon: Wand2, navLabelKey: 'nav.operations', untitledKey: 'operations.untitled', entryType: 'operation', usesEditorSidebar: true },
  wiki: { id: 'wiki', icon: Library, navLabelKey: 'nav.wiki', untitledKey: 'wiki.untitled', entryType: 'wiki', usesEditorSidebar: true },
  altar: { id: 'altar', icon: Flame, navLabelKey: 'nav.altar', untitledKey: 'altar.untitled', entryType: null, usesEditorSidebar: true },
};

export const MODULE_LIST: readonly ModuleMeta[] = ENTRY_MODULE_IDS.map((id) => MODULES[id]);

export const AUX_VIEWS: Record<AuxViewId, { icon: LucideIcon; navLabelKey: string }> = {
  home: { icon: Home, navLabelKey: 'nav.home' },
  tags: { icon: Tag, navLabelKey: 'nav.tags' },
  trash: { icon: Trash2, navLabelKey: 'nav.trash' },
};

const VIEW_ID_SET: ReadonlySet<string> = new Set<string>([...ENTRY_MODULE_IDS, ...AUX_VIEW_IDS]);

/** Guard für persistierte Tabs: veraltete oder fremde View-Typen fallen sauber weg. */
export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && VIEW_ID_SET.has(value);
}

/** ModuleMeta zu einem View-Typ — null für home/tags/trash. */
export function moduleMeta(viewType: string): ModuleMeta | null {
  return (MODULES as Record<string, ModuleMeta | undefined>)[viewType] ?? null;
}

/**
 * The view type an entry of `entryType` opens in.
 *
 * The one rename in the app: the data model says `operation`, singular — it is
 * what `links.target_type`, the drag payload and the internal-link mark all
 * carry — while `ActiveView` says `operations`, plural, after the module rather
 * than the record. Journal and wiki spell both the same, which is why the
 * mismatch is easy to forget at exactly the fourth call site.
 *
 * Reverse-Lookup über die Registry statt eines eigenen Mappings — damit ist
 * `ModuleMeta.entryType` die eine Wahrheit für diese Zuordnung.
 */
export function viewTypeForEntryType(entryType: ContentType): EntryModuleId {
  const mod = MODULE_LIST.find((meta) => meta.entryType === entryType);
  if (!mod) throw new Error(`No module for entry type "${entryType}"`);
  return mod.id;
}

/** Alle Papierkorb-Eintragstypen (`TrashedItem['type']`). */
export const TRASH_KINDS = [
  'journal', 'wiki', 'tag', 'operation', 'wiki_category', 'operation_category', 'task', 'task_category',
] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const TRASH_KIND_ICONS: Record<TrashKind, LucideIcon> = {
  journal: BookOpen,
  wiki: Library,
  tag: Tag,
  operation: Wand2,
  wiki_category: FolderOpen,
  operation_category: FolderOpen,
  // Bewusst ListTodo statt des Rail-Icons CheckSquare: im Papierkorb steht die
  // Liste, nicht die einzelne erledigte Aufgabe.
  task: ListTodo,
  task_category: FolderOpen,
};
