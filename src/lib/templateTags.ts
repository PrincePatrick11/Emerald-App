import { useSettingsStore } from '../store/settingsStore';

/**
 * Die Schreibweise des Tags zu einem Namen, oder `undefined`, wenn es keinen
 * gibt. `tagStore` meldet die Suche hier an (`registerTagLookup`) — ein eigenes
 * Modul statt eines Imports von `tagStore`: der importiert die Inhalts-Stores
 * und den Vorlagen-Store, und die brauchen genau diese Prüfung, ein Zyklus.
 */
let tagNameOf: (name: string) => string | undefined = () => undefined;

export function registerTagLookup(lookup: (name: string) => string | undefined): void {
  tagNameOf = lookup;
}

/**
 * Die Namen, die ein Eintrag aus einer Vorlage übernimmt — in der Schreibweise
 * des Tags, wie beim Eintippen (Umbenennen und Löschen suchen den Namen exakt).
 * Darf das Tag-Feld keine Tags anlegen (Einstellung des Vaults), fallen Namen
 * ohne Tag weg: eine Vorlage soll nicht hintenherum schaffen, was die Eingabe
 * nicht darf.
 */
export function usableTemplateTags(names: readonly string[]): string[] {
  const createInline = useSettingsStore.getState().settings.tags.createInline;
  const usable = names
    .map((name) => tagNameOf(name) ?? (createInline ? name : undefined))
    .filter((name): name is string => !!name);
  return [...new Set(usable)];
}

/** `template` mit den Tags, die es wirklich übernimmt (`usableTemplateTags`). */
export function withUsableTags<T extends { tags: readonly string[] }>(template: T): T {
  return { ...template, tags: usableTemplateTags(template.tags) };
}
