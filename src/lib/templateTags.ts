/**
 * Lebt der Tag mit dieser ID? `tagStore` meldet die Prüfung hier an
 * (`registerTagLookup`) — ein eigenes Modul statt eines Imports von
 * `tagStore`: der importiert die Inhalts-Stores und den Vorlagen-Store, und
 * die brauchen genau diese Prüfung, ein Zyklus.
 *
 * Angemeldet wird beim ersten Import von `store/tagStore` — den zieht
 * `store/moduleWiring` beim Start herein, lange bevor eine Vorlage angewendet
 * werden kann.
 */
let isLiveTag: (id: string) => boolean = () => false;

export function registerTagLookup(lookup: (id: string) => boolean): void {
  isLiveTag = lookup;
}

/**
 * Die Tags, die ein Eintrag aus einer Vorlage übernimmt: die lebenden. Einer
 * im Papierkorb bleibt in der Vorlage stehen (er kann zurückkommen), geht aber
 * in keinen neuen Eintrag über.
 */
export function usableTemplateTags(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isLiveTag(id)))];
}

/** `template` mit den Tags, die es wirklich übernimmt (`usableTemplateTags`). */
export function withUsableTags<T extends { tags: readonly string[] }>(template: T): T {
  return { ...template, tags: usableTemplateTags(template.tags) };
}
