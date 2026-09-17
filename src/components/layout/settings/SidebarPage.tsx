import { useTranslation } from 'react-i18next';
import { ListOrdered, PanelLeft } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { LEFT_LIST_LIMIT_OPTIONS } from '../../../lib/vaultSettings';
import { ENTRY_LIST_TABS } from '../LeftSidebarEntryList';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Was die Eintragsliste links zeigt: welche Listen, und wie viele Einträge davon. */
export default function SidebarPage() {
  const { t } = useTranslation();
  const leftList = useSettingsStore((s) => s.settings.leftList);
  const update = useSettingsStore((s) => s.update);

  function toggleTab(id: (typeof ENTRY_LIST_TABS)[number]['id']) {
    const visible = leftList.tabs.includes(id);
    // Die letzte sichtbare Liste bleibt — eine Leiste ohne Tabs hätte nichts zu zeigen.
    if (visible && leftList.tabs.length === 1) return;
    // In der Reihenfolge der Leiste speichern, nicht in der des Anklickens.
    const tabs = ENTRY_LIST_TABS
      .map((tab) => tab.id)
      .filter((tabId) => (tabId === id ? !visible : leftList.tabs.includes(tabId)));
    update('leftList', { tabs });
  }

  return (
    <>
      <SettingsSection icon={<PanelLeft size={14} />} title={t('settings.sidebarLists')}>
        <div className="flex gap-2 flex-wrap">
          {ENTRY_LIST_TABS.map(({ id, icon: Icon }) => {
            const active = leftList.tabs.includes(id);
            return (
              <SettingsChoiceButton
                key={id}
                active={active}
                aria-pressed={active}
                disabled={active && leftList.tabs.length === 1}
                onClick={() => toggleTab(id)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm disabled:cursor-default"
              >
                <Icon size={14} />
                {t(`nav.${id}`)}
              </SettingsChoiceButton>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection icon={<ListOrdered size={14} />} title={t('settings.sidebarLimit')}>
        <div className="flex gap-2 flex-wrap">
          {LEFT_LIST_LIMIT_OPTIONS.map((limit) => (
            <SettingsChoiceButton
              key={limit ?? 'all'}
              active={leftList.limit === limit}
              onClick={() => update('leftList', { limit })}
              className="px-3 py-1.5 text-sm tabular-nums"
            >
              {limit === null ? t('settings.sidebarLimitAll') : limit}
            </SettingsChoiceButton>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}
