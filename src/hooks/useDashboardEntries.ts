import { useEntryStore } from '../store/entryStore';
import { dashboardById, useDashboardStore } from '../store/dashboardStore';
import { useCategoryStore } from '../store/categoryStore';
import { useTagStore } from '../store/tagStore';
import { entriesOfDashboard } from '../store/entryViews';
import type { Dashboard, Entry } from '../types';

/** A live dashboard by ID (the built-ins' IDs are their keys) — `undefined` if it is gone. */
function useDashboard(id: string | undefined): Dashboard | undefined {
  return useDashboardStore((s) => dashboardById(s.dashboards, id));
}

/** The entries a dashboard shows, in its order. Empty if the dashboard is gone. */
export function useDashboardEntries(id: string | undefined): Entry[] {
  const dashboard = useDashboard(id);
  const categories = useCategoryStore((s) => s.categories);
  const tags = useTagStore((s) => s.tags);
  return useEntryStore((s) => entriesOfDashboard(s.entries, dashboard, categories, tags));
}
