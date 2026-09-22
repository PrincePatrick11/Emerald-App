/**
 * Das Häkchen der App: Block-Seitenleiste, Baukasten der Blöcke-Ansicht,
 * Vorlagen-Dialog und die Datensicherung in den Einstellungen. Beschriftung
 * und optionaler Hinweis darunter gehören dazu; gezeichnet wird das Kästchen
 * in `.block-checkbox` (siehe index.css), aus Theme-Variablen statt als
 * natives Kästchen.
 */
export default function BlockCheckbox({ checked, onChange, label, hint, title, tone, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Steht sichtbar unter der Beschriftung. */
  hint?: string;
  /** Erscheint beim Zeigen — fuer Haken, deren Folge die Beschriftung nicht fasst. */
  title?: string;
  /** Faerbt Fuellung und Rahmen des Kaestchens um, statt des Akzents. */
  tone?: 'warning' | 'danger';
  disabled?: boolean;
}) {
  return (
    <label title={title} className={`flex items-start gap-2 text-xs text-stone-400 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className={`block-checkbox mt-0.5${tone ? ` block-checkbox--${tone}` : ''}`}
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
