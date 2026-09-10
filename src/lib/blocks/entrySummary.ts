import { parseBlocks } from './blockHtml';
import { blockOrigin } from './definitions';
import { activeElements, isElementEmpty, isSlotKind, parseFields, type FieldValue } from './fields';
import { BLOCK_ATTR } from './types';

/**
 * Was Listen und die Blöcke-Ansicht über die Blöcke eines Eintrags wissen
 * wollen, ohne ihn zu öffnen — aus dem `content`, den die Stores ohnehin im
 * Speicher halten, einmal pro Inhaltsstand geparst.
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
}

const EMPTY: EntryBlockSummary = { origins: [], fieldValues: {} };

const cache = new Map<string, { content: string; summary: EntryBlockSummary }>();

function summarize(content: string): EntryBlockSummary {
  // Die allermeisten Einträge haben keinen eigenen Block — dann gar nicht parsen.
  if (!content.includes(BLOCK_ATTR.origin)) return EMPTY;
  const origins: EntryBlockSummary['origins'] = [];
  const fieldValues: Record<string, FieldValue> = Object.create(null);
  for (const block of parseBlocks(content)) {
    const origin = blockOrigin(block);
    if (!origin) continue;
    origins.push(origin);
    const model = parseFields(block);
    if (model.broken) continue;
    for (const element of activeElements(model)) {
      if (isSlotKind(element.kind) || isElementEmpty(element, model)) continue;
      const key = `${origin.id}:${element.id}`;
      if (!(key in fieldValues)) fieldValues[key] = model.values[element.id];
    }
  }
  return { origins, fieldValues };
}

/** Die Zusammenfassung eines Eintrags; derselbe Inhalt wird nicht zweimal geparst. */
export function entryBlockSummary(id: string, content: string): EntryBlockSummary {
  const hit = cache.get(id);
  if (hit?.content === content) return hit.summary;
  const summary = summarize(content);
  cache.set(id, { content, summary });
  return summary;
}

/** Beim Vault-Wechsel und nach einem Import: die IDs von vorher kommen nicht wieder. */
export function clearEntrySummaryCache(): void {
  cache.clear();
}
