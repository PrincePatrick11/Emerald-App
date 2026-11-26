import type { BlockValue } from './blockType';

/**
 * Values a block delivers (`BlockValue`), read the same way wherever the app
 * shows or orders them — pure, so the checks run it under Node.
 */

/** The live title of a link target, `undefined` if it is gone (trash, deleted for good). */
export type LinkTitleOf = (link: { id: string; targetKind: string }) => string | undefined;

/**
 * What a link value shows: the target's current title, looked up by its ID as
 * link chips do — the name stored with the link only where the target is gone
 * (or no lookup is at hand).
 */
export function linkValueTitle(value: { id: string; targetKind: string; label: string }, titleOf?: LinkTitleOf): string {
  return titleOf?.(value) ?? value.label;
}

/** What a value is ordered by: a date by its day, a link by its current title, a text regardless of case. */
function sortKey(value: BlockValue, titleOf?: LinkTitleOf): string | number {
  switch (value.kind) {
    case 'date': return value.iso;
    case 'number': return value.value;
    case 'bool': return value.value ? 1 : 0;
    case 'text': return value.text.toLocaleLowerCase();
    case 'link': return linkValueTitle(value, titleOf).toLocaleLowerCase();
    case 'phrase': return value.key;
  }
}

/**
 * The order of two values under the same key, ascending — what a dashboard
 * sorts by (interface 9, the controls come with #117). A missing value goes
 * last; values of different kinds keep their order.
 */
export function compareBlockValues(a: BlockValue | null, b: BlockValue | null, titleOf?: LinkTitleOf): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.kind !== b.kind) return 0;
  const x = sortKey(a, titleOf);
  const y = sortKey(b, titleOf);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y));
}
