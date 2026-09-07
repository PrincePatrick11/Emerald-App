import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWikiStore } from '../../../store/wikiStore';
import { useCategoryStore } from '../../../store/categoryStore';
import { DEFAULT_ENTRY_EMOJI } from '../../../lib/modules';
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
  const categories = useCategoryStore((s) => s.categories);
  const [query, setQuery] = useState('');

  // Bis v38 blieben Artikel der eingebauten Kategorie „Paradigma" hier außen
  // vor; seitdem ist sie eine Kategorie wie jede andere und kein Grund mehr.
  const filtered = useMemo(() =>
    articles
      .filter((a) => !ids.includes(a.id) && !a.deleted_at &&
        a.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, LINK_RESULT_LIMIT),
    [articles, ids, query]);

  const selectedArticles = useMemo(() =>
    ids.map((id) => articles.find((a) => a.id === id)).filter(Boolean) as typeof articles,
    [ids, articles]);

  const articleIcon = (article: typeof articles[number]) => {
    const cat = categories.find((c) => c.id === article.category_id);
    return cat?.emoji ?? DEFAULT_ENTRY_EMOJI.wiki;
  };

  return (
    <LinkedEntryPicker
      chips={selectedArticles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedArticles.map((article) => (
            <LinkedEntryChip
              key={article.id}
              icon={<span className="flex-shrink-0">{articleIcon(article)}</span>}
              label={article.title}
              onRemove={() => onChange(ids.filter((i) => i !== article.id))}
              removeTitle={t('properties.removeLink')}
            />
          ))}
        </div>
      )}
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
