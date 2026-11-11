import { useTranslation } from 'react-i18next';
import { Folder, Image, Smile } from 'lucide-react';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import { useShrunkIcon } from '../../../hooks/useShrunkIcon';
import { isDiscarding, trackEntryWrite } from '../../../store/entryEdit';
import { EditPropertyRow, MediaPropertyRow, PropertySelect } from './EditProperties';

/** The "no category" entry of the menu; not a valid value of the column. */
const NO_CATEGORY = '__none__';

interface Patch {
  category_id?: string | null;
  icon?: string;
  cover_image?: string;
}

/**
 * Category, icon and cover image when editing: what wiki and operations
 * carry alike, under the type in the "Properties" section. A
 * category change leaves the content as it is.
 */
export default function CategoryIconCoverRows({ entry, update }: {
  entry: { id: string; category_id: string | null; icon?: string; cover_image?: string };
  update: (patch: Patch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  // Shrinking takes a moment: Cancel waits for it (tracked), and the late
  // icon drops itself instead of landing on the restored entry.
  const shrinkIcon = useShrunkIcon(
    (icon) => (isDiscarding(entry.id) ? undefined : update({ icon: icon || undefined })),
    'CategoryIconCoverRows',
  );
  const setIcon = (icon: string) => trackEntryWrite(entry.id, shrinkIcon(icon));
  // A category in the trash no longer resolves and counts as "None".
  const category = categories.find((c) => c.id === entry.category_id);

  const changeCategory = (next: string) => {
    const categoryId = next === NO_CATEGORY ? null : next;
    void update({ category_id: categoryId })
      .catch((e: unknown) => console.error('[CategoryIconCoverRows] category change failed:', e));
  };

  return (
    <>
      <EditPropertyRow icon={<Folder size={14} />} label={t('properties.category')}>
        <PropertySelect
          value={category ? category.id : NO_CATEGORY}
          options={[
            { value: NO_CATEGORY, label: t('properties.noCategory') },
            ...categories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji })),
          ]}
          onChange={changeCategory}
          text={category ? `${category.emoji} ${categoryLabel(t, category)}` : t('properties.noCategory')}
          muted={!category}
          ariaLabel={t('properties.category')}
        />
      </EditPropertyRow>
      <MediaPropertyRow
        rowIcon={<Smile size={14} />}
        label={t('properties.icon')}
        kind="icon"
        value={entry.icon}
        onChange={(icon) => void setIcon(icon)}
        onRemove={() => void setIcon('')}
      />
      <MediaPropertyRow
        rowIcon={<Image size={14} />}
        label={t('properties.coverImage')}
        kind="cover"
        value={entry.cover_image}
        onChange={(cover_image) => void update({ cover_image })}
        onRemove={() => void update({ cover_image: undefined })}
      />
    </>
  );
}
