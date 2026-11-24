import { useTranslation } from 'react-i18next';
import DashboardSection from '../ui/DashboardSection';
import TemplateSelect from '../ui/TemplateSelect';
import { useCategoryStore } from '../../store/categoryStore';
import { useTemplateStore } from '../../store/templateStore';
import { useSettingsStore } from '../../store/settingsStore';
import { categoryLabel } from '../../lib/categories';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { activeTemplate } from '../../lib/blocks/templates';

/**
 * Below the default template: every category with the template a new entry in
 * it starts with — a second place to set `categories.template_id`, besides the
 * category's own dialog. Applies at once, like the default template above.
 * A start template in the Trash shows as the default, the rule
 * `resolveStartTemplate` applies; it is only overwritten when another one is
 * picked here.
 */
export default function CategoryStartTemplatesSection() {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const setStartTemplate = useCategoryStore((s) => s.setStartTemplate);
  const templates = useTemplateStore((s) => s.templates);
  const defaultId = useSettingsStore((s) => s.settings.templates.defaultTemplateId);
  if (templates.length === 0 || categories.length === 0) return null;

  const defaultTemplate = activeTemplate(templates, defaultId);
  const defaultLabel = defaultTemplate
    ? t('categories.startTemplateDefaultNamed', { name: templateLabel(t, defaultTemplate) })
    : t('categories.startTemplateDefaultNone');
  const hasOwn = (templateId: string | null) => !!activeTemplate(templates, templateId);
  const onDefault = categories.filter((cat) => !hasOwn(cat.template_id));

  return (
    <DashboardSection storageKey="templates-categories-collapsed" label={t('templates.categoryStart')}>
      <p className="mb-1 text-xs text-muted">{t('templates.categoryStartHint')}</p>
      <p className="mb-3 text-xs text-muted">
        {onDefault.length > 0
          // Without a default template they start empty — say that, not "with the default".
          ? t(defaultTemplate ? 'templates.categoryStartOnDefault' : 'templates.categoryStartEmpty', {
            names: onDefault.map((cat) => categoryLabel(t, cat)).join(', '),
          })
          : t('templates.categoryStartNoneOnDefault')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {categories.map((cat) => (
          <li key={cat.id} className="flex items-center gap-3">
            <span className="w-48 flex-shrink-0 flex items-center gap-2 text-sm text-soft min-w-0">
              <span className="text-base leading-none">{cat.emoji}</span>
              <span className="truncate">{categoryLabel(t, cat)}</span>
            </span>
            <TemplateSelect
              noneLabel={defaultLabel}
              value={cat.template_id}
              onChange={(id) => {
                // Picking the default for one already on it (none, or one in the Trash) changes nothing.
                if (id === null && !hasOwn(cat.template_id)) return;
                void setStartTemplate(cat.id, id);
              }}
              portal
            />
          </li>
        ))}
      </ul>
    </DashboardSection>
  );
}
