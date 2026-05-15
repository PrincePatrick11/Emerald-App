import type { ActiveView } from '../types';

export interface OpenTab {
  id: string;
  view: ActiveView;
}

export function createTabId(): string {
  return crypto.randomUUID();
}

export function isContentView(view: ActiveView): boolean {
  return !!view.id && ['journal', 'wiki', 'operations', 'altar', 'tasks'].includes(view.type);
}
