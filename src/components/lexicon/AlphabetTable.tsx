import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { alphabetToJson, isFilledPair } from '../../lib/lexicon';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';
import type { AlphabetPair, Language } from '../../types';

/** A row in the form: the pair plus a key that the pair itself does not have. */
interface Row extends AlphabetPair {
  key: string;
}

const toRows = (pairs: readonly AlphabetPair[]): Row[] =>
  pairs.map((pair) => ({ ...pair, key: generateId() }));

/**
 * The alphabet of a language: character pairs with which the translate field
 * transcribes. On the left is one's own script, on the right that of the language;
 * several letters are also allowed ("th" → "ᚦ"), and the transcription takes the
 * longest matching sequence first (see `lib/lexicon.ts`).
 *
 * The state is kept locally, not in the store: a fresh row is initially completely
 * empty, and a completely empty row is not saved (`isFilledPair`), so
 * it would not come back from the store on the next render and would be
 * gone again as soon as you type into it. A half-filled row, however, is saved,
 * so that a side still to be filled in is not lost.
 *
 * A change of language resets the state anyway: `LexiconView` keys the
 * page on `key={id}`, so it is created anew for each language.
 */
export default function AlphabetTable({ language }: { language: Language }) {
  const { t } = useTranslation();
  const updateLanguage = useLexiconStore((s) => s.updateLanguage);
  const [rows, setRows] = useState<Row[]>(() => toRows(language.alphabet));
  /** What was written last; without the comparison, every tab-through would rewrite the language. */
  const saved = useRef(alphabetToJson(language.alphabet));

  /** The rows that make it into the column, and thus also the ones that are counted. */
  const filled = rows.filter(isFilledPair);

  const save = (next: Row[]) => {
    setRows(next);
    const alphabet = next.filter(isFilledPair).map(({ from, to }) => ({ from, to }));
    const json = alphabetToJson(alphabet);
    if (json === saved.current) return;
    saved.current = json;
    void updateLanguage(language.id, { alphabet });
  };

  const patch = (key: string, part: Partial<AlphabetPair>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...part } : row)));
  };

  return (
    <section className="max-w-4xl mt-10">
      <div className="flex items-center gap-2 mb-1">
        <p className="label-xs">{t('lexicon.alphabet')}</p>
        <span className="text-xs text-faint">({filled.length})</span>
        <span className="flex-1" />
        <Button tone="jade" small onClick={() => setRows((current) => [...current, { key: generateId(), from: '', to: '' }])}>
          <Plus size={12} />
          {t('lexicon.addLetter')}
        </Button>
      </div>
      <p className="text-xs text-faint mb-3">{t('lexicon.alphabetHint')}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-faint">{t('lexicon.noLetters')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-2 rounded-md border border-edge bg-well px-1 py-1"
            >
              <input
                className={`${OP_PROP_SELECT_CLASSES} selectable text-center`}
                value={row.from}
                placeholder={t('lexicon.letterFrom')}
                aria-label={t('lexicon.letterFrom')}
                onChange={(e) => patch(row.key, { from: e.target.value })}
                onBlur={() => save(rows)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
              <ArrowRight size={12} className="text-faint flex-shrink-0" aria-hidden="true" />
              <input
                className={`${OP_PROP_SELECT_CLASSES} selectable text-center`}
                value={row.to}
                placeholder={t('lexicon.letterTo')}
                aria-label={t('lexicon.letterTo')}
                onChange={(e) => patch(row.key, { to: e.target.value })}
                onBlur={() => save(rows)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
              <Button
                tone="danger" compact small
                title={t('common.delete')} aria-label={t('common.delete')}
                onClick={() => save(rows.filter((r) => r.key !== row.key))}
              >
                <X size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
