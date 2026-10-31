import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import Button from './Button';
import CollapseChevron from './CollapseChevron';

interface Props {
  /** Without onToggleCollapse the chevron is omitted; the header is then not collapsible. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /** Fixed w-5 column as in every category row; keeps the labels of a list aligned. */
  emoji?: string;
  /** Instead of the emoji, in the same w-5 column (tags: the colour dot). */
  leading?: ReactNode;
  label: string;
  /** The "(n)" counter right of the label; the one place for its class chain. */
  count?: number;
  /** Right of the label's free space, after the counter. */
  meta?: ReactNode;
  /** The "+" button: "create an entry directly in this group". A pair, so that
   *  the button cannot come into being without an accessible name. */
  add?: { title: string; onClick: () => void };
  /** Right-aligned buttons, after the "+". */
  actions?: ReactNode;
}

/**
 * The header of a collapsible group: categories in wiki, operations,
 * tasks and altar as well as the "No category" buckets next to them, behind
 * which there is no category, and the tags. Nothing is managed
 * here: `CategoriesView` manages categories; the tags view, which is its
 * own management, passes in its buttons via `leading`/`actions`.
 */
export default function CollapsibleGroupHeader({
  onToggleCollapse, collapsed = false, emoji, leading, label, count, meta, add, actions,
}: Props) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {onToggleCollapse && <CollapseChevron collapsed={collapsed} onToggle={onToggleCollapse} />}
      {leading
        ? <span className="w-5 flex items-center justify-center flex-shrink-0">{leading}</span>
        : emoji && <span className="w-5 text-center flex-shrink-0 text-base">{emoji}</span>}
      <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">{label}</p>
      {count != null && <span className="text-xs text-stone-500">({count})</span>}
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
