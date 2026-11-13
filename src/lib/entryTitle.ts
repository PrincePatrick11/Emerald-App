import type { ContentType } from '../types';

/** Whether `title` is a title of its own: not empty. */
export function hasOwnTitle(title: string | null | undefined): title is string {
  return !!title?.trim();
}

const UNTITLED_KEYS: Record<ContentType, string> = {
  journal: 'journal.untitled',
  wiki: 'wiki.untitled',
  operation: 'operations.untitled',
  task: 'tasks.untitled',
};

/** The title as it is shown everywhere: its own, otherwise "Untitled …" in the app's language. */
export function displayTitle(t: (key: string) => string, type: ContentType, title: string | null | undefined): string {
  return hasOwnTitle(title) ? title : t(UNTITLED_KEYS[type]);
}
