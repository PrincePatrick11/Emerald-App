import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import Button from './Button';
import CollapseChevron from './CollapseChevron';

interface Props {
  /** Without onToggleCollapse the chevron is omitted; the header is then not collapsible. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /** Fixed w-5 column as in every row; keeps the labels of a list aligned. */
  emoji?: string;
  /** Instead of the emoji, in the same w-5 column (Home: the module icon). */
  leading?: ReactNode;
  label: string;
  /** The "(n)" counter right of the label; the one place for its class chain. */
  count?: number;
  /** Right of the label's free space, after the counter. */
  meta?: ReactNode;
  /** The "+" button: "create an entry directly in this group". A pair, so that
   *  the button cannot come into being without an accessible name. */
  add?: { title: string; onClick: () => void };
  /** Right-aligned controls, after the "+". */
  actions?: ReactNode;
}

/**
 * The one heading above rows on a dashboard: a category, a moon phase, a
 * month, a type in the trash, and a whole section (the altars, the library,
 * the languages). Nothing is managed here; a category is managed in
 * `CategoriesView`, as a row.
 */
export default function CollapsibleGroupHeader({
  onToggleCollapse, collapsed = false, emoji, leading, label, count, meta, add, actions,
}: Props) {
  const labelClass = 'flex-1 min-w-0 truncate text-left text-xs font-semibold text-subtle uppercase tracking-wider';
  return (
    <div className="flex items-center gap-2 min-h-6 mb-2">
      {onToggleCollapse && <CollapseChevron collapsed={collapsed} onToggle={onToggleCollapse} />}
      {leading
        ? <span className="w-5 flex items-center justify-center flex-shrink-0">{leading}</span>
        : emoji && <span className="w-5 text-center flex-shrink-0 text-base">{emoji}</span>}
      {onToggleCollapse
        ? <button onClick={onToggleCollapse} className={`${labelClass} transition-colors hover:text-raise`}>{label}</button>
        : <p className={labelClass}>{label}</p>}
      {count != null && <span className="text-xs text-subtle">({count})</span>}
      {meta}
      {/* Tinted row action in the 24px small row; 30px would bloat the
          header line. */}
      {add && (
        <Button tone="jade" compact small title={add.title} aria-label={add.title} onClick={add.onClick}>
          <Plus size={12} />
        </Button>
      )}
      {actions}
    </div>
  );
}
