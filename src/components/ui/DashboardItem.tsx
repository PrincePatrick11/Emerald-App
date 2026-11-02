import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import { isImageIcon } from '../../lib/helpers';
import type { ActiveView } from '../../types';

/** The one row of every dashboard: 44px, whatever it holds. The card carries
 *  `w-full` for the grid cell, the row `group` for hover details in the content. */
const ROW_CLASS = 'panel-interactive w-full text-left flex items-center gap-3 px-4 h-11 group';

/** Frame per presentation. */
const LAYOUT_CLASS: Record<DashboardItemLayout, string> = {
  row: ROW_CLASS,
  card: 'panel-interactive w-full text-left px-4 py-4',
};

export type DashboardItemLayout = 'row' | 'card';

interface DashboardItemProps {
  /** Where click (this tab) and middle click (new tab) lead. */
  view: ActiveView;
  layout: DashboardItemLayout;
  onContextMenu?: (event: MouseEvent) => void;
  /** Rename in place: the same frame as a plain `div`, without
   *  click, middle click and context menu; the input field inside it (`RenameField`)
   *  should receive clicks, not the navigation. `view` is then unused. */
  editing?: boolean;
  children: ReactNode;
}

/**
 * A clickable entry on a dashboard: `panel-interactive` frame,
 * click opens `view`, middle click opens it in a new tab. The content
 * is `RowContent` or `CardContent`; an altar card brings its own.
 */
export default function DashboardItem({ view, layout, onContextMenu, editing, children }: DashboardItemProps) {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);

  if (editing) return <div className={LAYOUT_CLASS[layout]}>{children}</div>;

  return (
    <button
      onClick={() => setActiveView(view)}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        openViewInNewTab(view);
      }}
      onContextMenu={onContextMenu}
      className={LAYOUT_CLASS[layout]}
    >
      {children}
    </button>
  );
}

/**
 * The same row for what does not open a page: a category, a tag, a task, a
 * trashed item. Whatever a click does here is the caller's; without an
 * `onClick` the pointer stays an arrow.
 */
export function DashboardRow({ className = '', onClick, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div onClick={onClick} className={`${ROW_CLASS} ${onClick ? '' : 'cursor-default'} ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** An entry's icon, an emoji or an image, at row or card size. */
export function ItemGlyph({ icon, large }: { icon: string; large?: boolean }) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className={`${large ? 'w-6 h-6' : 'w-5 h-5'} object-cover rounded-md`} />;
  }
  return <>{icon}</>;
}

/** A row's symbol column, at least as wide as an emoji, so names line up across
 *  a list; an altar's preview is the one thing wider. */
export function RowIcon({ children }: { children: ReactNode }) {
  return <span className="min-w-5 flex items-center justify-center flex-shrink-0 text-base">{children}</span>;
}

/** Inside a row: symbol and name on the left, metadata on the right. */
export function RowContent({ icon, title, meta }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode }) {
  return (
    <>
      {icon != null && <RowIcon>{icon}</RowIcon>}
      <span className="flex-1 min-w-0 truncate text-sm text-soft">{title}</span>
      {meta != null && meta !== false && (
        <span className="text-xs text-muted min-w-0 max-w-[60%] truncate flex-shrink-0">{meta}</span>
      )}
    </>
  );
}

/** Inside a card: the same three things, stacked. `children` follow below (a journal entry's tags). */
export function CardContent({ icon, title, meta, children }: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center text-xl mb-2 h-7">{icon}</div>
      <div className="text-sm font-medium text-secondary truncate mb-1">{title}</div>
      {meta != null && <div className="text-xs text-muted truncate">{meta}</div>}
      {children}
    </>
  );
}

/** The class of a `RenameField` standing in for a row's or card's title. */
export const RENAME_INPUT_CLASS = 'w-full bg-transparent outline-none selectable';
