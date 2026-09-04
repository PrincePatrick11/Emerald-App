import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

interface SelectFieldProps<T> {
  /** Fertiger Label-String inkl. Emoji, z. B. `⚡ ${t('creation.chargingTechnique')}`. */
  label: string;
  value: string | null | undefined;
  options: readonly T[];
  getId: (option: T) => string;
  getLabel: (option: T) => string;
  /** Text der Leer-Option, üblicherweise t('properties.none'). */
  noneLabel: string;
  onChange: (id: string | null) => void;
}

/**
 * Das gemeinsame native Select der Properties-Panels: Label-Zeile,
 * `op-prop-select`-Styling, Leer-Option und die `'' ↔ null`-Konvertierung.
 * Bewusst nativ statt CategorySelect: kleine feste Artikel-Listen ohne
 * Builtin/Custom-Unterscheidung — der Themed-Picker gilt nur für Kategorien.
 */
export default function SelectField<T>({
  label, value, options, getId, getLabel, noneLabel, onChange,
}: SelectFieldProps<T>) {
  return (
    <div>
      <p className="label-xs mb-2">{label}</p>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={OP_PROP_SELECT_CLASSES + ' cursor-pointer'}
      >
        <option value="">{noneLabel}</option>
        {options.map((option) => (
          <option key={getId(option)} value={getId(option)}>{getLabel(option)}</option>
        ))}
      </select>
    </div>
  );
}
