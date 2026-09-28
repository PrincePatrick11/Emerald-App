import { ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarSectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Zähler rechtsbündig im Kopf (die Abschnitte der Leseansicht, `SidebarSection`). */
  count?: number;
  /** Abstand zum Vorgänger — der Wrapper um Kopf und Inhalt bleibt Sache des Aufrufers. */
  className?: string;
}

/**
 * Der Kopf eines einklappbaren Abschnitts in der rechten Seitenleiste: Chevron
 * plus kleines Großbuchstaben-Label, optional ein Zähler. Kontrolliert, weil
 * die Aufrufer ihren Zustand verschieden halten — der Altar alle Abschnitte pro
 * Altar in einem localStorage-Objekt, die Block-Verwaltung und `SidebarSection`
 * per `usePersistedFlag`.
 */
export default function SidebarSectionHeader({ label, open, onToggle, count, className = '' }: SidebarSectionHeaderProps) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={`sidebar-section-title ${className}`}>
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      {label}
      {count !== undefined && <span className="sidebar-section-count">{count}</span>}
    </button>
  );
}
