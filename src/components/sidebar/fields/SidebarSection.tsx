import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { usePersistedFlag } from '../../../hooks/usePersistedFlag';
import SidebarSectionHeader from './SidebarSectionHeader';

/**
 * A collapsible section of the read view in the right sidebar:
 * properties, links, tags, blocks, and for the altar the elements. Header with
 * chevron, label and an optional counter on the right; whether it is closed is remembered by
 * `storageKey` across all entries (a preference, not a working gesture).
 *
 * The sections stand one below the other without a divider; the spacing between
 * them is set by the caller (`RightSidebar`: `gap-5` in the body).
 *
 * The header sits 4px on the left and 6px on the right inside the edge (`pl-1 pr-1.5`),
 * so the centre of its 12px arrow is at 10px. That is where the icons of the
 * rows begin: `pl-[9px]` plus 1px, by which a 14px icon is
 * indented in its 16px column. On the right the values end 14px before the edge, where the counter
 * of the heading begins: the content is inset 2px with `mr-0.5`, the
 * rows with `pr-3`. So the hover area also ends 2px earlier on the right and
 * does not look wider than the arrow on the left.
 */
export default function SidebarSection({ storageKey, label, count, children }: {
  storageKey: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, toggle] = usePersistedFlag(storageKey, true);
  return (
    <section aria-label={label}>
      <SidebarSectionHeader label={label} open={open} onToggle={toggle} count={count} className="w-full pl-1 pr-1.5" />
      {open && <div className="mr-0.5 mt-1.5 flex flex-col gap-px">{children}</div>}
    </section>
  );
}

/** Fixed 16px column before every row: emoji and lucide icon thus start at the same spot. */
export function RowIcon({ children }: { children: ReactNode }) {
  return <span className="sidebar-row-icon w-4 flex-shrink-0 flex items-center justify-center leading-none">{children}</span>;
}

/**
 * A property: icon and name on the left, value on the right. `muted` for an
 * empty value ("None", "Off"), which is quieter and not bold.
 */
export function SidebarPropertyRow({ icon, label, value, muted = false }: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 pl-[9px] pr-3 py-1.5 text-[13px] min-w-0">
      <RowIcon>{icon}</RowIcon>
      {/* When space gets tight, the name truncates first; the value is what gets read.
          It takes at most 65 %, beyond that it truncates too. */}
      <span className="sidebar-prop-label min-w-0 truncate" title={label}>{label}</span>
      {/* No `truncate` on the flex container itself: with `justify-end` it would cut
          off on the left. A text truncates at its end within its own span. */}
      <span className={`ml-auto flex-shrink-0 max-w-[65%] flex items-center justify-end gap-1.5 ${muted ? 'sidebar-prop-value--muted' : 'sidebar-prop-value'}`}>
        {typeof value === 'string' ? <span className="min-w-0 truncate" title={value}>{value}</span> : value}
      </span>
    </div>
  );
}

/**
 * A clickable list row: a link, a block, an element of the
 * altar: icon, name, and on the right a quiet assignment (`meta`). Hover raises the
 * row as a surface; `active` marks the selected one.
 *
 * When editing, `action` attaches a button behind the row (the links:
 * `SidebarRowRemove`). The row is then a frame around two buttons, with the
 * main part carrying icon, name and assignment as the whole row otherwise would.
 */
export function SidebarItemRow({ icon, label, meta, onClick, active = false, title, action }: {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  action?: ReactNode;
}) {
  const state = active ? ' sidebar-row--active' : '';
  if (action !== undefined) {
    return (
      <div className={`sidebar-row flex items-center gap-1 h-8 pr-1 rounded-md text-[13px] min-w-0${state}`}>
        <button
          type="button"
          onClick={onClick}
          title={title}
          aria-pressed={active}
          className="sidebar-row-main flex flex-1 min-w-0 h-full items-center gap-1.5 pl-[9px] rounded-md text-left"
        >
          <RowIcon>{icon}</RowIcon>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {meta && <span className="sidebar-row-meta flex-shrink-0 max-w-[45%] truncate text-[11px]">{meta}</span>}
        </button>
        {action}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`sidebar-row flex items-center gap-1.5 w-full pl-[9px] pr-3 py-1.5 rounded-md text-[13px] text-left min-w-0${state}`}
    >
      <RowIcon>{icon}</RowIcon>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {meta && <span className="sidebar-row-meta flex-shrink-0 max-w-[45%] truncate text-[11px]">{meta}</span>}
    </button>
  );
}

/**
 * The "×" at the end of a `SidebarItemRow` (`action`). Without `onClick` only
 * its space stays empty, so the assignments line up with those of the rows that have one.
 */
export function SidebarRowRemove({ title, onClick }: { title: string; onClick?: () => void }) {
  if (!onClick) return <span className="w-6 flex-shrink-0" />;
  return (
    <button type="button" onClick={onClick} className="sidebar-row-remove" title={title} aria-label={title}>
      <X size={13} />
    </button>
  );
}

/** The empty state of a section, flush with the icons of the rows. */
export function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty pl-[9px] pr-3 py-1 text-[13px]">{children}</p>;
}
