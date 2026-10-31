import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Expand/collapse arrow for group headers and tree rows: one look for all
 * (size 14, stone-500 → stone-300). Raw button instead of btn-ghost: the icon
 * should sit flush in the text line, button padding would bloat the row.
 */
export default function CollapseChevron({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="text-stone-500 hover:text-stone-300 flex-shrink-0">
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}
