import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, X } from 'lucide-react';
import { generateId } from '../../lib/helpers';
import { WORD_FIELDS, type WordDraft } from '../../lib/lexicon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';

/** The columns of the table. The same split in header and rows: one truth, otherwise they drift out of line. */
const COLUMNS = 'grid grid-cols-[1fr_1fr_minmax(0,0.7fr)_minmax(0,0.9fr)_auto] gap-2 items-center';

/**
 * The vocabulary of a language as a table: term, translation, pronunciation,
 * note. Read-only on the language's read view; with `onChange` the rows are
 * fields of the page's draft — added, changed and removed words are saved
 * with "Done" and dropped with "Cancel", like everything else on the page.
 *
 * The search filters in both views; while editing it only hides rows, it
 * never removes any.
 */
export default function VocabularyTable({ words, onChange }: {
  words: readonly WordDraft[];
  /** Editing: the new word list. Without it the table only reads. */
  onChange?: (words: WordDraft[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  /**
   * The freshly added row gets focus; otherwise you would have to click after every
   * "+". It is cleared again afterwards: if it stayed, every re-render
   * (for instance while typing in the search) would yank the cursor back
   * into this row.
   */
  const [focusId, setFocusId] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visible = query
    ? words.filter((w) => `${w.term} ${w.translation} ${w.pronunciation} ${w.note}`.toLowerCase().includes(query))
    : words;

  const add = () => {
    if (!onChange) return;
    const word: WordDraft = { id: generateId(), term: '', translation: '', pronunciation: '', note: '' };
    // A search would hide the empty row the "+" just made.
    setSearch('');
    onChange([...words, word]);
    setFocusId(word.id);
  };

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-2 mb-3">
        <p className="label-xs">{t('lexicon.vocabulary')}</p>
        <span className="text-xs text-subtle">({words.length})</span>
        <span className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
          <input
            className={`${OP_PROP_SELECT_CLASSES} w-48 pl-7`}
            value={search}
            placeholder={t('lexicon.searchWords')}
            aria-label={t('lexicon.searchWords')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {onChange && (
          <Button tone="jade" small onClick={add}>
            <Plus size={12} />
            {t('lexicon.addWord')}
          </Button>
        )}
      </div>

      {words.length === 0 ? (
        <p className="text-sm text-subtle">{t('lexicon.noWords')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-subtle">{t('search.noResults')}</p>
      ) : (
        <>
          <div className={`${COLUMNS} px-1 mb-1`}>
            <span className="label-xs">{t('lexicon.term')}</span>
            <span className="label-xs">{t('lexicon.translation')}</span>
            <span className="label-xs">{t('lexicon.pronunciation')}</span>
            <span className="label-xs">{t('lexicon.note')}</span>
            {/* Placeholder above the column of the delete button. */}
            <span className={onChange ? 'w-6' : ''} />
          </div>
          <div className={onChange ? 'space-y-1' : ''}>
            {visible.map((word) => (onChange ? (
              <VocabularyRow
                key={word.id}
                word={word}
                autoFocus={word.id === focusId}
                onFocused={() => setFocusId(null)}
                onPatch={(patch) => onChange(words.map((w) => (w.id === word.id ? { ...w, ...patch } : w)))}
                onDelete={() => onChange(words.filter((w) => w.id !== word.id))}
              />
            ) : (
              <div key={word.id} className={`${COLUMNS} px-1 py-1.5 border-b border-edge text-sm`}>
                {WORD_FIELDS.map((key) => (
                  <span key={key} className={`min-w-0 truncate selectable ${key === 'term' ? 'text-primary font-medium' : 'text-secondary'}`} title={word[key]}>
                    {word[key]}
                  </span>
                ))}
                <span />
              </div>
            )))}
          </div>
        </>
      )}
    </section>
  );
}

function VocabularyRow({ word, autoFocus, onFocused, onPatch, onDelete }: {
  word: WordDraft;
  autoFocus: boolean;
  /** Focus has been set; the caller may forget it. */
  onFocused: () => void;
  onPatch: (patch: Partial<WordDraft>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    firstField.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  const labels: Record<(typeof WORD_FIELDS)[number], string> = {
    term: t('lexicon.term'),
    translation: t('lexicon.translation'),
    pronunciation: t('lexicon.pronunciation'),
    note: t('lexicon.note'),
  };

  return (
    <div className={`${COLUMNS} rounded-md border border-edge bg-well px-1 py-1`}>
      {WORD_FIELDS.map((key) => (
        <input
          key={key}
          ref={key === 'term' ? firstField : undefined}
          className={`${OP_PROP_SELECT_CLASSES} selectable`}
          value={word[key]}
          placeholder={labels[key]}
          aria-label={labels[key]}
          onChange={(e) => onPatch({ [key]: e.target.value })}
        />
      ))}
      <Button tone="danger" compact small title={t('common.delete')} aria-label={t('common.delete')} onClick={onDelete}>
        <X size={12} />
      </Button>
    </div>
  );
}
