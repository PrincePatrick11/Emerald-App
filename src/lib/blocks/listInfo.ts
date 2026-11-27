import type { LucideIcon } from 'lucide-react';
import type { BlockContext, BlockValue, BlockValueLabel } from './blockType';
import type { BlockInstance } from './types';

/**
 * What a block adds to the info line of its entry in lists (dashboard rows
 * and cards, under a tag, the left list) — after date and category. The
 * block decides; the lists only show what comes back. Pure data, in two
 * forms the lists choose between (`InfoForm`): the short one shows a part
 * as its icon and short value ("📅 Dec 12" — a part without an icon by its
 * value alone), the long one as "Label: value" ("Target date: Dec 12, 2026"). The left list always shows
 * the short form, a dashboard the one its settings say.
 */
export type InfoForm = 'short' | 'long';

/** The label (`labelKey` or the user's own `label`) is that of the long form. */
export type ListInfoPart = BlockValueLabel & {
  /** One part per key and entry: of several, the one with the lowest `rank` (then the first) is shown. */
  key: string;
  rank: number;
  /** Shown before the value in the short form; without one the short form is the value alone. */
  icon?: LucideIcon;
  /** `null`: the block holds the key but has nothing to show (and keeps a lower-ranked part out). */
  value: BlockValue | null;
  /** The forms the part appears in; both if missing. */
  forms?: readonly InfoForm[];
};

/** A part the lists show: `pickListInfo` has left out those without a value. */
export type ShownListInfoPart = ListInfoPart & { value: BlockValue };

/** What a block type registers (`BlockTypeDef.listInfo`). */
export interface ListInfoProvider {
  /** The cheap pre-check on the raw content: can it hold anything for this type? Lists stay fast because most entries fail it. */
  mayContribute: (content: string) => boolean;
  /** Asked about a hidden block (the eye) too — otherwise a hidden block adds nothing. */
  evenWhenHidden?: boolean;
  parts: (block: BlockInstance, ctx: BlockContext) => ListInfoPart[];
}

/**
 * Of the parts in stack order, those of one form: per key the lowest rank,
 * the first among equals; keys in order of appearance.
 */
export function pickListInfo(parts: readonly ListInfoPart[], form: InfoForm): ShownListInfoPart[] {
  const best = new Map<string, ListInfoPart>();
  for (const part of parts) {
    if (part.forms && !part.forms.includes(form)) continue;
    const held = best.get(part.key);
    if (!held || part.rank < held.rank) best.set(part.key, part);
  }
  return [...best.values()].filter((part): part is ShownListInfoPart => part.value !== null);
}
