import type { ActiveView, ContentType } from '../types';

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

/**
 * The view type an entry of `entryType` opens in.
 *
 * The one rename in the app: the data model says `operation`, singular — it is
 * what `links.target_type`, the drag payload and the internal-link mark all
 * carry — while `ActiveView` says `operations`, plural, after the module rather
 * than the record. Journal and wiki spell both the same, which is why the
 * mismatch is easy to forget at exactly the fourth call site.
 */
export function viewTypeForEntryType(entryType: ContentType): ActiveView['type'] {
  return entryType === 'operation' ? 'operations' : entryType;
}
