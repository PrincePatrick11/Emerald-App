import { useEntryStore } from '../store/entryStore';
import { dashboardById, useDashboardStore } from '../store/dashboardStore';
import { entriesByKind, entriesOfDashboard } from '../store/entryViews';
import type { EntriesByKind } from '../lib/dashboards';
import type { Dashboard, Entry } from '../types';

/** A live dashboard by ID (the built-ins' IDs are their keys) — `undefined` if it is gone. */
export function useDashboard(id: string | undefined): Dashboard | undefined {
  return useDashboardStore((s) => dashboardById(s.dashboards, id));
}

/**
 * The entries a dashboard shows, in its order — what Journal, Wiki,
 * Operations and every other dashboard list. Empty if the dashboard is gone.
 */
export function useDashboardEntries(id: string | undefined): Entry[] {
  const dashboard = useDashboard(id);
  return useEntryStore((s) => entriesOfDashboard(s.entries, dashboard));
}

/** Every entry under its one kind, for lists labelled by module (search, links, counts). */
export function useEntriesByKind(): EntriesByKind {
  const modules = useDashboardStore((s) => s.modules);
  const entries = useEntryStore((s) => s.entries);
  return entriesByKind(entries, modules);
}
