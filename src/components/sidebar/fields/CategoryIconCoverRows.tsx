import { useTranslation } from 'react-i18next';
import { Folder, Image, Smile } from 'lucide-react';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import { EditPropertyRow, MediaPropertyRow, PropertySelect } from './EditProperties';

/** Der „ohne Kategorie"-Eintrag des Menüs — kein gültiger Wert der Spalte. */
const NO_CATEGORY = '__none__';

interface Patch {
  category_id?: string | null;
  icon?: string;
  cover_image?: string;
}

/**
 * Kategorie, Icon und Titelbild im Bearbeiten — was Wiki und Operationen
 * gleich tragen, unter dem Typ im Abschnitt „Eigenschaften". Ein
 * Kategoriewechsel lässt den Inhalt, wie er ist.
 */
export default function CategoryIconCoverRows({ entry, update }: {
  entry: { id: string; category_id: string | null; icon?: string; cover_image?: string };
  update: (patch: Patch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  // Eine Kategorie im Papierkorb löst nicht mehr auf und gilt als „Keine".
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
        onChange={(icon) => void update({ icon })}
        onRemove={() => void update({ icon: undefined })}
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
