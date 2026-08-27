import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Auf-/Zuklapp-Pfeil für Gruppenköpfe und Baumzeilen — eine Optik für alle
 * (Größe 14, stone-500 → stone-300). Roher Button statt btn-ghost: das Icon
 * soll bündig in der Textzeile sitzen, Button-Padding würde die Zeile aufblähen.
 */
export default function CollapseChevron({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="text-stone-500 hover:text-stone-300 flex-shrink-0">
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}
