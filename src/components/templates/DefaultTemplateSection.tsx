import { useTranslation } from 'react-i18next';
import DashboardSection from '../ui/DashboardSection';
import TemplateSelect from '../ui/TemplateSelect';
import { useTemplateStore } from '../../store/templateStore';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Below the template list: the vault's default template — what a new entry
 * starts with when its category has no start template of its own (those are
 * set on the category, under Categories). A vault setting
 * (`templates.defaultTemplateId`), so it travels with sync and backup.
 */
export default function DefaultTemplateSection() {
  const { t } = useTranslation();
  const hasTemplates = useTemplateStore((s) => s.templates.length > 0);
  const defaultId = useSettingsStore((s) => s.settings.templates.defaultTemplateId);
  const update = useSettingsStore((s) => s.update);
  if (!hasTemplates) return null;
  return (
    <DashboardSection storageKey="templates-default-collapsed" label={t('templates.defaultTemplate')}>
      <p className="mb-3 text-xs text-muted">{t('templates.defaultTemplateHint')}</p>
      <TemplateSelect
        label={`${t('templates.defaultTemplate')}: `}
        noneLabel={t('templates.defaultNone')}
        value={defaultId}
        onChange={(id) => update('templates', { defaultTemplateId: id })}
      />
    </DashboardSection>
  );
}
