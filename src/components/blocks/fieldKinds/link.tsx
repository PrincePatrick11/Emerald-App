import { useTranslation } from 'react-i18next';
import { storedString, type LinkElement } from '../../../lib/blocks/fieldKinds/fieldKind';
import { linkFromSlot, normalizeLinkCategoryFilter, type LinkCategoryFilter } from '../../../lib/blocks/toolkit';
import { categoryLabel } from '../../../lib/categories';
import { useCategoryStore } from '../../../store/categoryStore';
import { SettingsCheckboxGrid, SettingsDescription } from '../../layout/settings/SettingsSection';
import BlockCheckbox from '../BlockCheckbox';
import { LinkEditor, LinkTarget } from '../BlockLink';
import type { FieldKindView, FieldSettingsProps } from './fieldKindView';

/** The category filter of a link field: one box per category plus "Uncategorized"; none checked = no filter. */
function LinkCategoriesEditor({ element, onPatch }: FieldSettingsProps<LinkElement>) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const known = new Set(categories.map((c) => c.id));
  // Categories that are gone are neither shown nor kept.
  const filter = normalizeLinkCategoryFilter(element.linkCategories, known) ?? { categoryIds: [], includeUncategorized: false };
  const set = (next: LinkCategoryFilter) => onPatch({ linkCategories: normalizeLinkCategoryFilter(next, known) });
  return (
    <div>
      <SettingsCheckboxGrid label={t('blocks.library.linkCategories')}>
        {categories.map((c) => (
          <BlockCheckbox
            key={c.id}
            checked={filter.categoryIds.includes(c.id)}
            onChange={(on) => set({
              ...filter,
              categoryIds: on ? [...filter.categoryIds, c.id] : filter.categoryIds.filter((i) => i !== c.id),
            })}
            label={`${c.emoji} ${categoryLabel(t, c)}`}
          />
        ))}
        <BlockCheckbox
          checked={filter.includeUncategorized}
          onChange={(on) => set({ ...filter, includeUncategorized: on })}
          label={t('categories.uncategorized')}
        />
      </SettingsCheckboxGrid>
      <SettingsDescription className="mt-2">{t('blocks.library.linkCategoriesHint')}</SettingsDescription>
    </div>
  );
}

export const linkFieldView: FieldKindView<LinkElement> = {
  Input: ({ element, stored, onChange }) => (
    <LinkEditor
      slot={storedString(stored)}
      onChange={(html) => onChange(html ?? undefined)}
      filter={element.linkCategories}
    />
  ),
  Read: ({ stored }) => {
    const target = linkFromSlot(storedString(stored));
    return target ? <LinkTarget target={target} /> : null;
  },
  DefinitionSettings: LinkCategoriesEditor,
};
