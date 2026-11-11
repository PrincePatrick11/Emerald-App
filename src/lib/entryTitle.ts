import type { ContentType } from '../types';

/**
 * The English default titles of earlier versions. New entries have an empty title
 * and show "Untitled…" in the app's language (`displayTitle`). Anything with
 * such a title is emptied when it comes in: migration v48, backup and file import
 * (`isLegacyUntitled`). From then on a title is whatever someone types.
 */
export const LEGACY_UNTITLED_TITLES = [
  'Untitled Entry', 'Untitled Article', 'Untitled Operation', 'Untitled Altar', 'Untitled Task', 'New Task',
  // The fallback of `.emerald` exports for an empty title.
  'Untitled',
] as const;
const LEGACY_UNTITLED = new Set<string>(LEGACY_UNTITLED_TITLES);

/** An old English default title — for imports that empty it. */
export function isLegacyUntitled(title: string | null | undefined): boolean {
  return LEGACY_UNTITLED.has(title?.trim() ?? '');
}

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
