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
import { dashboardById, useDashboardStore } from '../store/dashboardStore';
import { viewOfEntry } from '../store/entryViews';
import type { ActiveView } from '../types';
import { isEntryView, type CreatableViewId } from './modules';
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
 * The category a new entry created in a dashboard starts in: the first one
 * of the dashboard's filter that is live — the Journal for the journal.
 * `null` if there is none (the dashboard filters by no category, or is gone).
 * The built-ins' IDs are their keys, so `'journal'` works as well.
 */
export function startCategoryOf(dashboardId: string): string | null {
  const live = new Set(useCategoryStore.getState().categories.map((c) => c.id));
  return firstCategoryOf(dashboardById(useDashboardStore.getState().dashboards, dashboardId), live);
}

/**
 * A new entry in the dashboard `dashboardId` — in `categoryId` if given, else
 * in its first category. Journal, Wiki and Operations open it in their own
 * view; any other dashboard in the view its category leads to.
 */
async function createInDashboard(dashboardId: string, categoryId?: string): Promise<ActiveView> {
  const entry = await useEntryStore.getState().createEntry({ categoryId: categoryId ?? startCategoryOf(dashboardId) });
  return newEntryView(isEntryView(dashboardId) ? dashboardId : viewOfEntry(entry), entry);
}

/** Creates the item and returns where it opens. */
const creators: Record<CreatableViewId, (categoryId?: string) => Promise<ActiveView>> = {
  tasks: async (categoryId) => {
    const task = await useTaskStore.getState().createTask(categoryId ?? null);
    taskToName = task.id;
    return { type: 'tasks', id: task.id };
  },
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

/** "New entry" in a dashboard: the rail's plus, its own button and its category headers' "+". */
export async function createEntryIn(dashboardId: string, options: { categoryId?: string } = {}): Promise<void> {
  if (useUIStore.getState().editLocked || !(await confirmLeave())) return;
  const target = await createInDashboard(dashboardId, options.categoryId);
  useUIStore.getState().setActiveView(target);
}
