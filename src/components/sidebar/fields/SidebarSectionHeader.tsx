import { ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarSectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Abstand zum Vorgänger — der Wrapper um Kopf und Inhalt bleibt Sache des Aufrufers. */
  className?: string;
}

/**
 * Der Kopf eines einklappbaren Abschnitts in der rechten Seitenleiste: Chevron
 * plus kleines Großbuchstaben-Label. Kontrolliert, weil die Aufrufer ihren
 * Zustand verschieden halten — der Altar alle Abschnitte pro Altar in einem
 * localStorage-Objekt, die Block-Verwaltung per `usePersistedFlag`.
 */
export default function SidebarSectionHeader({ label, open, onToggle, className = '' }: SidebarSectionHeaderProps) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={`sidebar-section-title ${className}`}>
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      {label}
    </button>
  );
}
