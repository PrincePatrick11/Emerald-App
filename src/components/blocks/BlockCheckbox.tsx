/**
 * Ein Häkchen mit Beschriftung und optionalem Hinweis darunter — die
 * Einstellungen der Block-Seitenleiste und des Baukastens in der
 * Blöcke-Ansicht. `.block-checkbox` färbt das Häkchen im Akzent des Themes.
 */
export default function BlockCheckbox({ checked, onChange, label, hint, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 text-xs text-stone-400 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="block-checkbox mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block block-field-hint">{hint}</span>}
      </span>
    </label>
  );
}
