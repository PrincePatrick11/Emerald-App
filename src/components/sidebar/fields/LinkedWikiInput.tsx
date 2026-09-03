import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWikiStore } from '../../../store/wikiStore';
import { getCategoryEmoji } from '../../wiki/WikiList';
import LinkedEntryPicker, { LINK_RESULT_LIMIT, LinkedEntryChip } from './LinkedEntryPicker';

/**
 * ID-Array-Editor für Wiki-Artikel — heute nur noch für Routinen-Vorlagen
 * (`RoutinesPanel`). Was ein EINTRAG verlinkt, steht in seinem Inhalt und
 * gehört ins `LinkedEntriesField`.
 */
export default function LinkedWikiInput({
  ids, onChange, inputCls,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  inputCls: string;
}) {
  const { t } = useTranslation();
  const articles = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() =>
    articles
      .filter((a) => !ids.includes(a.id) && !a.deleted_at && a.category_id !== 'paradigm' &&
        a.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, LINK_RESULT_LIMIT),
    [articles, ids, query]);

  const selectedArticles = useMemo(() =>
    ids.map((id) => articles.find((a) => a.id === id)).filter((a) => a && a.category_id !== 'paradigm') as typeof articles,
    [ids, articles]);

  const articleIcon = (article: typeof articles[number]) => {
    const cat = wikiCategories.find((c) => c.id === article.category_id);
    return cat?.emoji ?? getCategoryEmoji(article.category_id);
  };

  return (
    <LinkedEntryPicker
      chips={selectedArticles.map((article) => (
        <LinkedEntryChip
          key={article.id}
          icon={<span className="flex-shrink-0">{articleIcon(article)}</span>}
          label={article.title}
          onRemove={() => onChange(ids.filter((i) => i !== article.id))}
          removeTitle={t('properties.removeLink')}
        />
      ))}
      results={filtered}
      resultKey={(article) => article.id}
      onSelect={(article) => onChange([...ids, article.id])}
      query={query}
      onQueryChange={setQuery}
      placeholder={t('search.wikiArticles')}
      inputCls={inputCls}
      renderResult={(article) => (
        <>
          <span className="flex-shrink-0">{articleIcon(article)}</span>
          <span className="truncate">{article.title}</span>
        </>
      )}
    />
  );
}
