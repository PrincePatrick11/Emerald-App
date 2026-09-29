import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { SwitchRow } from '../../ui/Switch';
import SettingsSection from './SettingsSection';

/** Ob ein neuer Journal-Eintrag die Mondphase des Tages bekommt. */
export default function MoonPhaseSection() {
  const { t } = useTranslation();
  const moonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const update = useSettingsStore((s) => s.update);

  return (
    <SettingsSection icon={<Moon size={14} />} title={t('settings.moonPhase')} description={t('settings.moonPhaseHint')}>
      <SwitchRow
        variant="panel"
        label={t('settings.moonPhaseAuto')}
        title={t('settings.moonPhaseAutoHint')}
        checked={moonPhase}
        onChange={(value) => update('journal', { moonPhase: value })}
      />
    </SettingsSection>
  );
}
