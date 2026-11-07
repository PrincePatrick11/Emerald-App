import { elementBounds, unionBounds } from './geometry';
import { byZ, type CanvasElement } from './types';

/**
 * Changes to a list of elements that toolbar and keys share. Each returns a
 * new list (unchanged elements keep their object) and leaves locked elements
 * where they are.
 */

export type ArrangeMove = 'forward' | 'backward' | 'front' | 'back';

/** New stacking for the selected elements; every element gets its index as `z`. */
export function arrange(elements: readonly CanvasElement[], ids: readonly string[], move: ArrangeMove): CanvasElement[] {
  const selected = new Set(ids);
  const order = byZ(elements);
  if (move === 'front' || move === 'back') {
    const picked = order.filter((el) => selected.has(el.id));
    const rest = order.filter((el) => !selected.has(el.id));
    return withIndexZ(elements, move === 'front' ? [...rest, ...picked] : [...picked, ...rest]);
  }
  const list = [...order];
  if (move === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) {
      if (selected.has(list[i].id) && !selected.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (selected.has(list[i].id) && !selected.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  }
  return withIndexZ(elements, list);
}

function withIndexZ(elements: readonly CanvasElement[], order: readonly CanvasElement[]): CanvasElement[] {
  const z = new Map(order.map((el, i) => [el.id, i]));
  return elements.map((el) => (el.z === z.get(el.id) ? el : { ...el, z: z.get(el.id)! }));
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Lines the selected elements up along an edge or centre: of their common box,
 * or of the artboard when only one is selected.
 */
export function align(
  elements: readonly CanvasElement[], ids: readonly string[], edge: AlignEdge, artboard: { width: number; height: number },
): CanvasElement[] {
  const picked = elements.filter((el) => ids.includes(el.id) && !el.locked);
  const target = picked.length > 1
    ? unionBounds(picked.map(elementBounds))!
    : { x: 0, y: 0, width: artboard.width, height: artboard.height };
  return elements.map((el) => {
    if (!picked.includes(el)) return el;
    const b = elementBounds(el);
    switch (edge) {
      case 'left': return { ...el, x: el.x + target.x - b.x };
      case 'hcenter': return { ...el, x: target.x + target.width / 2 };
      case 'right': return { ...el, x: el.x + target.x + target.width - (b.x + b.width) };
      case 'top': return { ...el, y: el.y + target.y - b.y };
      case 'vcenter': return { ...el, y: target.y + target.height / 2 };
      case 'bottom': return { ...el, y: el.y + target.y + target.height - (b.y + b.height) };
    }
  });
}

/** Equal gaps between three or more selected elements, across or down. */
export function distribute(elements: readonly CanvasElement[], ids: readonly string[], axis: 'horizontal' | 'vertical'): CanvasElement[] {
  const picked = elements.filter((el) => ids.includes(el.id) && !el.locked);
  if (picked.length < 3) return [...elements];
  const horizontal = axis === 'horizontal';
  const sorted = [...picked].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const boxes = sorted.map(elementBounds);
  const size = (b: (typeof boxes)[number]) => (horizontal ? b.width : b.height);
  const start = horizontal ? boxes[0].x : boxes[0].y;
  const last = boxes[boxes.length - 1];
  const end = horizontal ? last.x + last.width : last.y + last.height;
  const gap = (end - start - boxes.reduce((sum, b) => sum + size(b), 0)) / (boxes.length - 1);
  const moved = new Map<string, number>();
  let cursor = start;
  sorted.forEach((el, i) => {
    moved.set(el.id, cursor + size(boxes[i]) / 2);
    cursor += size(boxes[i]) + gap;
  });
  return elements.map((el) => {
    const at = moved.get(el.id);
    if (at === undefined) return el;
    return horizontal ? { ...el, x: at } : { ...el, y: at };
  });
}

/**
 * Copies of `source`, shifted by `offset`, on top of everything, unlocked and
 * visible. Copied groups become new groups of their own.
 */
export function copiesOf(
  source: readonly CanvasElement[], elements: readonly CanvasElement[], offset: number, createId: () => string,
): CanvasElement[] {
  let z = elements.reduce((max, el) => Math.max(max, el.z), -1);
  const groups = new Map<string, string>();
  const groupOf = (group: string | undefined) => {
    if (!group) return undefined;
    if (!groups.has(group)) groups.set(group, createId());
    return groups.get(group);
  };
  return byZ(source).map((el) => ({
    ...el, id: createId(), x: el.x + offset, y: el.y + offset, z: ++z, locked: false, hidden: false, group: groupOf(el.group),
  }));
}

/** The ids with every other member of their groups added. */
export function withGroups(elements: readonly CanvasElement[], ids: readonly string[]): string[] {
  const groups = new Set(elements.filter((el) => el.group && ids.includes(el.id)).map((el) => el.group));
  if (!groups.size) return [...ids];
  const members = elements.filter((el) => el.group && groups.has(el.group) && !ids.includes(el.id)).map((el) => el.id);
  return [...ids, ...members];
}

/**
 * The selected elements as one group, stacked together where the topmost of
 * them was. Groups among them are taken in; locked elements stay out.
 */
export function group(elements: readonly CanvasElement[], ids: readonly string[], groupId: string): CanvasElement[] {
  const picked = new Set(withGroups(elements, ids).filter((id) => !elements.find((el) => el.id === id)?.locked));
  if (picked.size < 2) return [...elements];
  const order = byZ(elements);
  const top = order.reduce((last, el, i) => (picked.has(el.id) ? i : last), -1);
  const members = order.filter((el) => picked.has(el.id));
  const rest = order.filter((el) => !picked.has(el.id));
  const before = order.slice(0, top + 1).filter((el) => !picked.has(el.id)).length;
  const stacked = [...rest.slice(0, before), ...members, ...rest.slice(before)];
  return withIndexZ(elements, stacked).map((el) => (picked.has(el.id) ? { ...el, group: groupId } : el));
}

/** The groups of the selected elements dissolved. */
export function ungroup(elements: readonly CanvasElement[], ids: readonly string[]): CanvasElement[] {
  const groups = new Set(elements.filter((el) => el.group && ids.includes(el.id)).map((el) => el.group));
  return elements.map((el) => (el.group && groups.has(el.group) ? { ...el, group: undefined } : el));
}

/**
 * The given elements moved, together and in their order, so that the lowest
 * of them lands at `index` of the stacking (0 the bottom) among the others.
 */
export function moveInStack(elements: readonly CanvasElement[], ids: readonly string[], index: number): CanvasElement[] {
  const moving = new Set(ids);
  const order = byZ(elements);
  const picked = order.filter((el) => moving.has(el.id));
  const rest = order.filter((el) => !moving.has(el.id));
  const at = clamp(index, 0, rest.length);
  return withIndexZ(elements, [...rest.slice(0, at), ...picked, ...rest.slice(at)]);
}

/** The same elements moved by (`dx`, `dy`), with their centres kept on the artboard. */
export function nudge(
  elements: readonly CanvasElement[], ids: readonly string[], dx: number, dy: number, artboard: { width: number; height: number },
): CanvasElement[] {
  return elements.map((el) => (ids.includes(el.id) && !el.locked
    ? { ...el, x: clamp(el.x + dx, 0, artboard.width), y: clamp(el.y + dy, 0, artboard.height) }
    : el));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
