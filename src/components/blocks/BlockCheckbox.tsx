/**
 * The app's checkbox: block sidebar, the block builder of the blocks view,
 * template dialog and the backup in the settings. The label
 * and an optional hint below it are part of it; the box is drawn
 * in `.block-checkbox` (see index.css), from theme variables instead of as a
 * native checkbox.
 */
export default function BlockCheckbox({ checked, onChange, label, hint, title, tone, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Shown visibly below the label. */
  hint?: string;
  /** Appears on hover, for checkboxes whose consequence the label does not capture. */
  title?: string;
  /** Recolours the box's fill and border instead of the accent. */
  tone?: 'warning' | 'danger';
  disabled?: boolean;
}) {
  return (
    <label title={title} className={`flex items-start gap-2 text-xs text-muted ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
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
