import { parseBlocks } from './blockHtml';
import { mayHoldSigil, sigilState, sigilUnits, type SigilState } from './sigil';
import { localIsoDay } from '../helpers';

/**
 * What lists, sidebar and menu want to know about the blocks
 * of an entry without opening it — parsed from the `content` that the stores
 * keep in memory anyway, once per content state (and day).
 */
interface EntryBlockSummary {
  /** The entry's sigil — `null` without sigil blocks. */
  sigil: SigilState | null;
}

const EMPTY: EntryBlockSummary = { sigil: null };

const cache = new Map<string, { content: string; day: string; summary: EntryBlockSummary }>();

function summarize(content: string, today: string): EntryBlockSummary {
  // The vast majority of entries have no sigil blocks — then do not parse at all.
  if (!mayHoldSigil(content)) return EMPTY;
  const blocks = parseBlocks(content);

  if (sigilUnits(blocks).length === 0) return EMPTY;
  return { sigil: sigilState(blocks, today) };
}

/** The summary of an entry; the same content is not parsed twice on the same day. */
export function entryBlockSummary(id: string, content: string, today = localIsoDay()): EntryBlockSummary {
  const hit = cache.get(id);
  if (hit?.content === content && hit.day === today) return hit.summary;
  const summary = summarize(content, today);
  cache.set(id, { content, day: today, summary });
  return summary;
}

/** On vault switch and after an import: the earlier IDs do not come back. */
export function clearEntrySummaryCache(): void {
  cache.clear();
}
