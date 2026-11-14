import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import StartSection from './start/StartSection';

/**
 * The start page's server card, holding the place of sync until a later
 * version brings it back rebuilt: a panel to read, nothing to act on.
 * Settings → Sync says the same (`SyncPage`).
 */
export default function PickerServerPanel() {
  const { t } = useTranslation();
  return (
    <StartSection id="start-server-heading" icon={<Cloud size={12} />} label={t('start.server')}>
      <div className="start-panel">
        <p className="text-sm text-muted">{t('sync.comingLater')}</p>
      </div>
    </StartSection>
  );
}
