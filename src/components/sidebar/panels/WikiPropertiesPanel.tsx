import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useEntryStore } from '../../../store/entryStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryTypeField from '../fields/EntryTypeField';
import EntryReadSections, { CategoryPropertyRow, PropertiesSection } from '../fields/EntryReadSections';
import CategoryIconCoverRows from '../fields/CategoryIconCoverRows';

export default function WikiPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const articles = useEntryStore((s) => s.entries.wiki);
  const updateArticle = useEntryStore((s) => s.updateEntry);

  const article = activeView.id ? articles.find((a) => a.id === activeView.id) : null;

  if (!article) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
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
        <EntryTypeField id={article.id} type="wiki" properties={article} />
        <CategoryIconCoverRows entry={article} update={(patch) => updateArticle(article.id, patch)} />
      </PropertiesSection>
      <LinkedEntriesField content={article.content} />
      <TagsField tags={article.tags ?? []} onChange={(tags) => updateArticle(article.id, { tags })} />
    </>
  );
}
