import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useWikiStore } from '../../../store/wikiStore';
import TagInput from '../../editor/TagInput';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import Favicon from '../fields/Favicon';
import Banner from '../fields/Banner';
import CategorySelect from '../../ui/CategorySelect';
import { categoryLabel } from '../../../lib/categories';

export default function WikiPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const articles = useWikiStore((s) => s.articles);
  const updateArticle = useWikiStore((s) => s.updateArticle);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);

  const article = activeView.id ? articles.find((a) => a.id === activeView.id) : null;

  if (!article) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const category = wikiCategories.find((c) => c.id === article.category_id);

  if (!isEditing) {
    return (
      <PropertiesReadView>
        {/* Gelöschte Kategorie: „Keine" statt der rohen category_id. */}
        <PropertySummaryRow label={t('properties.category')} value={category ? `${category.emoji} ${categoryLabel(t, 'wiki', category)}` : t('properties.none')} />
        <Favicon value={article.icon} readOnly label={t('properties.icon')} />
        <Banner value={article.cover_image} readOnly />
        <div>
          <p className="label-xs mb-2">{t('properties.tags')}</p>
          <TagInput tags={article.tags ?? []} onChange={() => {}} readOnly />
        </div>
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.category')}</p>
        <CategorySelect
          categories={wikiCategories}
          value={article.category_id}
          onChange={(category_id) => updateArticle(article.id, { category_id })}
          getLabel={(c) => categoryLabel(t, 'wiki', c)}
          variant="field"
        />
      </div>

      <Favicon
        value={article.icon}
        onChange={(icon) => updateArticle(article.id, { icon })}
        onRemove={() => updateArticle(article.id, { icon: undefined })}
        label={t('properties.icon')}
      />

      <Banner
        value={article.cover_image}
        onChange={(cover_image) => updateArticle(article.id, { cover_image })}
        onRemove={() => updateArticle(article.id, { cover_image: undefined })}
      />

      <div>
        <p className="label-xs mb-2">{t('properties.tags')}</p>
        <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
          <TagInput tags={article.tags ?? []} onChange={(tags) => updateArticle(article.id, { tags })} />
        </div>
      </div>
    </PropertiesEditView>
  );
}
