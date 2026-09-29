import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../store/settingsStore';
import { AUX_VIEWS } from '../../../lib/modules';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Ob ein neuer Eintrag mit seiner Standard-Vorlage beginnt, oder leer. */
export default function TemplateDefaultSection() {
  const { t } = useTranslation();
  const applyDefault = useSettingsStore((s) => s.settings.templates.applyDefault);
  const update = useSettingsStore((s) => s.update);
  const Icon = AUX_VIEWS.templates.icon;

  const options = [
    { value: true, label: t('settings.templateDefaultAuto'), hint: t('settings.templateDefaultAutoHint') },
    { value: false, label: t('settings.templateDefaultManual'), hint: t('settings.templateDefaultManualHint') },
  ];

  return (
    <SettingsSection icon={<Icon size={14} />} title={t('settings.templateDefault')} description={t('settings.templateDefaultHint')}>
      <SettingsChoiceRow>
        {options.map(({ value, label, hint }) => (
          <SettingsChoiceButton
            key={String(value)}
            active={applyDefault === value}
            onClick={() => update('templates', { applyDefault: value })}
            title={hint}
          >
            {label}
          </SettingsChoiceButton>
        ))}
      </SettingsChoiceRow>
    </SettingsSection>
  );
}
