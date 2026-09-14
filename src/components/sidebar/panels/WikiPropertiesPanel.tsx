import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useWikiStore } from '../../../store/wikiStore';
import { useCategoryStore } from '../../../store/categoryStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import IconCoverField from '../fields/IconCoverField';
import { applyDefaultAfterCategoryChange } from '../../../store/templateApply';
import CategorySelect from '../../ui/CategorySelect';
import { categoryLabel } from '../../../lib/categories';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

export default function WikiPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const articles = useWikiStore((s) => s.articles);
  const updateArticle = useWikiStore((s) => s.updateArticle);
  const categories = useCategoryStore((s) => s.categories);

  const article = activeView.id ? articles.find((a) => a.id === activeView.id) : null;

  if (!article) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const category = categories.find((c) => c.id === article.category_id);

  if (!isEditing) {
    return (
      <PropertiesReadView>
        {/* Gelöschte Kategorie: „Keine" statt der rohen category_id. */}
        <PropertySummaryRow label={t('properties.category')} value={category ? `${category.emoji} ${categoryLabel(t, category)}` : t('properties.none')} />
        <IconCoverField icon={article.icon} cover={article.cover_image} readOnly />
        <div>
          <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
          <LinkedEntriesField content={article.content} />
        </div>
        <TagsField tags={article.tags ?? []} readOnly />
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.category')}</p>
        <CategorySelect
          categories={categories}
          value={article.category_id}
          onChange={(category_id) => {
            const previous = article.category_id;
            void updateArticle(article.id, { category_id })
              .then(() => applyDefaultAfterCategoryChange('wiki', article.id, previous, category_id))
              .catch((e: unknown) => console.error('[WikiPropertiesPanel] category change failed:', e));
          }}
          getLabel={(c) => categoryLabel(t, c)}
          variant="field"
        />
      </div>

      <IconCoverField
        icon={article.icon}
        cover={article.cover_image}
        onIconChange={(icon) => updateArticle(article.id, { icon })}
        onIconRemove={() => updateArticle(article.id, { icon: undefined })}
        onCoverChange={(cover_image) => updateArticle(article.id, { cover_image })}
        onCoverRemove={() => updateArticle(article.id, { cover_image: undefined })}
      />

      <div>
        <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
        <LinkedEntriesField content={article.content} editable inputCls={OP_PROP_SELECT_CLASSES} />
      </div>

      <TagsField tags={article.tags ?? []} onChange={(tags) => updateArticle(article.id, { tags })} />
    </PropertiesEditView>
  );
}
