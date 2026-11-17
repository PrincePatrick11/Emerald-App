import { create } from 'zustand';

/**
 * Which dashboard's settings are open — one dialog for the whole app,
 * mounted by `AppShell`, opened from the rail's menu, the dashboards' own
 * settings button and right after creating a dashboard.
 */
export const useDashboardSettingsStore = create<{ openId: string | null }>(() => ({ openId: null }));

export function openDashboardSettings(id: string): void {
  useDashboardSettingsStore.setState({ openId: id });
}

export function closeDashboardSettings(): void {
  useDashboardSettingsStore.setState({ openId: null });
}
