import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { alphabetToJson, isFilledPair } from '../../lib/lexicon';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';
import type { AlphabetPair, Language } from '../../types';

/** Eine Zeile im Formular: das Paar plus ein Schlüssel, den das Paar selbst nicht hat. */
interface Row extends AlphabetPair {
  key: string;
}

const toRows = (pairs: readonly AlphabetPair[]): Row[] =>
  pairs.map((pair) => ({ ...pair, key: generateId() }));

/**
 * Das Alphabet einer Sprache: Zeichenpaare, mit denen das Übersetzen-Feld
 * umschreibt. Links steht die eigene Schrift, rechts die der Sprache — auch
 * mehrere Buchstaben sind erlaubt („th" → „ᚦ"), die Umschrift nimmt die
 * längste passende Folge zuerst (siehe `lib/lexicon.ts`).
 *
 * Der Stand liegt lokal, nicht im Store: eine frische Zeile ist zunächst ganz
 * leer, und eine ganz leere Zeile wird nicht gespeichert (`isFilledPair`) —
 * sie käme also beim nächsten Rendern aus dem Store nicht zurück und wäre
 * wieder weg, sobald man hineintippt. Halb gefüllt wird dagegen gespeichert,
 * damit eine nachzutragende Seite nicht verlorengeht.
 *
 * Ein Wechsel der Sprache setzt den Stand trotzdem: `LexiconView` hängt die
 * Seite an `key={id}` auf, sie entsteht also je Sprache neu.
 */
export default function AlphabetTable({ language }: { language: Language }) {
  const { t } = useTranslation();
  const updateLanguage = useLexiconStore((s) => s.updateLanguage);
  const [rows, setRows] = useState<Row[]>(() => toRows(language.alphabet));
  /** Was zuletzt geschrieben wurde — ohne den Vergleich schriebe jedes Durchtabben die Sprache neu. */
  const saved = useRef(alphabetToJson(language.alphabet));

  /** Die Zeilen, die es in die Spalte schaffen — und damit auch die, die gezählt werden. */
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
        <span className="text-xs text-stone-600">({filled.length})</span>
        <span className="flex-1" />
        <Button tone="jade" small onClick={() => setRows((current) => [...current, { key: generateId(), from: '', to: '' }])}>
          <Plus size={12} />
          {t('lexicon.addLetter')}
        </Button>
      </div>
      <p className="text-xs text-stone-600 mb-3">{t('lexicon.alphabetHint')}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-stone-600">{t('lexicon.noLetters')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-2 rounded-md border border-stone-700/40 bg-stone-800/40 px-1 py-1"
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
              <ArrowRight size={12} className="text-stone-600 flex-shrink-0" aria-hidden="true" />
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
