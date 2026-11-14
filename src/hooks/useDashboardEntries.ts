import { useEntryStore } from '../store/entryStore';
import { builtinDashboard, useDashboardStore } from '../store/dashboardStore';
import { entriesByKind, entriesOfDashboard } from '../store/entryViews';
import type { EntriesByKind } from '../lib/dashboards';
import type { BuiltinDashboard, Entry } from '../types';

/**
 * The entries a built-in dashboard shows, in its order — what Journal, Wiki
 * and Operations list. Empty if the dashboard is gone.
 */
export function useDashboardEntries(key: BuiltinDashboard): Entry[] {
  const dashboard = useDashboardStore((s) => builtinDashboard(s.dashboards, key));
  return useEntryStore((s) => entriesOfDashboard(s.entries, dashboard));
}

/** Every entry under its one kind, for lists labelled by module (search, links, counts). */
export function useEntriesByKind(): EntriesByKind {
  const modules = useDashboardStore((s) => s.modules);
  const entries = useEntryStore((s) => s.entries);
  return entriesByKind(entries, modules);
}
