import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BlockDefinitionPatch } from './blockDefinitionStore';
import type { TemplatePatch } from './templateStore';

/** Was die Seite eines eigenen Blocks bearbeitet — genau das, was `updateDefinition` annimmt. */
export type DefinitionDraft = Required<BlockDefinitionPatch>;

/**
 * Was die Seite einer Vorlage bearbeitet — was `updateTemplate` annimmt, ohne
 * die Beschreibung: dafür hat die Seite kein Feld mehr, die Spalte bleibt für
 * Import und Export.
 */
export type TemplateDraft = Required<Omit<TemplatePatch, 'description'>>;

/**
 * Ein offener Entwurf: der Stand beim Öffnen (`base`) und die Bearbeitung
 * (`draft`). „Fertig" speichert nur, was sich gegenüber `base` geändert hat —
 * was andere Stellen inzwischen geschrieben haben (ein umbenannter Tag, ein
 * Stern, den eine andere Vorlage übernommen hat), bleibt so stehen.
 */
export interface DraftEntry<T> {
  base: T;
  draft: T;
}

export interface DraftState<T> {
  /** Ungespeicherte Entwürfe je id. */
  drafts: Readonly<Record<string, DraftEntry<T>>>;
  saveDraft: (id: string, entry: DraftEntry<T>) => void;
  /** Erledigt: mit „Fertig" gespeichert, abgebrochen oder gelöscht. */
  clearDraft: (id: string) => void;
  /**
   * Alle weg — beim Vault-Wechsel und beim Ersetzen aus einer Sicherung, wo
   * auch alle Tabs zugehen. Nach einer Wiederherstellung kommen dieselben ids
   * zurück; ein alter Entwurf schriebe sonst mit „Fertig" über das
   * Wiederhergestellte.
   */
  clearAll: () => void;
}

export type DraftStore<T> = UseBoundStore<StoreApi<DraftState<T>>>;

const stores: DraftStore<unknown>[] = [];

/**
 * Die ungespeicherten Entwürfe der Seiten, die erst mit „Fertig" speichern —
 * eigene Blöcke und Vorlagen, je ein Store. Im Store statt in der Ansicht,
 * weil MainArea die Ansicht beim Wechsel in ein anderes Modul unmountet — ein
 * offener Tab verlöre sonst lautlos seine Arbeit. Die Listen lesen daraus
 * ihren „Ungespeichert"-Hinweis. Bewusst nicht persistiert: wie ein Eintrag im
 * Bearbeitungsmodus überlebt ein Entwurf keinen Neustart.
 */
function createDraftStore<T>(): DraftStore<T> {
  const store = create<DraftState<T>>((set) => ({
    drafts: {},
    saveDraft: (id, entry) => set((s) => ({ drafts: { ...s.drafts, [id]: entry } })),
    clearDraft: (id) => set((s) => {
      if (!(id in s.drafts)) return s;
      const { [id]: _removed, ...rest } = s.drafts;
      return { drafts: rest };
    }),
    clearAll: () => set({ drafts: {} }),
  }));
  stores.push(store as DraftStore<unknown>);
  return store;
}

export const useBlockDraftStore = createDraftStore<DefinitionDraft>();

export const useTemplateDraftStore = createDraftStore<TemplateDraft>();

/** Alle Entwurfslisten leeren — siehe `clearAll`. */
export function clearAllDrafts(): void {
  for (const store of stores) store.getState().clearAll();
}
