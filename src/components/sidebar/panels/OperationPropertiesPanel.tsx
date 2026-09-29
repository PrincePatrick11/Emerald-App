import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useOperationStore } from '../../../store/operationStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryTypeField from '../fields/EntryTypeField';
import EntryReadSections, { CategoryPropertyRow, PropertiesSection } from '../fields/EntryReadSections';
import CategoryIconCoverRows from '../fields/CategoryIconCoverRows';

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

  const op = activeView.id ? operations.find((o) => o.id === activeView.id) : null;
  if (!op) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  if (!isEditing) {
    return (
      <EntryReadSections
        properties={<CategoryPropertyRow categoryId={op.category_id} />}
        content={op.content}
        tags={op.tags ?? []}
      />
    );
  }

  return (
    <>
      <PropertiesSection>
        <EntryTypeField id={op.id} type="operation" properties={op} />
        <CategoryIconCoverRows entry={op} update={(patch) => updateOperation(op.id, patch)} />
      </PropertiesSection>
      <LinkedEntriesField content={op.content} />
      <TagsField tags={op.tags ?? []} onChange={(tags) => updateOperation(op.id, { tags })} />
    </>
  );
}
