import type { ActiveView } from '../types';
import { ENTRY_MODULE_IDS } from './modules';

export interface OpenTab {
  id: string;
  view: ActiveView;
}

export function createTabId(): string {
  return crypto.randomUUID();
}

export function isContentView(view: ActiveView): boolean {
  return !!view.id && (ENTRY_MODULE_IDS as readonly string[]).includes(view.type);
}
