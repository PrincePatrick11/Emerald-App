import { ChevronDown } from 'lucide-react';
import Dropdown, { type DropdownOption } from './Dropdown';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Text des Auslösers, wenn er nicht aus der gewählten Option kommen soll. */
  triggerText?: string;
  align?: 'left' | 'right';
}

/**
 * Ein Auswahlmenü im Look der Eigenschaftsfelder: volle Breite, Feldrahmen,
 * Chevron. Das Menü wird geportalt — die Seitenleisten scrollen, ein absolut
 * positioniertes Menü würde dort abgeschnitten. Nutzer: `CategorySelect`
 * (`variant="field"`) und die Zuweisungen einer Vorlage.
 */
export default function FieldDropdown<T extends string>({ value, options, onChange, triggerText, align }: Props<T>) {
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
          className={OP_PROP_SELECT_CLASSES + ' cursor-pointer flex items-center justify-between gap-2 text-left'}
        >
          <span className="truncate">{text}</span>
          <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
        </button>
      )}
    />
  );
}
