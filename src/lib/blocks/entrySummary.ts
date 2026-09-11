import { parseBlocks } from './blockHtml';
import { isBlockHidden } from './blockAttrs';
import { blockOrigin } from './definitions';
import { activeElements, isElementEmpty, isSigilKind, isSlotKind, parseFields, type FieldValue } from './fields';
import { mayHoldSigil, SIGIL_CANVAS_TYPE, sigilImage, sigilState, sigilUnits, todayIso, type SigilState } from './sigil';
import { BLOCK_ATTR } from './types';

/**
 * Was Listen, Seitenleiste, Menü und die Blöcke-Ansicht über die Blöcke eines
 * Eintrags wissen wollen, ohne ihn zu öffnen — aus dem `content`, den die
 * Stores ohnehin im Speicher halten, einmal pro Inhaltsstand (und Tag) geparst.
 */
export interface EntryBlockSummary {
  /** Jede Kopie eines eigenen Blocks: Definition und Revision. */
  origins: { id: string; rev: number }[];
  /**
   * Skalare Feldwerte der Kopien unter `"<Definition>:<Element>"` — die
   * Grundlage für das spätere Filtern und Anzeigen von Blockwerten in Listen.
   * Element-IDs sind in allen Kopien einer Definition gleich, also findet ein
   * Filter jede Kopie, egal welcher Version.
   */
  fieldValues: Record<string, FieldValue>;
  /** Sigille des Eintrags samt Dateiname der ersten sichtbaren, nicht verborgenen Zeichnung (Karten) — `null` ohne Sigillen-Blöcke. */
  sigil: (SigilState & { image: string | null }) | null;
}

const EMPTY: EntryBlockSummary = { origins: [], fieldValues: {}, sigil: null };

const cache = new Map<string, { content: string; day: string; summary: EntryBlockSummary }>();

function summarize(content: string, today: string): EntryBlockSummary {
  const hasOrigins = content.includes(BLOCK_ATTR.origin);
  const hasSigil = mayHoldSigil(content);
  // Die allermeisten Einträge haben weder eigene noch Sigillen-Blöcke — dann gar nicht parsen.
  if (!hasOrigins && !hasSigil) return EMPTY;
  const blocks = parseBlocks(content);

  const origins: EntryBlockSummary['origins'] = [];
  const fieldValues: Record<string, FieldValue> = Object.create(null);
  if (hasOrigins) {
    for (const block of blocks) {
      const origin = blockOrigin(block);
      if (!origin) continue;
      origins.push(origin);
      const model = parseFields(block);
      if (model.broken) continue;
      for (const element of activeElements(model)) {
        if (isSlotKind(element.kind) || isSigilKind(element.kind) || isElementEmpty(element, model)) continue;
        const key = `${origin.id}:${element.id}`;
        if (!(key in fieldValues)) fieldValues[key] = model.values[element.id];
      }
    }
  }

  let sigil: EntryBlockSummary['sigil'] = null;
  if (hasSigil) {
    const units = sigilUnits(blocks);
    if (units.length > 0) {
      const state = sigilState(blocks, today);
      // Die erste sichtbare Zeichnung, Block oder Teil — ein Teil gilt als sichtbar, wenn sein Block es ist.
      const canvas = units.find(({ block, part }) =>
        block.type === SIGIL_CANVAS_TYPE && !isBlockHidden(part?.parent ?? block) && !part?.element.archived
          && !state.concealed.has(block.id) && sigilImage(block));
      sigil = { ...state, image: canvas ? sigilImage(canvas.block) : null };
    }
  }
  return { origins, fieldValues, sigil };
}

/** Die Zusammenfassung eines Eintrags; derselbe Inhalt wird am selben Tag nicht zweimal geparst. */
export function entryBlockSummary(id: string, content: string, today = todayIso()): EntryBlockSummary {
  const hit = cache.get(id);
  if (hit?.content === content && hit.day === today) return hit.summary;
  const summary = summarize(content, today);
  cache.set(id, { content, day: today, summary });
  return summary;
}

/** Beim Vault-Wechsel und nach einem Import: die IDs von vorher kommen nicht wieder. */
export function clearEntrySummaryCache(): void {
  cache.clear();
}
