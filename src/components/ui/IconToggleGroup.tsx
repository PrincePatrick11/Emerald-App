import type { LucideIcon } from 'lucide-react';
import TabIconButton from './TabIconButton';

/**
 * Eine Reihe Icon-Knöpfe als Segment-Auswahl: ein gemeinsamer Rahmen, die
 * aktive Option füllt ihr Segment. Ohne sichtbare Überschrift — die Icons
 * erklären sich über ihre Tooltips, das Label bleibt aria-label der Gruppe.
 * Geteilt von der ListToolbar (Ansicht, mit `fill` über die volle Breite),
 * der Eintragsart-Wahl und den Zellen im Zuweisungs-Dialog einer Vorlage, wo
 * ein Menü je Zelle zu viel wäre.
 */
export default function IconToggleGroup<T extends string>({ label, options, icons, value, onChange, isDisabled, disabledHint, fill }: {
  label: string;
  options: { value: T; label: string }[];
  icons: Record<T, LucideIcon>;
  /** `null`: keine Option aktiv — ein gemischter Stand, etwa „beide Spalten
   *  zugleich" in den Zuweisungen einer Vorlage, wenn die Spalten abweichen. */
  value: T | null;
  onChange: (v: T) => void;
  /** Optionen, die in der aktuellen Kombination nichts bewirken (der
   *  Zeitstrahl verträgt keine Alpha-Sortierung und gruppiert selbst) —
   *  ausgegraut statt versteckt, damit die Reihe nicht springt. */
  isDisabled?: (v: T) => boolean;
  /** Tooltip-Zusatz für deaktivierte Optionen („Im Zeitstrahl ohne Wirkung"). */
  disabledHint?: string;
  /** Volle Breite, Segmente gleich breit — die Ansicht-Leiste der
   *  Dashboard-Seitenleiste. */
  fill?: boolean;
}) {
  return (
    // gap-px hält die Reihe ohne `fill` so schmal wie möglich (Zellen im
    // Zuweisungs-Dialog, Eintragsart-Wahl).
    <div role="group" aria-label={label} className={`${fill ? 'flex w-full' : 'inline-flex'} gap-px p-0.5 rounded-md border border-stone-700/60 bg-stone-800/60`}>
      {options.map((option) => {
        const Icon: LucideIcon = icons[option.value];
        const disabled = isDisabled?.(option.value) ?? false;
        const title = disabled && disabledHint ? `${option.label} — ${disabledHint}` : option.label;
        return (
          <TabIconButton
            key={option.value}
            compact
            active={value === option.value}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            title={title}
            aria-label={title}
            // Mit `fill` py-1 statt p-1.5: die Leiste wird 30px hoch wie der
            // Primärknopf und die Auswahl darunter.
            className={fill ? 'flex-1 flex justify-center py-1' : undefined}
          >
            <Icon size={14} />
          </TabIconButton>
        );
      })}
    </div>
  );
}
