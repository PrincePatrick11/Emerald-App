import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useOperationStore } from '../../../store/operationStore';
import { useCategoryStore } from '../../../store/categoryStore';
import TagInput from '../../editor/TagInput';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import IconCoverField from '../fields/IconCoverField';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import { categoryLabel } from '../../../lib/categories';
import CategorySelect from '../../ui/CategorySelect';

/**
 * Die Eigenschaften einer Operation: Kategorie, Icon und Titelbild,
 * Verknüpfungen, Tags. Alles Weitere — Status, Sigille, Ladung — sind Blöcke
 * im Inhalt und bringen ihre Einstellungen selbst mit.
 */
export default function OperationPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const operations = useOperationStore((s) => s.operations);
  const updateOperation = useOperationStore((s) => s.updateOperation);
  const categories = useCategoryStore((s) => s.categories);

  const op = activeView.id ? operations.find((o) => o.id === activeView.id) : null;
  if (!op) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const inputCls = OP_PROP_SELECT_CLASSES;
  const category = categories.find((c) => c.id === op.category_id);
  // Gelöschte Kategorie: „Keine" statt der rohen category_id.
  const categoryDisplay = category ? `${category.emoji} ${categoryLabel(t, category)}` : t('properties.none');

  if (!isEditing) {
    return (
      <PropertiesReadView>
        <PropertySummaryRow label={t('properties.category')} value={categoryDisplay} />
        <IconCoverField icon={op.icon} cover={op.cover_image} readOnly />
        <div>
          <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
          <LinkedEntriesField content={op.content} />
        </div>
        <div>
          <p className="label-xs mb-2">{t('properties.tags')}</p>
          <TagInput tags={op.tags ?? []} onChange={() => {}} readOnly />
        </div>
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.category')}</p>
        <CategorySelect
          categories={categories}
          value={op.category_id}
          onChange={(category_id) => updateOperation(op.id, { category_id })}
          getLabel={(c) => categoryLabel(t, c)}
          variant="field"
        />
      </div>

      <IconCoverField
        icon={op.icon}
        cover={op.cover_image}
        onIconChange={(icon) => updateOperation(op.id, { icon })}
        onIconRemove={() => updateOperation(op.id, { icon: undefined })}
        onCoverChange={(cover_image) => updateOperation(op.id, { cover_image })}
        onCoverRemove={() => updateOperation(op.id, { cover_image: undefined })}
      />

      <div>
        <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
        <LinkedEntriesField content={op.content} editable inputCls={inputCls} />
      </div>

      <div>
        <p className="label-xs mb-2">{t('properties.tags')}</p>
        <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
          <TagInput tags={op.tags ?? []} onChange={(tags) => updateOperation(op.id, { tags })} />
        </div>
      </div>
    </PropertiesEditView>
  );
}
