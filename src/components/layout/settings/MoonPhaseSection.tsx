import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { SwitchRow } from '../../ui/Switch';
import SettingsSection from './SettingsSection';

/**
 * Ob Journal-Einträge ihre Mondphase zeigen — die des Tages, an dem sie
 * angelegt wurden. Sie wird berechnet, nicht gespeichert, und gilt deshalb
 * sofort für alle Einträge.
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
