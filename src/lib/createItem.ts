import i18n from '../i18n';
import { useAltarStore } from '../store/altarStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useEntryStore } from '../store/entryStore';
import { confirmLeave } from '../store/leaveGuardStore';
import { useLexiconStore } from '../store/lexiconStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import { useUIStore } from '../store/uiStore';
import type { ActiveView } from '../types';
import type { CreatableViewId } from './modules';

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

/** Creates the item and returns where it opens. */
const creators: Record<CreatableViewId, (categoryId?: string) => Promise<ActiveView>> = {
  journal: async () => {
    const entry = await useEntryStore.getState().createEntry('journal');
    return { type: 'journal', id: entry.id, mode: 'edit', isNew: true };
  },
  tasks: async (categoryId) => {
    const task = await useTaskStore.getState().createTask(categoryId ?? null);
    taskToName = task.id;
    return { type: 'tasks', id: task.id };
  },
  operations: async (categoryId) => {
    const entry = await useEntryStore.getState().createEntry('operation', { categoryId });
    return { type: 'operations', id: entry.id, mode: 'edit', isNew: true };
  },
  wiki: async (categoryId) => {
    const entry = await useEntryStore.getState().createEntry('wiki', { categoryId });
    return { type: 'wiki', id: entry.id, mode: 'edit', isNew: true };
  },
  altar: async () => {
    const altar = await useAltarStore.getState().createAltar();
    return { type: 'altar', id: altar.id, mode: 'edit', isNew: true };
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
