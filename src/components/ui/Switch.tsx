import type { LucideIcon } from 'lucide-react';

/**
 * Ein Ein/Aus-Schalter mit Schiene und Knopf. Für Einstellungen, die sofort
 * wirken und keinen dritten Zustand kennen — in der Dashboard-Seitenleiste
 * Gruppierung und Anzeige. Das Ja/Nein-Feld eines Blocks (`ToggleSwitch` in
 * FieldValueEditor) ist bewusst etwas anderes: dort ist der Wert Inhalt, mit
 * Beschriftung, kein Regler.
 */
export default function Switch({ checked, onChange, disabled, title }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`switch${checked ? ' switch--on' : ''}`}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/**
 * Eine Zeile aus Icon, Label und `Switch` rechts. Die ganze Zeile ist das
 * Label: ein Klick irgendwo schaltet, der Schalter selbst bleibt der eine
 * fokussierbare Knopf.
 */
export function SwitchRow({ icon: Icon, label, checked, onChange, disabled, title }: {
  icon?: LucideIcon;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Tooltip, etwa warum der Schalter gerade gesperrt ist. */
  title?: string;
}) {
  return (
    <label
      title={title}
      // px-3 wie der Auslöser der Auswahl darüber (FieldDropdown) und die
      // Filterzeilen darunter: Icon und Schalter fluchten mit Icon und
      // Chevron der Sortierung.
      className={`switch-row flex items-center gap-2.5 px-3 py-1 text-[13px]${disabled ? ' switch-row--disabled' : ''}`}
    >
      {Icon && <Icon size={14} className="flex-shrink-0" />}
      <span className="flex-1 min-w-0">{label}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} title={title} />
    </label>
  );
}
