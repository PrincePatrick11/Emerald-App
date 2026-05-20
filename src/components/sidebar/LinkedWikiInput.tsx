import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useWikiStore } from '../../store/wikiStore';
import { getCategoryEmoji } from '../wiki/WikiList';

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() =>
    articles
      .filter((a) => !ids.includes(a.id) && !a.deleted_at && a.category !== 'paradigm' &&
        a.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8),
    [articles, ids, query]);

  const selectedArticles = useMemo(() =>
    ids.map((id) => articles.find((a) => a.id === id)).filter((a) => a && a.category !== 'paradigm') as typeof articles,
    [ids, articles]);

  const articleIcon = (article: typeof articles[number]) => {
    const cat = wikiCategories.find((c) => c.id === article.category);
    return cat?.emoji ?? getCategoryEmoji(article.category);
  };

  return (
    <div ref={ref} className="space-y-1.5">
      {selectedArticles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedArticles.map((article) => (
            <span key={article.id} className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-stone-800/60 border border-stone-700/40 text-stone-300">
              <span>{articleIcon(article)}</span>
              <span className="truncate max-w-[110px]">{article.title}</span>
              <button
                onClick={() => onChange(ids.filter((i) => i !== article.id))}
                className="text-stone-600 hover:text-stone-400 ml-0.5 flex-shrink-0"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={t('search.wikiArticles')}
          className={inputCls}
        />
        {open && (
          <div className="linked-entry-menu absolute top-full left-0 right-0 mt-1 z-50 border border-stone-700/60 rounded-lg shadow-xl py-1 max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-stone-600 px-3 py-2">{t('search.noResultsShort')}</p>
            ) : filtered.map((article) => (
              <button
                key={article.id}
                onMouseDown={(e) => { e.preventDefault(); onChange([...ids, article.id]); setQuery(''); setOpen(false); }}
                className="linked-entry-menu-item w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-stone-400 hover:text-stone-200"
              >
                <span>{articleIcon(article)}</span>
                <span className="truncate">{article.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
