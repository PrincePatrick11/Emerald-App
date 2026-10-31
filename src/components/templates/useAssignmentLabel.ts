import { useTranslation } from 'react-i18next';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, type TemplateEntryType } from '../../lib/blocks/templates';

/**
 * The two parts of a combination: the entry type and, except for the journal,
 * the category ("🪄 Ritual", "All categories", "No category").
 */
export function useAssignmentParts(): (entryType: TemplateEntryType, category: string | null) => { type: string; place: string | null } {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  return (entryType, category) => {
    const type = t(MODULES[viewTypeForEntryType(entryType)].navLabelKey);
    if (entryType === 'journal') return { type, place: null };
    if (category === ALL_CATEGORIES) return { type, place: t('templates.allCategories') };
    if (category === null) return { type, place: t('categories.uncategorized') };
    const cat = categories.find((c) => c.id === category);
    // A category in the trash: the assignment rests until it comes back.
    return { type, place: cat ? `${cat.emoji} ${categoryLabel(t, cat)}` : t('templates.missingCategory') };
  };
}

/** The name of a combination, as list, assignments and notices show it: "Wiki · 🪄 Ritual". */
export function useAssignmentLabel(): (entryType: TemplateEntryType, category: string | null) => string {
  const parts = useAssignmentParts();
  return (entryType, category) => {
    const { type, place } = parts(entryType, category);
    return place === null ? type : `${type} · ${place}`;
  };
}
