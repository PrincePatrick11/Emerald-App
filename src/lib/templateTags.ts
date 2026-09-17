import { useSettingsStore } from '../store/settingsStore';

/**
 * Die Tag-Namen des Vaults, klein geschrieben → ihre Schreibweise. `tagStore`
 * hält die Liste hier aktuell (`setKnownTagNames`). Ein eigenes Modul statt
 * eines Imports von `tagStore`: der importiert die Inhalts-Stores und den
 * Vorlagen-Store, und die brauchen genau diese Prüfung — ein Zyklus.
 */
let known = new Map<string, string>();

export function setKnownTagNames(names: readonly string[]): void {
  known = new Map(names.map((name) => [name.toLowerCase(), name]));
}

/**
 * Die Namen, die ein Eintrag aus einer Vorlage übernehmen darf. Darf das
 * Tag-Feld keine Tags anlegen (Einstellung des Vaults), fallen Namen ohne Tag
 * weg — eine Vorlage soll nicht hintenherum schaffen, was die Eingabe nicht
 * darf. Übrig bleibt die Schreibweise des Tags, wie beim Eintippen.
 */
export function usableTemplateTags(names: readonly string[]): string[] {
  if (useSettingsStore.getState().settings.tags.createInline) return [...names];
  const usable = names.map((name) => known.get(name.toLowerCase())).filter((name): name is string => !!name);
  return [...new Set(usable)];
}
