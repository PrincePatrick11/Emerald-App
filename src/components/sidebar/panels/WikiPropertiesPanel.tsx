import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { findEntry, useEntryStore } from '../../../store/entryStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryAreaField from '../fields/EntryAreaField';
import EntryReadSections, { CategoryPropertyRow, PropertiesSection } from '../fields/EntryReadSections';
import CategoryIconCoverRows from '../fields/CategoryIconCoverRows';

export default function WikiPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const article = useEntryStore((s) => (activeView.id ? findEntry(s.entries, activeView.id) : undefined));
  const updateEntry = useEntryStore((s) => s.updateEntry);


  if (!article) {
    return <p className="text-xs text-subtle px-2 py-3">{t('properties.noEntry')}</p>;
  }

  if (!isEditing) {
    return (
      <EntryReadSections
        properties={<CategoryPropertyRow categoryId={article.category_id} />}
        content={article.content}
        tags={article.tags ?? []}
      />
    );
  }

  return (
    <>
      <PropertiesSection>
        <EntryAreaField entry={article} />
        <CategoryIconCoverRows entry={article} update={(patch) => updateEntry(article.id, patch)} />
      </PropertiesSection>
      <LinkedEntriesField content={article.content} />
      <TagsField tags={article.tags ?? []} onChange={(tags) => updateEntry(article.id, { tags })} />
    </>
  );
}
