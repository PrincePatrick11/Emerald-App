import { dashboardSort, sortFromMode, sortModeOf, DEFAULT_DISPLAY } from '../lib/dashboards';
import { useDashboardStore } from '../store/dashboardStore';
import type { ListPrefs } from '../store/uiStore';
import type { Dashboard } from '../types';

/**
 * A dashboard's view, sorting and grouping as the toolbar speaks them, read
 * from and written to its row — so they survive a restart and travel with
 * the backup. `dateField` is the date the date sort compares when the
 * dashboard sorted by title until now.
 */
export function useDashboardPrefs(
  dashboard: Dashboard | undefined,
  dateField: 'created' | 'updated',
): [ListPrefs, (patch: Partial<ListPrefs>) => void] {
  const updateDashboard = useDashboardStore((s) => s.updateDashboard);
  const display = dashboard?.display ?? DEFAULT_DISPLAY;
  const sort = dashboardSort(dashboard);
  const prefs: ListPrefs = { view: display.view, grouping: display.grouping, sort: sortModeOf(sort) };

  const setPrefs = (patch: Partial<ListPrefs>) => {
    if (!dashboard) return;
    void updateDashboard(dashboard.id, {
      display: { ...display, view: patch.view ?? display.view, grouping: patch.grouping ?? display.grouping },
      sort: patch.sort ? sortFromMode(patch.sort, sort, dateField) : sort,
    }).catch((e: unknown) => console.error('[useDashboardPrefs] saving failed:', e));
  };

  return [prefs, setPrefs];
}
