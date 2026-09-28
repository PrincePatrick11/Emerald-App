import { useTranslation } from 'react-i18next';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, type TemplateEntryType } from '../../lib/blocks/templates';

/**
 * Die zwei Teile einer Kombination: die Eintragsart und, außer beim Journal,
 * die Kategorie („🪄 Ritual", „Alle Kategorien", „Ohne Kategorie").
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
    // Eine Kategorie im Papierkorb: die Zuweisung ruht, bis sie zurückkommt.
    return { type, place: cat ? `${cat.emoji} ${categoryLabel(t, cat)}` : t('templates.missingCategory') };
  };
}

/** Der Name einer Kombination, wie Liste, Zuweisungen und Hinweise ihn zeigen: „Wiki · 🪄 Ritual". */
export function useAssignmentLabel(): (entryType: TemplateEntryType, category: string | null) => string {
  const parts = useAssignmentParts();
  return (entryType, category) => {
    const { type, place } = parts(entryType, category);
    return place === null ? type : `${type} · ${place}`;
  };
}
