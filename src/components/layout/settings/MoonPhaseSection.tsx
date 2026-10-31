import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { SwitchRow } from '../../ui/Switch';
import SettingsSection from './SettingsSection';

/**
 * Whether journal entries show their moon phase — that of the day they
 * were created. It is computed, not stored, and therefore applies
 * immediately to all entries.
 */
export default function MoonPhaseSection() {
  const { t } = useTranslation();
  const moonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const update = useSettingsStore((s) => s.update);

  return (
    <SettingsSection icon={<Moon size={14} />} title={t('settings.moonPhase')} description={t('settings.moonPhaseHint')}>
      <SwitchRow
        variant="panel"
        label={t('settings.moonPhaseShow')}
        hint={t('settings.moonPhaseShowHint')}
        checked={moonPhase}
        onChange={(value) => update('journal', { moonPhase: value })}
      />
    </SettingsSection>
  );
}
