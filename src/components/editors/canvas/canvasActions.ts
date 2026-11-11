import { elementBounds, unionBounds, type Box } from './geometry';
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

/** The selected, unlocked elements in units that move as one: a group together, every other element alone. */
function unitsOf(elements: readonly CanvasElement[], ids: readonly string[]): { members: CanvasElement[]; box: Box }[] {
  const picked = elements.filter((el) => ids.includes(el.id) && !el.locked);
  const units = new Map<string, CanvasElement[]>();
  for (const el of picked) {
    const key = el.group ? `group:${el.group}` : `element:${el.id}`;
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  return [...units.values()].map((members) => ({ members, box: unionBounds(members.map(elementBounds))! }));
}

/** The elements with every member of each unit shifted by that unit's (`dx`, `dy`). */
function shiftUnits(elements: readonly CanvasElement[], shifts: { members: CanvasElement[]; dx: number; dy: number }[]): CanvasElement[] {
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const { members, dx, dy } of shifts) for (const el of members) moved.set(el.id, { dx, dy });
  return elements.map((el) => {
    const d = moved.get(el.id);
    return d && (d.dx || d.dy) ? { ...el, x: el.x + d.dx, y: el.y + d.dy } : el;
  });
}

/**
 * Lines the selected elements up along an edge or centre: of their common box,
 * or of the artboard when only one is selected. A group moves as one, keeping
 * its members where they are to each other.
 */
export function align(
  elements: readonly CanvasElement[], ids: readonly string[], edge: AlignEdge, artboard: { width: number; height: number },
): CanvasElement[] {
  const units = unitsOf(elements, ids);
  if (!units.length) return [...elements];
  const target = units.length > 1
    ? unionBounds(units.map((u) => u.box))!
    : { x: 0, y: 0, width: artboard.width, height: artboard.height };
  return shiftUnits(elements, units.map(({ members, box: b }) => {
    switch (edge) {
      case 'left': return { members, dx: target.x - b.x, dy: 0 };
      case 'hcenter': return { members, dx: target.x + target.width / 2 - (b.x + b.width / 2), dy: 0 };
      case 'right': return { members, dx: target.x + target.width - (b.x + b.width), dy: 0 };
      case 'top': return { members, dx: 0, dy: target.y - b.y };
      case 'vcenter': return { members, dx: 0, dy: target.y + target.height / 2 - (b.y + b.height / 2) };
      case 'bottom': return { members, dx: 0, dy: target.y + target.height - (b.y + b.height) };
    }
  }));
}

/** Equal gaps between three or more selected elements (a group counting as one), across or down. */
export function distribute(elements: readonly CanvasElement[], ids: readonly string[], axis: 'horizontal' | 'vertical'): CanvasElement[] {
  const units = unitsOf(elements, ids);
  if (units.length < 3) return [...elements];
  const horizontal = axis === 'horizontal';
  const start = (b: Box) => (horizontal ? b.x : b.y);
  const size = (b: Box) => (horizontal ? b.width : b.height);
  const sorted = [...units].sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2));
  const first = start(sorted[0].box);
  const last = sorted[sorted.length - 1].box;
  const gap = (start(last) + size(last) - first - sorted.reduce((sum, u) => sum + size(u.box), 0)) / (sorted.length - 1);
  let cursor = first;
  return shiftUnits(elements, sorted.map(({ members, box }) => {
    const d = cursor - start(box);
    cursor += size(box) + gap;
    return horizontal ? { members, dx: d, dy: 0 } : { members, dx: 0, dy: d };
  }));
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
