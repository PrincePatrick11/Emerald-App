import { parseBlocks } from './blockHtml';
import { isBlockHidden } from './blockAttrs';
import { LIST_INFO_PROVIDERS, resolveBlockType } from './blockTypes';
import { pickListInfo, type ShownListInfoPart } from './listInfo';
import { mayHoldSigil, sigilState, sigilUnits, type SigilState } from './sigil';
import type { BlockInstance } from './types';
import { localIsoDay } from '../helpers';

/**
 * What lists, sidebar and menu want to know about the blocks
 * of an entry without opening it — parsed from the `content` that the stores
 * keep in memory anyway, once per content state (and day).
 */
interface EntryBlockSummary {
  /** The entry's sigil — `null` without sigil blocks. For locking, not for display. */
  sigil: SigilState | null;
  /** What the blocks add to the info line in lists (`ListInfoProvider`), in stack order. */
  listInfo: readonly ShownListInfoPart[];
}

const EMPTY: EntryBlockSummary = { sigil: null, listInfo: [] };

const cache = new Map<string, { content: string; day: string; summary: EntryBlockSummary }>();

function mayHoldListInfo(content: string): boolean {
  return LIST_INFO_PROVIDERS.some((provider) => provider.mayContribute(content));
}

function collectListInfo(blocks: readonly BlockInstance[], today: string): ShownListInfoPart[] {
  return pickListInfo(blocks.flatMap((block) => {
    const provider = resolveBlockType(block)?.listInfo;
    if (!provider || (isBlockHidden(block) && !provider.evenWhenHidden)) return [];
    return provider.parts(block, today);
  }));
}

function summarize(content: string, today: string): EntryBlockSummary {
  // The vast majority of entries have neither — then do not parse at all.
  const sigilPossible = mayHoldSigil(content);
  const infoPossible = mayHoldListInfo(content);
  if (!sigilPossible && !infoPossible) return EMPTY;
  const blocks = parseBlocks(content);

  return {
    sigil: sigilPossible && sigilUnits(blocks).length > 0 ? sigilState(blocks, today) : null,
    listInfo: infoPossible ? collectListInfo(blocks, today) : [],
  };
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
