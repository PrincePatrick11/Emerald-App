import i18n from '../i18n';
import { entryBlockSummary } from './blocks/entrySummary';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useEntryStore } from '../store/entryStore';
import { confirmLeave } from '../store/leaveGuardStore';
import { useLexiconStore } from '../store/lexiconStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import { useUIStore } from '../store/uiStore';
import { useCategoryStore } from '../store/categoryStore';
import { builtinDashboard, useDashboardStore } from '../store/dashboardStore';
import type { ActiveView, BuiltinDashboard } from '../types';
import type { CreatableViewId } from './modules';
import { firstCategoryOf } from './dashboards';

/**
 * The task the Tasks view should open for naming. A task has no page of its
 * own: `createItem` jumps to its row, and the view starts the inline rename.
 * One-shot and not on `ActiveView`, because a tab keeps its view: coming back
 * to the tab would start the rename a second time.
 */
let taskToName: string | null = null;

export function takeTaskToName(id: string): boolean {
  if (taskToName !== id) return false;
  taskToName = null;
  return true;
}

/**
 * Where a new entry opens: for editing — unless its template brought a loaded
 * sigil that locks the entry, which can only be read until it is unloaded.
 */
function newEntryView(type: 'journal' | 'operations' | 'wiki', entry: { id: string; content: string }): ActiveView {
  return entryBlockSummary(entry.id, entry.content).sigil?.lockEntry
    ? { type, id: entry.id, mode: 'view' }
    : { type, id: entry.id, mode: 'edit', isNew: true };
}

/**
 * The category a new entry created in a module's dashboard starts in: the
 * first one of the dashboard's filter that is live — the Journal for the
 * journal. `null` if there is none (the dashboard filters by no category,
 * or is gone).
 */
export function startCategoryOf(dashboard: Exclude<BuiltinDashboard, 'all'>): string | null {
  const live = new Set(useCategoryStore.getState().categories.map((c) => c.id));
  return firstCategoryOf(builtinDashboard(useDashboardStore.getState().dashboards, dashboard), live);
}

/** A new entry in the module's dashboard — in `categoryId` if given, else in its first category. */
async function createInModule(view: 'journal' | 'operations' | 'wiki', categoryId?: string): Promise<ActiveView> {
  const entry = await useEntryStore.getState().createEntry({ categoryId: categoryId ?? startCategoryOf(view) });
  return newEntryView(view, entry);
}

/** Creates the item and returns where it opens. */
const creators: Record<CreatableViewId, (categoryId?: string) => Promise<ActiveView>> = {
  journal: () => createInModule('journal'),
  tasks: async (categoryId) => {
    const task = await useTaskStore.getState().createTask(categoryId ?? null);
    taskToName = task.id;
    return { type: 'tasks', id: task.id };
  },
  operations: (categoryId) => createInModule('operations', categoryId),
  wiki: (categoryId) => createInModule('wiki', categoryId),
  lexicon: async () => {
    const language = await useLexiconStore.getState().createLanguage(i18n.t('lexicon.defaultName'));
    return { type: 'lexicon', id: language.id };
  },
  templates: async () => {
    const template = await useTemplateStore.getState().createTemplate(i18n.t('templates.defaultName'));
    return { type: 'templates', id: template.id, isNew: true };
  },
  blocks: async () => {
    const definition = await useBlockDefinitionStore.getState().createDefinition(i18n.t('blocks.library.defaultName'));
    return { type: 'blocks', id: definition.id, isNew: true };
  },
};

/**
 * "New …": creates an item of this view and opens it, for the rail's plus and the
 * views' own buttons. Tasks' own button is the exception: it names the row in
 * place and must not clear the search and filters of the page it is on.
 *
 * The question about an open edit comes first. `setActiveView` would ask too, but
 * only after the creating: "Keep editing" would leave an unasked-for item behind.
 * The same goes for a page locked by a running write, where it drops the navigation.
 */
export async function createItem(view: CreatableViewId, options: { categoryId?: string } = {}): Promise<void> {
  if (useUIStore.getState().editLocked || !(await confirmLeave())) return;
  const target = await creators[view](options.categoryId);
  useUIStore.getState().setActiveView(target);
}
