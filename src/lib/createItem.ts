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
import { entryView } from '../store/entryViews';
import type { ActiveView } from '../types';
import type { CreatableViewId } from './modules';
import { firstCategoryOf, firstTagOf } from './dashboards';
import { useTagStore } from '../store/tagStore';

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
 * The collection view that should open its own "New" — the category dialog,
 * the tag row, the picture dialog — because the plus asked for it. Those views
 * create in their own form, so the plus only opens the view and the form; the
 * view takes this once, by the very `ActiveView` the plus navigated to —
 * compared by identity, since `setActiveView` stores the object it is given
 * and every navigation makes a new one. One-shot for the same reason as `taskToName`.
 */
let newFormFor: ActiveView | null = null;

export function takeNewForm(view: ActiveView): boolean {
  if (newFormFor !== view) return false;
  newFormFor = null;
  return true;
}

function requestNewForm(type: 'categories' | 'tags' | 'images'): () => Promise<ActiveView> {
  return async () => {
    newFormFor = { type };
    return newFormFor;
  };
}

/**
 * Where a new entry opens: for editing — unless its template brought a loaded
 * sigil that locks the entry, which can only be read until it is unloaded.
 */
function newEntryView(dashboard: string, entry: { id: string; content: string }): ActiveView {
  return entryBlockSummary(entry.id, entry.content).sigil?.lockEntry
    ? entryView(entry.id, dashboard)
    : { ...entryView(entry.id, dashboard, 'edit'), isNew: true };
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

/** The tags a new entry created in a dashboard starts with: the first live one of its filter. */
export function startTagsOf(dashboardId: string): string[] {
  const live = new Set(useTagStore.getState().tags.map((t) => t.id));
  const tag = firstTagOf(dashboardById(useDashboardStore.getState().dashboards, dashboardId), live);
  return tag ? [tag] : [];
}

/**
 * A new entry in the dashboard `dashboardId` — in `categoryId` if given, else
 * in its first category, and with the first tag of its filter. It opens on the
 * entry page inside that dashboard.
 */
async function createInDashboard(dashboardId: string, categoryId?: string): Promise<ActiveView> {
  const entry = await useEntryStore.getState().createEntry({
    categoryId: categoryId ?? startCategoryOf(dashboardId),
    tagIds: startTagsOf(dashboardId),
  });
  return newEntryView(dashboardId, entry);
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
    return { type: 'lexicon', id: language.id, mode: 'edit', isNew: true };
  },
  templates: async () => {
    const template = await useTemplateStore.getState().createTemplate(i18n.t('templates.defaultName'));
    return { type: 'templates', id: template.id, isNew: true };
  },
  blocks: async () => {
    const definition = await useBlockDefinitionStore.getState().createDefinition(i18n.t('blocks.library.defaultName'));
    return { type: 'blocks', id: definition.id, isNew: true };
  },
  categories: requestNewForm('categories'),
  tags: requestNewForm('tags'),
  images: requestNewForm('images'),
};

/**
 * "New …": creates an item of this view and opens it, for the rail's plus and the
 * views' own buttons. Tasks' own button is the exception: it names the row in
 * place and must not clear the search and filters of the page it is on.
 * Categories, tags and images only open their view with its own form (`takeNewForm`).
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
