import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';
import StartSection from './start/StartSection';

/**
 * The start page's store card, holding the place of the store until a later
 * version brings it: a panel to read, nothing to act on, no network access.
 */
export default function PickerStorePanel() {
  const { t } = useTranslation();
  return (
    <StartSection id="start-store-heading" icon={<Store size={12} />} label={t('start.store')}>
      <div className="start-panel">
        <p className="text-sm text-muted">{t('store.comingLater')}</p>
      </div>
    </StartSection>
  );
}
