import { create } from 'zustand';
import type { BlockAttrName, BlockInstance } from '../lib/blocks/types';
import type { Template } from '../lib/blocks/templates';
import type { TemplateApplyOptions } from './templateApply';

/**
 * Die Brücke zwischen dem `BlockStack` im Hauptbereich und der Block-Verwaltung
 * in der rechten Seitenleiste. Die beiden sind Geschwister-Bäume und kennen
 * einander nicht — derselbe Grund, aus dem `uiStore.editActions` existiert.
 *
 * Der Stapel veröffentlicht hier seine Blockstruktur (bei jeder
 * Strukturänderung, nicht pro Tastendruck) und die Handgriffe, mit denen die
 * Seitenleiste ihn bedient. Jede Änderung läuft damit durch den Stapel und
 * landet im Inhalt: Cancel dreht sie mit dem Text zurück.
 *
 * Nur im Speicher, nie persistiert — die Wahrheit ist der Inhalt des Eintrags.
 */
export interface BlockStackApi {
  /** Einen neuen Block aus einer Voreinstellung (`BLOCK_PRESETS`) an `index` einfügen. */
  insert: (index: number, presetId: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  /** Ein Instanz-Attribut aus `BLOCK_ATTR` setzen; `null` entfernt es. */
  setAttr: (id: string, name: BlockAttrName, value: string | null) => void;
  /** Den ganzen Block ersetzen — Seitenleisten-Abschnitte, deren Typ Fallback-HTML mitschreibt. */
  update: (id: string, next: BlockInstance) => void;
  /** Zum Block scrollen und ihn kurz hervorheben. */
  reveal: (id: string) => void;
  /** Die Blöcke mit dem lebenden HTML der Textblöcke — `blocks` der Sitzung hinkt beim Tippen hinterher. */
  liveBlocks: () => BlockInstance[];
  /** Eine Vorlage einsetzen — nur in einem Stapel mit Vorlagen (`BlockSession.templates`). */
  applyTemplate: (template: Template, options: TemplateApplyOptions) => void;
  /** Die Vorlagen-Auswahl des Stapels öffnen. */
  openTemplatePicker: () => void;
}

export interface BlockSession {
  /** Neu pro Montage des Stapels — die Seitenleiste setzt damit ihren eigenen Zustand zurück (Cancel montiert neu). */
  sessionId: string;
  /** Der Eintrag, dem der Stapel gehört — die Seitenleiste zeigt nur die passende Sitzung. */
  entryId: string;
  /** Struktur-Stand; `html` darin ist der Stand des letzten Strukturwechsels. */
  blocks: BlockInstance[];
  isEditing: boolean;
  /** Kann der Stapel Vorlagen einsetzen? Nur Einträge, nicht die Seite einer Vorlage. */
  templates: boolean;
  /** Nach dem Abbau des Stapels wirkungslos — ein veralteter Aufruf erreicht keinen fremden Eintrag. */
  api: BlockStackApi;
}

interface BlockSessionState {
  session: BlockSession | null;
  publish: (session: BlockSession) => void;
  /** Räumt nur, wenn die Sitzung noch diesem Stapel gehört — ein neuer darf schon übernommen haben. */
  clear: (api: BlockStackApi) => void;
}

export const useBlockSessionStore = create<BlockSessionState>((set, get) => ({
  session: null,
  publish: (session) => set({ session }),
  clear: (api) => {
    if (get().session?.api === api) set({ session: null });
  },
}));
