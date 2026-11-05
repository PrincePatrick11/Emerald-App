import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ResolvedPos } from '@tiptap/pm/model';
import { AllSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Marking text across images. An image is not editable, so the page's own
 * drag selection does not move while the pointer is over one, and the image
 * would join the selection only once the pointer reached the text behind it.
 * Here the image under the pointer belongs to the selection at once, and the
 * images inside a selection are shown as marked.
 */

/** Whether a position lies in a table cell. */
export function inTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole as string | undefined;
    if (role === 'cell' || role === 'header_cell') return true;
  }
  return false;
}

/**
 * A selection end beside a block image: into the neighbouring text block when
 * there is one (`forward`: the one after, else the one before), so the
 * selection reads as text; between the blocks otherwise. Also between the
 * blocks when the other end is in a table cell: prosemirror-tables would
 * shrink a selection from a cell to the start of a text block to that cell.
 */
export function besideImage(doc: ProseMirrorNode, pos: number, forward: boolean, otherEnd: number): number {
  if (inTableCell(doc.resolve(otherEnd))) return pos;
  const $pos = doc.resolve(pos);
  if (forward && $pos.nodeAfter?.isTextblock) return pos + 1;
  if (!forward && $pos.nodeBefore?.isTextblock) return pos - 1;
  return pos;
}

/**
 * Where the selection ends when the pointer is over an image: past its far
 * side as seen from `anchor`, so the image is in (`besideImage`).
 * `null` when the pointer is not over an image.
 */
export function headOverImage(view: EditorView, x: number, y: number, anchor: number): number | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit || hit.inside < 0) return null;
  const { doc } = view.state;
  const node = doc.nodeAt(hit.inside);
  if (node?.type.name !== 'image') return null;
  const forward = anchor <= hit.inside;
  return besideImage(doc, forward ? hit.inside + node.nodeSize : hit.inside, forward, anchor);
}

/**
 * The images a text selection covers, and while there are any, its text too:
 * a selection that ends between two images is one the page cannot draw, so
 * then the editor draws all of it (`.editor-marking-images` hides the page's).
 */
const marked = new WeakMap<EditorState, DecorationSet>();

/** Once per state: decorations and the editor's class both ask. */
function markedImages(state: EditorState): DecorationSet {
  let set = marked.get(state);
  if (!set) marked.set(state, (set = findMarked(state)));
  return set;
}

function findMarked(state: EditorState): DecorationSet {
  const { selection, doc } = state;
  if (selection.empty || !(selection instanceof TextSelection || selection instanceof AllSelection)) return DecorationSet.empty;
  const images: Decoration[] = [];
  const text: Decoration[] = [];
  doc.nodesBetween(selection.from, selection.to, (node: ProseMirrorNode, pos: number) => {
    if (node.type.name === 'image') {
      if (pos >= selection.from && pos + node.nodeSize <= selection.to) {
        images.push(Decoration.node(pos, pos + node.nodeSize, { class: 'editor-image--marked' }));
      }
      return false;
    }
    if (node.isText) {
      const from = Math.max(pos, selection.from);
      const to = Math.min(pos + node.nodeSize, selection.to);
      if (from < to) text.push(Decoration.inline(from, to, { class: 'editor-text--marked' }));
    }
    return true;
  });
  return images.length ? DecorationSet.create(doc, [...images, ...text]) : DecorationSet.empty;
}

const imageSelectionKey = new PluginKey('imageSelection');

/**
 * While a drag that started in the text is under way, the pointer is followed:
 * over an image the selection's head goes past it, both when the page reports
 * its selection (`createSelectionBetween`) and when it reports nothing, since
 * the page's selection does not change over an image.
 */
export function imageSelectionPlugin(): Plugin {
  let dragging = false;
  let pointer: { x: number; y: number } | null = null;
  // Seen the button held during this drag: a later move without it means the
  // release was lost (a system menu, switching apps). Moves synthesised by the
  // dev bridge carry no buttons at all, so a drag only ends this way once it
  // has seen them.
  let pressed = false;

  return new Plugin({
    key: imageSelectionKey,
    props: {
      decorations: markedImages,
      attributes: (state): Record<string, string> =>
        (markedImages(state) === DecorationSet.empty ? {} : { class: 'editor-marking-images' }),
      createSelectionBetween(view, $anchor) {
        if (!dragging || !pointer || !(view.state.selection instanceof TextSelection)) return null;
        const head = headOverImage(view, pointer.x, pointer.y, $anchor.pos);
        return head === null ? null : TextSelection.create(view.state.doc, $anchor.pos, head);
      },
      handleDOMEvents: {
        mousedown(_view, event) {
          // A press on an image is the image's own (selecting, moving).
          const onImage = (event.target as Element | null)?.closest?.('img') != null;
          dragging = event.button === 0 && !event.shiftKey && !onImage;
          pointer = null;
          pressed = false;
          return false;
        },
      },
    },
    view(view) {
      let frame = 0;
      const onMove = (e: MouseEvent) => {
        // Ended by the release, which the page delivers here even outside
        // the window once a drag began in it, or by a release that was lost.
        if (!dragging) return;
        if (e.buttons & 1) pressed = true;
        else if (pressed) { dragging = false; pointer = null; return; }
        pointer = { x: e.clientX, y: e.clientY };
        // After the page has handled the move, so its own reading comes first.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (!pointer || !view.editable) return;
          const { selection } = view.state;
          if (!(selection instanceof TextSelection)) return;
          const head = headOverImage(view, pointer.x, pointer.y, selection.anchor);
          if (head === null || head === selection.head) return;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.anchor, head)));
        });
      };
      const onUp = () => { dragging = false; pointer = null; };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
      return {
        destroy() {
          cancelAnimationFrame(frame);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          window.removeEventListener('blur', onUp);
        },
      };
    },
  });
}
