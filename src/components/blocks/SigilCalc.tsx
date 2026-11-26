import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import {
  extractUniqueLetters, implementedIn, parseSigilCalc, serializeSigilCalc, type SigilCalc as CalcValue, type SigilCalcData,
} from '../../lib/blocks/sigilCalc';
import type { BlockInstance } from '../../lib/blocks/types';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

/**
 * The sigil calculator as a building block: from the intention the letter
 * bank (each letter once), and which of them are already in the drawing.
 * It reads and writes a block-shaped value (`lib/blocks/sigilCalc.ts`) and
 * knows nothing of the block that carries it — the sigil block today, a
 * calculator of its own later. Whoever carries it decides whether it is
 * locked or concealed.
 */
export default function SigilCalc({ value, isEditing, locked, onChange }: {
  value: BlockInstance;
  isEditing: boolean;
  /** Read-only even while editing (a loaded sigil). */
  locked: boolean;
  onChange: (next: BlockInstance) => void;
}) {
  const calc = parseSigilCalc(value);
  if (isEditing && !locked) return <CalcEditor calc={calc} onChange={(next) => onChange(serializeSigilCalc(value, next))} />;
  return <CalcReader calc={calc} locked={isEditing && locked} />;
}

/**
 * The letter bank. The tiles are deliberately not a `Button`: a
 * letter that switches between "open" and "applied" is a
 * toggle in the content, not an action; colours via `.block-sigil-letter`.
 */
function LetterBank({ calc, onToggle }: { calc: CalcValue; onToggle?: (letter: string) => void }) {
  const { t } = useTranslation();
  if (calc.letters.length === 0) return <p className="block-field-hint">{t('creation.noLetters')}</p>;
  const done = new Set(calc.implemented);
  return (
    <div className="flex flex-wrap gap-2">
      {calc.letters.map((letter) => (
        <button
          key={letter}
          type="button"
          disabled={!onToggle}
          onClick={() => onToggle?.(letter)}
          aria-pressed={done.has(letter)}
          className={`block-sigil-letter ${done.has(letter) ? 'block-sigil-letter--on' : ''}`}
        >
          {letter}
        </button>
      ))}
    </div>
  );
}

function CalcReader({ calc, locked }: { calc: CalcValue; locked: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {locked && <p className="block-field-hint">{t('blocks.sigil.locked')}</p>}
      {calc.intention.trim() && <p className="block-sigil-intention whitespace-pre-wrap">{calc.intention}</p>}
      <LetterBank calc={calc} />
    </div>
  );
}

/** Both ways to the letter bank: from the intention, or letters by hand. */
function CalcEditor({ calc, onChange }: { calc: SigilCalcData; onChange: (next: SigilCalcData) => void }) {
  const { t } = useTranslation();
  const [manual, setManual] = useState('');

  // New bank: whatever was already applied and stays in remains applied.
  const setLetters = (letters: string[]) => onChange({ ...calc, letters, implemented: implementedIn(letters, calc.implemented) });
  const toggle = (letter: string) => onChange({
    ...calc,
    implemented: calc.implemented.includes(letter)
      ? calc.implemented.filter((l) => l !== letter)
      : [...calc.implemented, letter],
  });
  const reduceManual = () => {
    const letters = extractUniqueLetters(manual);
    setManual('');
    if (letters.length) setLetters(letters);
  };

  const areaCls = `${OP_PROP_SELECT_CLASSES} min-h-24 resize-y selectable`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="label-xs">{t('creation.intention')}</p>
          <textarea
            value={calc.intention}
            onChange={(e) => onChange({ ...calc, intention: e.target.value })}
            placeholder={t('creation.intentionPlaceholder')}
            className={areaCls}
          />
        </div>
        <div className="space-y-2">
          <p className="label-xs">{t('creation.shortenSigil')}</p>
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            placeholder={t('creation.manualLetterPlaceholder')}
            className={areaCls}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button tone="neutral" small onClick={reduceManual}>{t('creation.addLetter')}</Button>
        <Button tone="jade" small onClick={() => setLetters(extractUniqueLetters(calc.intention))}>{t('creation.prepareLetters')}</Button>
      </div>
      <div className="space-y-2">
        <p className="label-xs">{t('creation.letterBank')}</p>
        <LetterBank calc={{ broken: false, ...calc }} onToggle={toggle} />
      </div>
    </div>
  );
}
