import type { MouseEvent, ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import type { ActiveView } from '../../types';

/** Rahmen je Darstellung. Die Karte trägt `w-full` für die Raster-Zelle, die
 *  Zeile `group` für Hover-Details im Inhalt. */
const LAYOUT_CLASS: Record<DashboardItemLayout, string> = {
  row: 'panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group',
  card: 'panel-interactive w-full text-left px-4 py-4',
};

export type DashboardItemLayout = 'row' | 'card';

interface DashboardItemProps {
  /** Wohin Klick (dieser Tab) und Mittelklick (neuer Tab) führen. */
  view: ActiveView;
  layout: DashboardItemLayout;
  onContextMenu?: (event: MouseEvent) => void;
  /** Umbenennen an Ort und Stelle: derselbe Rahmen als schlichtes `div`, ohne
   *  Klick und Mittelklick — das Eingabefeld darin soll Klicks bekommen, nicht
   *  die Navigation. */
  editing?: boolean;
  children: ReactNode;
}

/**
 * Ein klickbarer Eintrag auf einem Dashboard: `panel-interactive`-Rahmen,
 * Klick öffnet `view`, Mittelklick öffnet ihn in einem neuen Tab. Der Inhalt
 * bleibt beim Aufrufer — die Module zeigen darin sehr Verschiedenes.
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
