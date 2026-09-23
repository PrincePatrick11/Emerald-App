import { useTranslation } from 'react-i18next';
import { ListOrdered, PanelLeft } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { LEFT_LIST_LIMIT_OPTIONS } from '../../../lib/vaultSettings';
import { LEFT_LIST_TABS } from '../../../lib/modules';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Was die Eintragsliste links zeigt: welche Liste, und wie viele Einträge davon. */
export default function SidebarPage() {
  const { t } = useTranslation();
  const leftList = useSettingsStore((s) => s.settings.leftList);
  const update = useSettingsStore((s) => s.update);

  return (
    <>
      <SettingsSection icon={<PanelLeft size={14} />} title={t('settings.sidebarList')} description={t('settings.sidebarListHint')}>
        <SettingsChoiceRow>
          {LEFT_LIST_TABS.map(({ id, icon: Icon }) => (
            <SettingsChoiceButton
              key={id}
              active={leftList.list === id}
              onClick={() => update('leftList', { list: id })}
              className="flex items-center gap-2"
            >
              <Icon size={14} />
              {t(`nav.${id}`)}
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
