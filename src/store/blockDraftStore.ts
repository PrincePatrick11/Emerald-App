import { create } from 'zustand';
import type { BlockDefinitionPatch } from './blockDefinitionStore';

/** Was die Seite eines eigenen Blocks bearbeitet — genau das, was `updateDefinition` annimmt. */
export type DefinitionDraft = Required<BlockDefinitionPatch>;

interface BlockDraftState {
  /** Ungespeicherte Entwürfe je Definitions-id. */
  drafts: Readonly<Record<string, DefinitionDraft>>;
  /** `null` räumt den Entwurf weg (gespeichert, verworfen, gelöscht). */
  setDraft: (id: string, draft: DefinitionDraft | null) => void;
}

/**
 * Die ungespeicherten Entwürfe der Block-Seiten. Im Store statt in der
 * Blöcke-Ansicht, weil MainArea die Ansicht beim Wechsel in ein anderes Modul
 * unmountet — ein offener Block-Tab verlöre sonst lautlos seine Arbeit. Die
 * Liste liest daraus ihren „Ungespeichert"-Hinweis. Bewusst nicht persistiert:
 * wie ein Eintrag im Bearbeitungsmodus überlebt ein Entwurf keinen Neustart.
 */
export const useBlockDraftStore = create<BlockDraftState>((set) => ({
  drafts: {},
  setDraft: (id, draft) => set((s) => {
    if (draft) return { drafts: { ...s.drafts, [id]: draft } };
    if (!(id in s.drafts)) return s;
    const { [id]: _removed, ...rest } = s.drafts;
    return { drafts: rest };
  }),
}));
