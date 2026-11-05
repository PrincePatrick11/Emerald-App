import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Marking text across images. An image is not editable, so the page's own
 * drag selection does not move while the pointer is over one, and the image
 * would join the selection only once the pointer reached the text behind it.
 * Here the image under the pointer belongs to the selection at once, and the
 * images inside a selection are shown as marked.
 */

/**
 * Where the selection ends when the pointer is over an image: past its far
 * side as seen from `anchor`, so the image is in. Into the text block that
 * follows (or precedes) it when there is one, else between the blocks.
 * `null` when the pointer is not over an image.
 */
export function headOverImage(view: EditorView, x: number, y: number, anchor: number): number | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit || hit.inside < 0) return null;
  const { doc } = view.state;
  const node = doc.nodeAt(hit.inside);
  if (node?.type.name !== 'image') return null;
  const forward = anchor <= hit.inside;
  const head = forward ? hit.inside + node.nodeSize : hit.inside;
  const $head = doc.resolve(head);
  if (forward && $head.nodeAfter?.isTextblock) return head + 1;
  if (!forward && $head.nodeBefore?.isTextblock) return head - 1;
  return head;
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
  if (selection.empty || !(selection instanceof TextSelection)) return DecorationSet.empty;
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

  return new Plugin({
    key: imageSelectionKey,
    props: {
      decorations: markedImages,
      attributes: (state): Record<string, string> =>
        (markedImages(state) === DecorationSet.empty ? {} : { class: 'editor-marking-images' }),
      createSelectionBetween(view, $anchor) {
        if (!dragging || !pointer) return null;
        const head = headOverImage(view, pointer.x, pointer.y, $anchor.pos);
        return head === null ? null : TextSelection.create(view.state.doc, $anchor.pos, head);
      },
      handleDOMEvents: {
        mousedown(_view, event) {
          dragging = event.button === 0 && !event.shiftKey;
          pointer = null;
          return false;
        },
      },
    },
    view(view) {
      let frame = 0;
      const onMove = (e: MouseEvent) => {
        // Ended by the release, which the page delivers here even outside
        // the window once a drag began in it.
        if (!dragging) return;
        pointer = { x: e.clientX, y: e.clientY };
        // After the page has handled the move, so its own reading comes first.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (!pointer || !view.editable) return;
          const { selection } = view.state;
          const head = headOverImage(view, pointer.x, pointer.y, selection.anchor);
          if (head === null || head === selection.head) return;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.anchor, head)));
        });
      };
      const onUp = () => { dragging = false; pointer = null; };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return {
        destroy() {
          cancelAnimationFrame(frame);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        },
      };
    },
  });
}
