import { useTranslation } from 'react-i18next';
import { FilterRow } from '../ui/FilterList';
import SidebarSection, { SidebarEmpty } from '../sidebar/fields/SidebarSection';
import { useCategoryStore } from '../../store/categoryStore';
import { useTemplateStore } from '../../store/templateStore';
import type { TemplateCategoryChanges } from '../../store/draftStore';
import { categoryLabel } from '../../lib/categories';
import { activeTemplate } from '../../lib/blocks/templates';
import { templateLabel } from '../../lib/blocks/blockAttrs';

const without = (ids: string[], id: string) => ids.filter((x) => x !== id);
const adding = (ids: string[], id: string) => [...ids, id].sort();

/**
 * On a template's page: the categories whose new entries start with it, to
 * toggle. Shown is the live state (`categories.template_id`, as the Templates
 * view and the category dialog set it) with the page's own toggles on top;
 * those are part of the page's draft, saved with "Done". A category starting
 * with another (active) template names it, since ticking it here replaces it.
 */
export default function TemplateCategoriesField({ templateId, changes, onChange }: {
  templateId: string;
  changes: TemplateCategoryChanges;
  onChange: (changes: TemplateCategoryChanges) => void;
}) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const templates = useTemplateStore((s) => s.templates);

  const ticked = (id: string, current: string | null) =>
    changes.add.includes(id) || (current === templateId && !changes.remove.includes(id));

  // Toggling back takes the change out again instead of adding the opposite one.
  const toggle = (id: string, current: string | null) => {
    const { add, remove } = changes;
    if (ticked(id, current)) {
      onChange(add.includes(id) ? { add: without(add, id), remove } : { add, remove: adding(remove, id) });
    } else {
      onChange(remove.includes(id) ? { add, remove: without(remove, id) } : { add: adding(add, id), remove });
    }
  };
  const otherOf = (current: string | null) => {
    const other = current === templateId ? undefined : activeTemplate(templates, current);
    return other ? t('templates.startsInOther', { name: templateLabel(t, other) }) : undefined;
  };
  const count = categories.filter((c) => ticked(c.id, c.template_id)).length;

  return (
    <SidebarSection storageKey="template-sidebar-categories-open" label={t('templates.startsIn')} count={count}>
      <p className="px-3 pb-1 text-xs text-subtle">{t('templates.startsInHint')}</p>
      {categories.length === 0 && <SidebarEmpty>{t('templates.startsInNoCategories')}</SidebarEmpty>}
      {categories.map((cat) => {
        const active = ticked(cat.id, cat.template_id);
        return (
          <FilterRow
            key={cat.id}
            active={active}
            onClick={() => toggle(cat.id, cat.template_id)}
            lead={<span className="text-sm">{cat.emoji}</span>}
            label={categoryLabel(t, cat)}
            detail={active ? undefined : otherOf(cat.template_id)}
          />
        );
      })}
    </SidebarSection>
  );
}
