import { ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarSectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Counter right-aligned in the header (the read view's sections, `SidebarSection`). */
  count?: number;
  /** Spacing to the predecessor; the wrapper around header and content remains the caller's business. */
  className?: string;
}

/**
 * The header of a collapsible section in the right sidebar: chevron
 * plus a small uppercase label, optionally a counter. Controlled, because
 * the callers may hold their state differently: the block management and
 * `SidebarSection` via `usePersistedFlag`.
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
