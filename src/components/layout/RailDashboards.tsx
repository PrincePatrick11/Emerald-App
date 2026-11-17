import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, SlidersHorizontal, Trash2 } from 'lucide-react';
import RailButton from '../ui/RailButton';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import DashboardGlyph from '../ui/DashboardGlyph';
import { DRAG_THRESHOLD_PX, trackPointerDrag } from '../../lib/pointerDrag';
import { dashboardLabel } from '../../lib/dashboards';
import { dashboardOrAll, useDashboardStore } from '../../store/dashboardStore';
import { openDashboardSettings } from '../../store/dashboardSettingsStore';
import { deleteDashboardWithUndo } from '../../store/dashboardActions';
import { useUIStore } from '../../store/uiStore';
import type { ActiveView, Dashboard } from '../../types';

/** Where a dashboard's rail button leads: its list. */
function viewOfDashboard(d: Dashboard): ActiveView {
  return { type: 'dashboard', id: d.id };
}

/** Is the open page this dashboard's list? An unknown dashboard ID shows "All entries" (`DashboardView`). */
function useIsActive(): (d: Dashboard) => boolean {
  const view = useUIStore((s) => s.activeView);
  const dashboards = useDashboardStore((s) => s.dashboards);
  // The dashboard the page shows — its list, or an entry opened from it;
  // a gone one shows "All entries".
  const shownId = view.type === 'dashboard' ? view.id ?? 'all' : view.type === 'entry' ? view.dashboard ?? 'all' : undefined;
  const shown = shownId === undefined ? undefined : dashboardOrAll(dashboards, shownId)?.id;
  return (d) => d.id === shown;
}

/**
 * The rail's dashboards: "All entries" on its own at the top, the others as
 * a group in their order. A drag moves a button within the group (the order
 * is saved); right-click opens the settings, moves up or down, deletes.
 */
export function useRailDashboards() {
  const { t } = useTranslation();
  const dashboards = useDashboardStore((s) => s.dashboards);
  const reorder = useDashboardStore((s) => s.reorderDashboards);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const isActive = useIsActive();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  /** The click that ends a drag must not open the dashboard. */
  const swallowClick = useRef(false);

  const all = dashboards.find((d) => d.builtin === 'all');
  const others = dashboards.filter((d) => d.builtin !== 'all');

  const shown = (() => {
    if (!drag) return others;
    const list = others.filter((d) => d.id !== drag.id);
    const moved = others.find((d) => d.id === drag.id);
    if (moved) list.splice(Math.min(drag.over, list.length), 0, moved);
    return list;
  })();

  const saveOrder = (ordered: Dashboard[]) => {
    const ids = [...(all ? [all.id] : []), ...ordered.map((d) => d.id)];
    reorder(ids).catch((e: unknown) => console.error('[RailDashboards] reordering failed:', e));
  };

  const move = (id: string, step: -1 | 1) => {
    const from = others.findIndex((d) => d.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= others.length) return;
    const ordered = [...others];
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    saveOrder(ordered);
  };

  const overIndex = (clientY: number): number => {
    const buttons = Array.from(groupRef.current?.querySelectorAll<HTMLElement>('[data-dashboard-id]') ?? []);
    let best = 0;
    let bestDist = Infinity;
    buttons.forEach((button, i) => {
      const rect = button.getBoundingClientRect();
      const dist = Math.abs(clientY - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  };

  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    let over = others.findIndex((d) => d.id === id);
    trackPointerDrag(e, {
      threshold: DRAG_THRESHOLD_PX,
      onStart: () => setDrag({ id, over }),
      onMove: (ev) => {
        over = overIndex(ev.clientY);
        setDrag({ id, over });
      },
      onEnd: ({ started, cancelled }) => {
        setDrag(null);
        if (!started) return;
        swallowClick.current = true;
        setTimeout(() => { swallowClick.current = false; });
        if (cancelled) return;
        const list = others.filter((d) => d.id !== id);
        const moved = others.find((d) => d.id === id);
        if (!moved) return;
        list.splice(Math.min(over, list.length), 0, moved);
        if (list.some((d, i) => d.id !== others[i].id)) saveOrder(list);
      },
    });
  };

  const button = (d: Dashboard, draggable: boolean) => (
    <RailButton
      key={d.id}
      data-dashboard-id={d.id}
      active={isActive(d)}
      onClick={() => { if (!swallowClick.current) setActiveView(viewOfDashboard(d)); }}
      onPointerDown={draggable ? (e) => startDrag(e, d.id) : undefined}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ id: d.id, x: e.clientX, y: e.clientY }); }}
      title={dashboardLabel(t, d)}
      className={drag?.id === d.id ? 'opacity-60' : undefined}
    >
      <DashboardGlyph dashboard={d} size={18} />
    </RailButton>
  );

  const menuTarget = menu ? dashboards.find((d) => d.id === menu.id) : undefined;
  const menuIndex = menuTarget ? others.findIndex((d) => d.id === menuTarget.id) : -1;
  const menuActions: ContextMenuAction[] = menuTarget ? [
    { label: t('dashboards.settings'), icon: <SlidersHorizontal size={12} />, onClick: () => openDashboardSettings(menuTarget.id) },
    ...(menuTarget.builtin === 'all' ? [] : [
      { label: t('dashboards.moveUp'), icon: <ArrowUp size={12} />, onClick: () => move(menuTarget.id, -1), disabled: menuIndex <= 0, separator: true },
      { label: t('dashboards.moveDown'), icon: <ArrowDown size={12} />, onClick: () => move(menuTarget.id, 1), disabled: menuIndex >= others.length - 1 },
      { label: t('common.delete'), icon: <Trash2 size={12} />, onClick: () => void deleteDashboardWithUndo(menuTarget.id), danger: true, separator: true },
    ]),
  ] : [];

  return {
    allButton: all && button(all, false),
    group: (
      <div ref={groupRef} className="w-full flex flex-col items-center gap-1">
        {shown.map((d) => button(d, true))}
      </div>
    ),
    menu: menu && menuTarget && (
      <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />
    ),
  };
}
