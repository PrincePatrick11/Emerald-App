import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, X } from 'lucide-react';
import { isFilledPair } from '../../lib/lexicon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';
import type { AlphabetPair } from '../../types';

const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2';

/**
 * The alphabet of a language: character pairs with which the translate field
 * transcribes. On the left is one's own script, on the right that of the language;
 * several letters are also allowed ("th" → "ᚦ"), and the transcription takes the
 * longest matching sequence first (see `lib/lexicon.ts`).
 *
 * Read-only on the read view. With `onChange` the pairs are part of the
 * page's draft: a fresh row starts empty and stays while editing; only
 * saving drops completely empty rows (`isFilledPair`).
 */
export default function AlphabetTable({ alphabet, onChange }: {
  alphabet: readonly AlphabetPair[];
  /** Editing: the new pairs. Without it the table only reads. */
  onChange?: (alphabet: AlphabetPair[]) => void;
}) {
  const { t } = useTranslation();
  /** The rows that make it into the column, and thus also the ones that are counted. */
  const filled = alphabet.filter(isFilledPair);

  const patch = (index: number, part: Partial<AlphabetPair>) =>
    onChange?.(alphabet.map((pair, i) => (i === index ? { ...pair, ...part } : pair)));

  return (
    <section className="max-w-4xl mt-10">
      <div className="flex items-center gap-2 mb-1">
        <p className="label-xs">{t('lexicon.alphabet')}</p>
        <span className="text-xs text-subtle">({filled.length})</span>
        <span className="flex-1" />
        {onChange && (
          <Button tone="jade" small onClick={() => onChange([...alphabet, { from: '', to: '' }])}>
            <Plus size={12} />
            {t('lexicon.addLetter')}
          </Button>
        )}
      </div>
      <p className="text-xs text-subtle mb-3">{t('lexicon.alphabetHint')}</p>

      {(onChange ? alphabet : filled).length === 0 ? (
        <p className="text-sm text-subtle">{t('lexicon.noLetters')}</p>
      ) : onChange ? (
        <div className={GRID}>
          {/* Index as key: a pair has no id of its own, and the fields are controlled,
              so removing a row in the middle cannot leave a stale value behind. */}
          {alphabet.map((pair, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md border border-edge bg-well px-1 py-1">
              <input
                className={`${OP_PROP_SELECT_CLASSES} selectable text-center`}
                value={pair.from}
                placeholder={t('lexicon.letterFrom')}
                aria-label={t('lexicon.letterFrom')}
                onChange={(e) => patch(index, { from: e.target.value })}
              />
              <ArrowRight size={12} className="text-subtle flex-shrink-0" aria-hidden="true" />
              <input
                className={`${OP_PROP_SELECT_CLASSES} selectable text-center`}
                value={pair.to}
                placeholder={t('lexicon.letterTo')}
                aria-label={t('lexicon.letterTo')}
                onChange={(e) => patch(index, { to: e.target.value })}
              />
              <Button
                tone="danger" compact small
                title={t('common.delete')} aria-label={t('common.delete')}
                onClick={() => onChange(alphabet.filter((_, i) => i !== index))}
              >
                <X size={12} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className={GRID}>
          {filled.map((pair, index) => (
            <div key={index} className="flex items-center gap-2 border-b border-edge px-1 py-1.5 text-sm">
              <span className="flex-1 min-w-0 truncate text-center selectable text-secondary">{pair.from}</span>
              <ArrowRight size={12} className="text-subtle flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-center selectable text-primary font-medium">{pair.to}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
