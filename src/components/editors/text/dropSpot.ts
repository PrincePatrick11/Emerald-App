import type { Editor } from '@tiptap/react';

/**
 * Where a drop lands: the editor, the document position, and what the
 * indicator draws there. A `line` lies between two top-level blocks (an
 * image goes there), a `caret` stands between two characters (a link chip
 * goes there). Coordinates are viewport pixels, like `clientX`/`clientY`.
 */
export interface DropSpot {
  editor: Editor;
  pos: number;
  mark:
    | { kind: 'line'; left: number; top: number; width: number }
    | { kind: 'caret'; left: number; top: number; height: number };
}

/**
 * The editor under the point, or, if the point lies between the editors
 * (frame header, insertion line, gap), the vertically nearest one, with the
 * point pulled into it. `null` only if the point lies outside `container`
 * (or there is neither container nor an editor under the point).
 */
export function editorAtPoint(
  editors: Editor[], container: HTMLElement | null, x: number, y: number,
): { editor: Editor; x: number; y: number } | null {
  let nearest: { editor: Editor; rect: DOMRect; distance: number } | null = null;
  for (const editor of editors) {
    const rect = editor.view.dom.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { editor, x, y };
    const distance = y < rect.top ? rect.top - y : y - rect.bottom;
    if (!nearest || distance < nearest.distance) nearest = { editor, rect, distance };
  }
  const bounds = container?.getBoundingClientRect();
  if (!nearest || !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  // Pull into the editor so that `posAtCoords` finds a position, at
  // its top or bottom edge, depending on where the pointer came from.
  const { rect } = nearest;
  return {
    editor: nearest.editor,
    x: Math.min(Math.max(x, rect.left + 1), rect.right - 1),
    y: Math.min(Math.max(y, rect.top + 1), rect.bottom - 1),
  };
}

/** Between characters: for inline content such as a link chip. */
export function caretSpot(editor: Editor, x: number, y: number): DropSpot | null {
  const hit = editor.view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const coords = editor.view.coordsAtPos(hit.pos);
  return { editor, pos: hit.pos, mark: { kind: 'caret', left: coords.left, top: coords.top, height: coords.bottom - coords.top } };
}

/**
 * Between top-level blocks: before the first block whose middle lies below
 * the point, else at the end. Only top level, so an image never lands in the
 * middle of a list or a quote.
 */
export function lineSpot(editor: Editor, y: number): DropSpot {
  const { view, state } = editor;
  const rect = view.dom.getBoundingClientRect();
  let pos = state.doc.content.size;
  let top = rect.bottom;
  let previousBottom: number | null = null;
  let found = false;
  state.doc.forEach((_node, offset) => {
    if (found) return;
    const el = view.nodeDOM(offset);
    // A folded-away block has no box; it would pull the line to the top.
    if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) return;
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      pos = offset;
      // In the middle of the gap above the block.
      top = previousBottom === null ? r.top : (previousBottom + r.top) / 2;
      found = true;
      return;
    }
    previousBottom = r.bottom;
  });
  if (!found && previousBottom !== null) top = previousBottom;
  return { editor, pos, mark: { kind: 'line', left: rect.left, top, width: rect.width } };
}
