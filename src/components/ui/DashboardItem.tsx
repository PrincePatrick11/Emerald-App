import type { MouseEvent, ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import type { ActiveView } from '../../types';

/** Frame per presentation. The card carries `w-full` for the grid cell, the
 *  row `group` for hover details in the content. */
const LAYOUT_CLASS: Record<DashboardItemLayout, string> = {
  row: 'panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group',
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
 * stays with the caller; the modules show very different things in it.
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
