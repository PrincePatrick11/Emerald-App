import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/uiStore';
import { dashboardOrAll, useDashboardStore } from '../../store/dashboardStore';
import { createEntryIn } from '../../lib/createItem';
import { dashboardLabel } from '../../lib/dashboards';
import { ALL_ENTRIES_ICON, DEFAULT_DASHBOARD_ICON } from '../../lib/modules';
import EntryDashboard from './EntryDashboard';

/**
 * The list of a dashboard by ID (`{ type: 'dashboard', id }`): "All entries",
 * the built-ins and the user's own. A dashboard that is gone — deleted in
 * another tab — shows "All entries" instead. An entry opens on the entry page
 * inside this dashboard. `dashboardId` overrides the view's ID: the entry page
 * shows its dashboard's list for an entry that no longer exists.
 */
export default function DashboardView({ dashboardId }: { dashboardId?: string } = {}) {
  const { t } = useTranslation();
  const viewId = useUIStore((s) => s.activeView.id);
  const id = dashboardId ?? viewId ?? 'all';
  const dashboard = useDashboardStore((s) => dashboardOrAll(s.dashboards, id));
  const isAll = dashboard?.builtin === 'all';

  const onNew = (categoryId?: string) => {
    if (!dashboard) return;
    createEntryIn(dashboard.id, { categoryId }).catch((e: unknown) => console.error('[DashboardView] creating failed:', e));
  };

  return (
    <EntryDashboard
      // Keyed: the toolbar's rename and context menu belong to one dashboard.
      key={dashboard?.id}
      dashboard={dashboard}
      title={dashboard ? dashboardLabel(t, dashboard) : t('nav.allEntries')}
      newLabel={t('dashboards.newEntry')}
      onNew={onNew}
      emptyState={{
        icon: isAll ? ALL_ENTRIES_ICON : DEFAULT_DASHBOARD_ICON,
        title: t(isAll ? 'emptyState.allEntries.title' : 'emptyState.dashboard.title'),
        description: t(isAll ? 'emptyState.allEntries.description' : 'emptyState.dashboard.description'),
      }}
    />
  );
}
