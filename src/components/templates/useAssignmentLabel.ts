import { useTranslation } from 'react-i18next';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, type TemplateEntryType } from '../../lib/blocks/templates';

/** Der Name einer Kombination, wie Liste, Zuweisungen und Hinweise ihn zeigen: „Wiki · 🪄 Ritual". */
export function useAssignmentLabel(): (entryType: TemplateEntryType, category: string | null) => string {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  return (entryType, category) => {
    const type = t(MODULES[viewTypeForEntryType(entryType)].navLabelKey);
    if (entryType === 'journal') return type;
    if (category === ALL_CATEGORIES) return `${type} · ${t('templates.allCategories')}`;
    if (category === null) return `${type} · ${t('categories.uncategorized')}`;
    const cat = categories.find((c) => c.id === category);
    // Eine Kategorie im Papierkorb: die Zuweisung ruht, bis sie zurückkommt.
    return `${type} · ${cat ? `${cat.emoji} ${categoryLabel(t, cat)}` : t('templates.missingCategory')}`;
  };
}
