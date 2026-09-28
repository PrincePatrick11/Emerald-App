import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import Dropdown, { type DropdownOption } from './Dropdown';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

/** Der Feld-Look eine Stufe größer: `text-sm` statt `text-xs`, `py-2`
 *  statt `py-1.5` — ausgeschrieben statt überschrieben, damit keine zwei
 *  Tailwind-Klassen um dieselbe Eigenschaft streiten. Sonst dieselben
 *  Klassen wie OP_PROP_SELECT_CLASSES (die Theme-Brücken hängen an
 *  `op-prop-select`). */
const SIDEBAR_SELECT_CLASSES =
  'op-prop-select w-full bg-stone-800/60 rounded-md px-3 py-2 text-sm text-stone-300 outline-none ' +
  'border border-stone-700/40 focus:border-stone-600 transition-colors';

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Text des Auslösers, wenn er nicht aus der gewählten Option kommen soll. */
  triggerText?: string;
  align?: 'left' | 'right';
  /** `sidebar`: die Auswahl der Dashboard-Seitenleiste (SortSelect) — das
   *  Icon der gewählten Option vorn, `text-sm`, etwas höher, Hoch/Runter-
   *  Chevron; Icon und Chevron fluchten mit den `SwitchRow`s darunter. */
  variant?: 'field' | 'sidebar';
  /** aria-label des Auslösers, wenn sein Text allein nicht sagt, was er wählt. */
  ariaLabel?: string;
}

/**
 * Ein Auswahlmenü im Look der Eigenschaftsfelder: volle Breite, Feldrahmen,
 * Chevron. Das Menü wird geportalt — die Seitenleisten scrollen, ein absolut
 * positioniertes Menü würde dort abgeschnitten. Nutzer: `CategorySelect`
 * (`variant="field"`), die Zuweisungen einer Vorlage, die Übersicht der
 * Standardvorlagen und die Sortierung der Dashboard-Seitenleiste
 * (`SortSelect`, `variant="sidebar"`).
 */
export default function FieldDropdown<T extends string>({ value, options, onChange, triggerText, align, variant = 'field', ariaLabel }: Props<T>) {
  const sidebar = variant === 'sidebar';
  const current = options.find((o) => o.value === value);
  const text = triggerText ?? (current ? `${current.emoji ? `${current.emoji} ` : ''}${current.label}` : '');
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      align={align}
      portal
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={`${sidebar ? SIDEBAR_SELECT_CLASSES : OP_PROP_SELECT_CLASSES} cursor-pointer flex items-center gap-2.5 text-left`}
        >
          {sidebar && current?.icon}
          <span className="flex-1 min-w-0 truncate">{text}</span>
          {sidebar
            ? <ChevronsUpDown size={14} className="flex-shrink-0 opacity-60" />
            : <ChevronDown size={12} className="flex-shrink-0 opacity-60" />}
        </button>
      )}
    />
  );
}
