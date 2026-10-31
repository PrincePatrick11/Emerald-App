export const OP_PROP_SELECT_CLASSES =
  'op-prop-select w-full bg-well-strong rounded-md px-3 py-1.5 text-xs text-soft outline-none ' +
  'border border-edge focus:border-edge-strong transition-colors placeholder:text-faint';

/**
 * The surface of a row in the sidebar lists with a handle — the altar's
 * placed elements, block management: dragged, selected or at rest. A
 * Tailwind chain on the theme's colour utilities.
 */
export function sidebarRowStateClasses({ dragging, selected }: { dragging: boolean; selected: boolean }): string {
  if (dragging) return 'border-accent-edge bg-accent-wash text-soft opacity-50 scale-[0.98]';
  if (selected) return 'border-accent-edge bg-accent-fill text-on-accent';
  return 'border-edge bg-well-sunk text-muted hover:border-edge-raise hover:text-raise';
}
