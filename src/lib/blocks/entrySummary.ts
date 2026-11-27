import { parseBlocks } from './blockHtml';
import { isBlockHidden } from './blockAttrs';
import type { BlockContext, BlockFieldValue, BlockValue } from './blockType';
import { entryEffects, mayAffectEntry, mayShowOutside, NO_EFFECTS, resolveBlockType, type EntryEffects } from './blockTypes';
import { blockSuggestions, NO_SUGGESTIONS, type BlockSuggestions } from './entryProperties';
import { pickListInfo, type InfoForm, type ListInfoPart, type ShownListInfoPart } from './listInfo';
import { blockContext } from './toolkit';
import type { BlockInstance } from './types';
import { localIsoDay } from '../helpers';

/**
 * What lists, tabs, link chips, the sidebar and menus want to know about the
 * blocks of an entry without opening it — everything the blocks show
 * outside themselves, read through their interfaces: the info line in both
 * forms (1), the suggested icon and cover and the panel rows (3), the
 * values to filter and sort by (4/9), what they do to the entry (6). Parsed from the `content` that the
 * stores keep in memory anyway, once per content state (and day).
 */
interface EntryBlockSummary {
  /** What the blocks do to the entry — locked, concealed (interface 6). For locking, not for display. */
  effects: EntryEffects;
  /** What the blocks add to the info line in lists, per form, in stack order. */
  info: Readonly<Record<InfoForm, readonly ShownListInfoPart[]>>;
  /** What the visible blocks suggest for the properties, and their rows. */
  properties: BlockSuggestions;
  /** The values to filter and sort by, in stack order — of hidden blocks too. */
  values: readonly (BlockFieldValue & { blockId: string })[];
}

const NO_INFO: EntryBlockSummary['info'] = { short: [], long: [] };
const EMPTY: EntryBlockSummary = { effects: NO_EFFECTS, info: NO_INFO, properties: NO_SUGGESTIONS, values: [] };

/** What the summary needs of an entry. */
type SummaryEntry = { id: string; content: string; created_at: string };

const cache = new Map<string, { content: string; created: string; day: string; summary: EntryBlockSummary }>();

function collectInfo(blocks: readonly BlockInstance[], ctx: BlockContext): EntryBlockSummary['info'] {
  const parts: ListInfoPart[] = blocks.flatMap((block) => {
    const provider = resolveBlockType(block)?.listInfo;
    if (!provider || (isBlockHidden(block) && !provider.evenWhenHidden)) return [];
    return provider.parts(block, ctx);
  });
  if (parts.length === 0) return NO_INFO;
  return { short: pickListInfo(parts, 'short'), long: pickListInfo(parts, 'long') };
}

function summarize(entry: SummaryEntry, today: string): EntryBlockSummary {
  // The vast majority of entries have nothing to show outside — then do not parse at all.
  const effectPossible = mayAffectEntry(entry.content);
  const outsidePossible = mayShowOutside(entry.content);
  if (!effectPossible && !outsidePossible) return EMPTY;
  const blocks = parseBlocks(entry.content);
  const ctx = blockContext(entry, today);

  return {
    effects: effectPossible ? entryEffects(blocks, ctx) : NO_EFFECTS,
    info: outsidePossible ? collectInfo(blocks, ctx) : NO_INFO,
    properties: outsidePossible ? blockSuggestions(blocks, ctx) : NO_SUGGESTIONS,
    values: outsidePossible
      ? blocks.flatMap((block) => (resolveBlockType(block)?.values?.read(block, ctx) ?? []).map((v) => ({ ...v, blockId: block.id })))
      : [],
  };
}

/**
 * The summary of an entry; the same content is not parsed twice on the same
 * day. The creation date is part of the key: what a block shows may follow
 * the entry's day (the moon phase).
 */
export function entryBlockSummary(entry: SummaryEntry, today = localIsoDay()): EntryBlockSummary {
  const hit = cache.get(entry.id);
  if (hit?.content === entry.content && hit.created === entry.created_at && hit.day === today) return hit.summary;
  const summary = summarize(entry, today);
  cache.set(entry.id, { content: entry.content, created: entry.created_at, day: today, summary });
  return summary;
}

/**
 * The values an entry's blocks offer to filter and sort by (interfaces 4
 * and 9) — for the dashboard's filter and sort controls (#117), later a
 * calendar.
 */
export function entryBlockValues(entry: SummaryEntry): EntryBlockSummary['values'] {
  return entryBlockSummary(entry).values;
}

/**
 * The entry's value under a key (e.g. `sigil.targetDate`) by the info
 * line's rule: the lowest rank, the first among equals — `null` if that one
 * holds none (a loaded charge without a date) or no block gives the key.
 */
export function entryBlockValue(entry: SummaryEntry, key: string): BlockValue | null {
  let best: BlockFieldValue | null = null;
  for (const v of entryBlockValues(entry)) {
    if (v.key === key && (!best || (v.rank ?? 0) < (best.rank ?? 0))) best = v;
  }
  return best?.value ?? null;
}

/** On vault switch and after an import: the earlier IDs do not come back. */
export function clearEntrySummaryCache(): void {
  cache.clear();
}
