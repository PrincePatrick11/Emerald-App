import i18n from '../i18n';
import { generateId } from '../lib/helpers';
import { dashboardOrAll, useDashboardStore } from './dashboardStore';
import { useEntryStore } from './entryStore';
import { useTaskStore } from './taskStore';
import { useUndoStore } from './undoStore';
import { useUIStore } from './uiStore';

/**
 * An entry into the trash, with Undo — from every list and from the entry
 * page itself. A page showing the entry goes back to the dashboard it was
 * opened from. Whoever holds unsaved edits of the entry writes them first
 * (the entry page does), so the trash holds the latest state.
 */
export async function deleteEntryWithUndo(id: string): Promise<void> {
  try {
    await useEntryStore.getState().deleteEntry(id);
  } catch (err) {
    console.error('[entries] deleting failed:', err);
    return;
  }
  useUndoStore.getState().push({
    id: generateId(),
    description: i18n.t('undo.entryDeleted'),
    undo: () => useEntryStore.getState().restoreEntry(id),
  });
  const { activeView, setActiveView } = useUIStore.getState();
  if (activeView.type === 'entry' && activeView.id === id) {
    // A dashboard deleted meanwhile falls back to "All entries", as on the page.
    const dashboard = dashboardOrAll(useDashboardStore.getState().dashboards, activeView.dashboard ?? 'all');
    setActiveView({ type: 'dashboard', id: dashboard?.id ?? 'all' });
  }
}

/** A task into the trash, with Undo — from the left list and from "Tasks". */
export async function deleteTaskWithUndo(id: string): Promise<void> {
  try {
    await useTaskStore.getState().deleteTask(id);
  } catch (err) {
    console.error('[tasks] deleting failed:', err);
    return;
  }
  useUndoStore.getState().push({
    id: generateId(),
    description: i18n.t('undo.taskDeleted'),
    undo: () => useTaskStore.getState().restoreTask(id),
  });
}
