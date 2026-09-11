import type { ActiveView } from '../types';
import { ENTRY_MODULE_IDS } from './modules';

export interface OpenTab {
  id: string;
  view: ActiveView;
}

export function createTabId(): string {
  return crypto.randomUUID();
}

/**
 * Eine Detailseite, die ohne offenen Tab einen eigenen bekommt: ein Eintrag
 * oder die Seite eines eigenen Blocks. Tiefenlinks in Tags und Kategorien
 * tragen auch eine id, sind aber nur ein Sprung in die Liste.
 */
export function isContentView(view: ActiveView): boolean {
  if (!view.id) return false;
  return view.type === 'blocks' || (ENTRY_MODULE_IDS as readonly string[]).includes(view.type);
}
