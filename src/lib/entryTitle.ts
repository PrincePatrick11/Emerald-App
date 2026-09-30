import type { ContentType } from '../types';

/**
 * Die englischen Standardtitel früherer Versionen. Neue Einträge heißen leer
 * und zeigen „Unbenannt…" in der Sprache der App (`displayTitle`). Was so heißt,
 * wird leer, wenn es hereinkommt: Migration v48, Backup- und Datei-Import
 * (`isLegacyUntitled`). Danach ist ein Titel, was jemand eingibt.
 */
export const LEGACY_UNTITLED_TITLES = [
  'Untitled Entry', 'Untitled Article', 'Untitled Operation', 'Untitled Altar', 'Untitled Task', 'New Task',
  // Der Rückfall der `.emerald`-Exporte für einen leeren Titel.
  'Untitled',
] as const;
const LEGACY_UNTITLED = new Set<string>(LEGACY_UNTITLED_TITLES);

/** Ein alter englischer Standardtitel — für Importe, die ihn leer machen. */
export function isLegacyUntitled(title: string | null | undefined): boolean {
  return LEGACY_UNTITLED.has(title?.trim() ?? '');
}

/** Ob `title` ein eigener Titel ist: nicht leer. */
export function hasOwnTitle(title: string | null | undefined): title is string {
  return !!title?.trim();
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
