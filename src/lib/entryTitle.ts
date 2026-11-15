import type { LinkTargetKind } from '../types';

/** Whether `title` is a title of its own: not empty. */
export function hasOwnTitle(title: string | null | undefined): title is string {
  return !!title?.trim();
}

/** The "Untitled …" text of an entry and of a task. */
export const UNTITLED_KEYS: Record<LinkTargetKind, string> = {
  entry: 'entries.untitled',
  task: 'tasks.untitled',
};

/** The title as it is shown everywhere: its own, otherwise "Untitled …" in the app's language. */
export function displayTitle(t: (key: string) => string, type: LinkTargetKind, title: string | null | undefined): string {
  return hasOwnTitle(title) ? title : t(UNTITLED_KEYS[type]);
}
