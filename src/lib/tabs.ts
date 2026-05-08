import type { ActiveView } from '../types';

export interface OpenTab {
  key: string;
  view: ActiveView;
}

export function getTabKey(view: ActiveView): string | null {
  if (!view.id) return null;
  if (!['journal', 'wiki', 'operations', 'altar'].includes(view.type)) return null;
  return `${view.type}:${view.id}`;
}

export function isTabbedView(view: ActiveView): boolean {
  return getTabKey(view) !== null;
}
