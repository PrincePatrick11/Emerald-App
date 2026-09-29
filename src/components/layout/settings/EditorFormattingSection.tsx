import { useTranslation } from 'react-i18next';
import { Pilcrow } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import type { EditorSettings } from '../../../lib/vaultSettings';
import { SwitchRow } from '../../ui/Switch';
import SettingsSection from './SettingsSection';

/** Was der Editor beim Tippen und Einfügen von selbst formatiert — drei Schalter statt fester Regeln. */
export default function EditorFormattingSection() {
  const { t } = useTranslation();
  const editor = useSettingsStore((s) => s.settings.editor);
  const update = useSettingsStore((s) => s.update);

  const rows: { key: keyof EditorSettings; label: string; hint: string }[] = [
    { key: 'markdownShortcuts', label: t('settings.markdownShortcuts'), hint: t('settings.markdownShortcutsHint') },
    { key: 'typography', label: t('settings.typography'), hint: t('settings.typographyHint') },
    { key: 'autoLinks', label: t('settings.autoLinks'), hint: t('settings.autoLinksHint') },
  ];

  return (
    <SettingsSection icon={<Pilcrow size={14} />} title={t('settings.editorFormatting')} description={t('settings.editorFormattingHint')}>
      {rows.map(({ key, label, hint }) => (
        <SwitchRow
          key={key}
          variant="panel"
          label={label}
          hint={hint}
          checked={editor[key]}
          onChange={(value) => update('editor', { [key]: value })}
        />
      ))}
    </SettingsSection>
  );
}
