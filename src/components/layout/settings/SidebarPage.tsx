import { useTranslation } from 'react-i18next';
import { ListOrdered, PanelLeft } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { LEFT_LIST_LIMIT_OPTIONS } from '../../../lib/vaultSettings';
import { TASKS_VIEW } from '../../../lib/modules';
import { dashboardLabel } from '../../../lib/dashboards';
import { useDashboardStore } from '../../../store/dashboardStore';
import DashboardGlyph from '../../ui/DashboardGlyph';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** What the entry list on the left shows: which list, and how many entries of it. */
export default function SidebarPage() {
  const { t } = useTranslation();
  const leftList = useSettingsStore((s) => s.settings.leftList);
  const update = useSettingsStore((s) => s.update);
  const dashboards = useDashboardStore((s) => s.dashboards);
  // "All entries" first, then the dashboards in rail order, then the tasks — the
  // same as the rail. A list whose dashboard is gone shows "All entries".
  const current = leftList.list === 'tasks' || dashboards.some((d) => d.id === leftList.list) ? leftList.list : 'all';
  const choices = [
    ...dashboards.filter((d) => d.builtin === 'all'),
    ...dashboards.filter((d) => d.builtin !== 'all'),
  ].map((d) => ({
    id: d.id,
    label: dashboardLabel(t, d),
    icon: <DashboardGlyph dashboard={d} size={14} />,
  }));
  const TasksIcon = TASKS_VIEW.icon;
  choices.push({ id: 'tasks', label: t('nav.tasks'), icon: <TasksIcon size={14} /> });

  return (
    <>
      <SettingsSection icon={<PanelLeft size={14} />} title={t('settings.sidebarList')} description={t('settings.sidebarListHint')}>
        <SettingsChoiceRow>
          {choices.map(({ id, label, icon }) => (
            <SettingsChoiceButton
              key={id}
              active={current === id}
              onClick={() => update('leftList', { list: id })}
              className="flex items-center gap-2"
            >
              {icon}
              {label}
            </SettingsChoiceButton>
          ))}
        </SettingsChoiceRow>
      </SettingsSection>

      <SettingsSection icon={<ListOrdered size={14} />} title={t('settings.sidebarLimit')} description={t('settings.sidebarLimitHint')}>
        <SettingsChoiceRow>
          {LEFT_LIST_LIMIT_OPTIONS.map((limit) => (
            <SettingsChoiceButton
              key={limit ?? 'all'}
              active={leftList.limit === limit}
              onClick={() => update('leftList', { limit })}
              className="tabular-nums"
            >
              {limit === null ? t('settings.sidebarLimitAll') : limit}
            </SettingsChoiceButton>
          ))}
        </SettingsChoiceRow>
      </SettingsSection>
    </>
  );
}
