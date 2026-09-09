import type { LucideIcon } from 'lucide-react';
import TabIconButton from './TabIconButton';

/**
 * Eine Reihe Icon-Knöpfe als Segment-Auswahl: ein gemeinsamer Rahmen, die
 * aktive Option füllt ihr Segment. Ohne sichtbare Überschrift — die Icons
 * erklären sich über ihre Tooltips, das Label bleibt aria-label der Gruppe.
 * Die Darreichungsform der schmalen Seitenleiste — im Hauptbereich wählt man
 * mit `Dropdown`. Geteilt von der ListToolbar (Ansicht und Sortierung im
 * Seitenleisten-Modus) und den Reglern der Altar-Bibliothek, die im selben
 * Kopf darunter stehen und deshalb gleich aussehen müssen.
 */
export default function IconToggleGroup<T extends string>({ label, options, icons, value, onChange, isDisabled, disabledHint }: {
  label: string;
  options: { value: T; label: string }[];
  icons: Record<T, LucideIcon>;
  value: T;
  onChange: (v: T) => void;
  /** Optionen, die in der aktuellen Kombination nichts bewirken (der
   *  Zeitstrahl verträgt keine Alpha-Sortierung und gruppiert selbst) —
   *  ausgegraut statt versteckt, damit die Reihe nicht springt. */
  isDisabled?: (v: T) => boolean;
  /** Tooltip-Zusatz für deaktivierte Optionen („Im Zeitstrahl ohne Wirkung"). */
  disabledHint?: string;
}) {
  return (
    // gap-px hält die Reihe so schmal wie möglich. In der Seitenleiste
    // stehen bis zu drei solcher Reihen (Ansicht 4, Sortierung 4,
    // Gruppierung 2); zusammen passen sie bei Standardbreite nicht in eine
    // Zeile, der flex-wrap-Container darum bricht um, und in der Höhe ist
    // dort Platz.
    <div role="group" aria-label={label} className="inline-flex gap-px p-0.5 rounded-md border border-stone-700/60 bg-stone-800/60">
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
          >
            <Icon size={14} />
          </TabIconButton>
        );
      })}
    </div>
  );
}
