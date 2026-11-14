import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import SettingsSection, { SettingsStatus } from './SettingsSection';

/**
 * Holds the place of sync, which a later version brings back rebuilt. Until
 * then the app is local only; the start page says the same (`PickerServerPanel`).
 */
export default function SyncPage() {
  const { t } = useTranslation();
  return (
    <SettingsSection icon={<Cloud size={14} />} title={t('sync.title')}>
      <SettingsStatus tone="muted">{t('sync.comingLater')}</SettingsStatus>
    </SettingsSection>
  );
}
