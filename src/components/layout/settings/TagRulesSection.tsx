import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Wo neue Tags entstehen dürfen: auch beim Eintippen, oder nur im Tags-Dashboard. */
export default function TagRulesSection() {
  const { t } = useTranslation();
  const createInline = useSettingsStore((s) => s.settings.tags.createInline);
  const update = useSettingsStore((s) => s.update);

  const options = [
    { value: true, label: t('settings.tagCreateInline'), hint: t('settings.tagCreateInlineHint') },
    { value: false, label: t('settings.tagCreateDashboardOnly'), hint: t('settings.tagCreateDashboardOnlyHint') },
  ];

  return (
    <SettingsSection icon={<Tag size={14} />} title={t('settings.tagCreation')} description={t('settings.tagCreationHint')}>
      <div className="flex gap-2 flex-wrap">
        {options.map(({ value, label, hint }) => (
          <SettingsChoiceButton
            key={String(value)}
            active={createInline === value}
            onClick={() => update('tags', { createInline: value })}
            title={hint}
            className="px-3 py-1.5 text-sm"
          >
            {label}
          </SettingsChoiceButton>
        ))}
      </div>
    </SettingsSection>
  );
}
