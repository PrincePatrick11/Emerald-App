import type { ActiveView } from '../types';
import { ENTRY_MODULE_IDS, isLibraryView, isViewId } from './modules';

/** A tab's back/forward history: the pages visited and the position one is at. */
export interface NavHistory {
  views: ActiveView[];
  index: number;
}

export interface OpenTab {
  id: string;
  view: ActiveView;
  /** Every tab has its own history — back and forward stay within the tab. */
  history: NavHistory;
}

/** Upper limit per history: it is saved to localStorage along with the tabs. */
export const MAX_HISTORY_LENGTH = 50;

export function createTabId(): string {
  return crypto.randomUUID();
}

/**
 * isNew does not go into the history: if one came back to the fresh edit view
 * via Back (or after a restart), Cancel would permanently delete an
 * entry that was autosaved long ago.
 */
export function stripSessionFlags(view: ActiveView): ActiveView {
  const { isNew: _isNew, ...rest } = view;
  return rest;
}

export function freshHistory(view: ActiveView): NavHistory {
  return { views: [stripSessionFlags(view)], index: 0 };
}

/**
 * Appends a page after the current position and cuts off whatever lay ahead of it.
 * The same page (same type, same id) — e.g. switching into
 * edit mode — is not a new step; the history stays unchanged.
 */
export function pushHistory(history: NavHistory, view: ActiveView): NavHistory {
  const current = history.views[history.index];
  if (current && current.type === view.type && current.id === view.id) return history;
  const views = [...history.views.slice(0, history.index + 1), stripSessionFlags(view)]
    .slice(-MAX_HISTORY_LENGTH);
  return { views, index: views.length - 1 };
}

/**
 * Restores a saved history. Tabs from versions without their own
 * history, outdated view types and an index outside the list
 * fall back to a history that ends with the tab's current page.
 */
export function normalizeSavedHistory(raw: unknown, view: ActiveView): NavHistory {
  const candidate = raw as Partial<NavHistory> | null | undefined;
  if (!candidate || !Array.isArray(candidate.views) || typeof candidate.index !== 'number') {
    return freshHistory(view);
  }
  const views = (candidate.views as unknown[])
    .filter((v): v is ActiveView => !!v && typeof v === 'object' && isViewId((v as ActiveView).type))
    .map(stripSessionFlags);
  // Filtering can drop entries before the index — then it no longer
  // matches, and the history would be a mystery. Better to start fresh.
  if (views.length !== candidate.views.length || candidate.index < 0 || candidate.index >= views.length) {
    return freshHistory(view);
  }
  return pushHistory({ views, index: Math.floor(candidate.index) }, view);
}

/**
 * A detail page that gets a tab of its own when no tab is open: an entry
 * or the page of a custom block or a template. Deep links into tags
 * and categories also carry an id, but are only a jump into the list.
 */
export function isContentView(view: ActiveView): boolean {
  if (!view.id) return false;
  return isLibraryView(view.type) || (ENTRY_MODULE_IDS as readonly string[]).includes(view.type);
}
