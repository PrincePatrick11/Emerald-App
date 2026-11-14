import i18n from '../i18n';
import { generateId } from '../lib/helpers';
import { useDashboardStore } from './dashboardStore';
import { useUndoStore } from './undoStore';
import { confirmLeave } from './leaveGuardStore';
import { openDashboardSettings } from './dashboardSettingsStore';
import { ALL_ENTRIES_VIEW, useUIStore } from './uiStore';
import type { ActiveView } from '../types';

/** Does the view show the list of dashboard `id`? Journal, Wiki and Operations are their own view types. */
export function showsDashboard(view: ActiveView, id: string): boolean {
  if (view.type === 'dashboard') return (view.id ?? 'all') === id;
  return view.type === id && !view.id;
}

/**
 * A dashboard into the trash, with Undo — from its settings and the rail's
 * menu. A page showing its list goes to "All entries". "All entries" itself
 * cannot go.
 */
export async function deleteDashboardWithUndo(id: string): Promise<void> {
  const store = useDashboardStore.getState();
  const dashboard = store.dashboards.find((d) => d.id === id);
  if (!dashboard || dashboard.builtin === 'all') return;
  await store.deleteDashboard(id);
  useUndoStore.getState().push({
    id: generateId(),
    description: i18n.t('undo.dashboardDeleted'),
    undo: () => useDashboardStore.getState().restoreDashboard(id, { keepPlace: true }),
  });
  const ui = useUIStore.getState();
  if (showsDashboard(ui.activeView, id)) ui.setActiveView(ALL_ENTRIES_VIEW);
}

/**
 * A new dashboard: created, opened, and its settings shown for name and
 * filter. The question about an open edit comes first, as in `createItem`.
 */
export async function createDashboardAndOpen(): Promise<void> {
  if (useUIStore.getState().editLocked || !(await confirmLeave())) return;
  const dashboard = await useDashboardStore.getState().createDashboard(i18n.t('dashboards.defaultName'));
  useUIStore.getState().setActiveView({ type: 'dashboard', id: dashboard.id });
  openDashboardSettings(dashboard.id);
}
