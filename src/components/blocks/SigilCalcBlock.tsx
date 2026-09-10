import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import {
  extractUniqueLetters, implementedIn, parseSigilCalc, serializeSigilCalc, type SigilCalc,
} from '../../lib/blocks/sigil';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import UnknownBlock from './UnknownBlock';
import SigilConcealed from './SigilConcealed';
import type { BlockViewProps } from './blockViews';

/**
 * Der Sigillen-Rechner: aus der Absicht die Buchstabenbank (jeder Buchstabe
 * einmal), und welche davon schon in der Zeichnung stecken. Solange die
 * Sigille geladen ist, schreibgeschützt; bis zum Zieldatum verborgen — auch
 * beim Bearbeiten, sonst zeigte „Bearbeiten" (Sperre „nur Sigille") sie vorzeitig.
 */
export default function SigilCalcBlock({ block, isEditing, onBlockChange, sigil }: BlockViewProps) {
  const calc = parseSigilCalc(block);
  if (calc.broken) return <UnknownBlock block={block} />;
  if (sigil.concealed) return <SigilConcealed revealDate={sigil.revealDate} />;
  if (isEditing && !sigil.lockSigil) {
    return <CalcEditor calc={calc} onChange={(next) => onBlockChange(serializeSigilCalc(block, next))} />;
  }
  return <CalcReader calc={calc} locked={isEditing} />;
}

/**
 * Die Buchstabenbank. Die Kacheln sind bewusst kein `Button`: ein
 * Buchstabe, der zwischen „offen" und „umgesetzt" wechselt, ist ein
 * Schalter im Inhalt, keine Aktion — Farben über `.block-sigil-letter`.
 */
function LetterBank({ calc, onToggle }: { calc: SigilCalc; onToggle?: (letter: string) => void }) {
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

function CalcReader({ calc, locked }: { calc: SigilCalc; locked: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {locked && <p className="block-field-hint">{t('blocks.sigil.locked')}</p>}
      {calc.intention.trim() && <p className="block-sigil-intention whitespace-pre-wrap">{calc.intention}</p>}
      <LetterBank calc={calc} />
    </div>
  );
}

type CalcData = Omit<SigilCalc, 'broken'>;

function CalcEditor({ calc, onChange }: { calc: CalcData; onChange: (next: CalcData) => void }) {
  const { t } = useTranslation();
  const [manual, setManual] = useState('');

  // Neue Bank: was schon umgesetzt war und drin bleibt, bleibt umgesetzt.
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
