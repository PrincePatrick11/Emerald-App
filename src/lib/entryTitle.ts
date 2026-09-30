import type { ContentType } from '../types';

/**
 * Die englischen Standardtitel früherer Versionen. Neue Einträge heißen leer
 * und zeigen „Unbenannt…" in der Sprache der App (`displayTitle`); wer noch so
 * heißt — aus einer alten Sicherung oder einem alten Export —, gilt ebenso als
 * unbenannt.
 */
export const LEGACY_UNTITLED_TITLES = [
  'Untitled Entry', 'Untitled Article', 'Untitled Operation', 'Untitled Altar', 'Untitled Task', 'New Task',
  // Der Rückfall der `.emerald`-Exporte für einen leeren Titel.
  'Untitled',
] as const;
const LEGACY_UNTITLED = new Set<string>(LEGACY_UNTITLED_TITLES);

/** Ob `title` ein eigener Titel ist: nicht leer und kein alter Standardtitel. */
export function hasOwnTitle(title: string | null | undefined): title is string {
  const trimmed = title?.trim();
  return !!trimmed && !LEGACY_UNTITLED.has(trimmed);
}

const UNTITLED_KEYS: Record<ContentType, string> = {
  journal: 'journal.untitled',
  wiki: 'wiki.untitled',
  operation: 'operations.untitled',
  task: 'tasks.untitled',
  altar: 'altar.untitled',
};

/** Der Titel, wie er überall angezeigt wird: der eigene, sonst „Unbenannter …" in der Sprache der App. */
export function displayTitle(t: (key: string) => string, type: ContentType, title: string | null | undefined): string {
  return hasOwnTitle(title) ? title : t(UNTITLED_KEYS[type]);
}
