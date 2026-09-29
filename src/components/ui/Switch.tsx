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
 * fokussierbare Knopf. Mit `hint` steht ein leiser Hinweis unter dem Label,
 * und der Schalter sitzt an dessen erster Textzeile.
 *
 * `variant="sidebar"`: die Bearbeiten-Seitenleiste (Anzeige eines eigenen
 * Blocks) — eingerückt wie ihre Zeilen, mit Hover-Fläche.
 * `variant="panel"`: ohne Einzug und Hover-Fläche, bündig mit den Feldern
 * darüber — in den Einstellungen eines Blocks unter seiner Zeile und in den
 * Abschnitten des Einstellungsfensters.
 */
export function SwitchRow({ icon: Icon, label, hint, checked, onChange, disabled, title, variant = 'dashboard' }: {
  icon?: LucideIcon;
  label: string;
  /** Steht leise unter dem Label und darf umbrechen. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Tooltip, etwa warum der Schalter gerade gesperrt ist. */
  title?: string;
  variant?: 'dashboard' | 'sidebar' | 'panel';
}) {
  const sidebar = variant === 'sidebar';
  return (
    <label
      title={title}
      // Dashboard: px-3 wie der Auslöser der Auswahl darüber (FieldDropdown)
      // und die Filterzeilen darunter — Icon und Schalter fluchten mit Icon
      // und Chevron der Sortierung. Einzeilig 30px hoch wie die übrigen
      // Bedienelemente der Leiste; bricht das Label um, bleibt es eng.
      // Seitenleiste: das Icon beginnt bei 10px wie die Zeilen-Icons dort.
      className={`switch-row flex ${hint ? 'items-start' : 'items-center'} gap-2.5 ${
        sidebar ? 'switch-row--sidebar pl-2.5 pr-3 py-1 rounded-md' : variant === 'panel' ? 'switch-row--panel px-0.5 py-1' : 'px-3 py-[7px]'
      } text-[13px] leading-4${disabled ? ' switch-row--disabled' : ''}`}
    >
      {Icon && <Icon size={14} className="flex-shrink-0" />}
      <span className="flex-1 min-w-0">
        {label}
        {hint && <span className="switch-row-hint block mt-0.5 text-xs leading-[1.4]">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} title={title} />
    </label>
  );
}
