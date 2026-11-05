import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState } from 'react';
import { imageSrc, storedImageName } from '../../../lib/images';
import { getImageDrag, setImageDrag } from './imageDrag';
import { headOverImage, imageSelectionPlugin } from './imageSelection';

/** Applies to text as to images; the toolbar serves both with the same buttons. */
export type Alignment = 'left' | 'center' | 'right';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableImage: {
      /** Aligns the selected image left, centre or right. */
      setImageAlign: (align: Alignment) => ReturnType;
    };
  }
}

/**
 * Alignment of an image as a margin distribution; the image is a block node with
 * its own width, to which the paragraph's `text-align` does not apply.
 *
 * The two sides of the alignment deliberately store "left" differently:
 * text has no attribute for it at all (the TextAlign extension writes every
 * value it gets into the HTML, `left` included), whereas the image
 * carries `align: 'left'` as its default and writes it out. It needs the value
 * because otherwise its margins would stay as they were from the previous alignment.
 */
function alignMargins(align: unknown) {
  if (align === 'center') return { marginLeft: 'auto', marginRight: 'auto' };
  if (align === 'right') return { marginLeft: 'auto', marginRight: '0' };
  return { marginLeft: '0', marginRight: 'auto' };
}

/**
 * Counterpart to `alignMargins` for content that was saved before `data-align`:
 * there only the margin distribution reveals the alignment.
 */
function alignFromLegacyStyle(img: HTMLImageElement): Alignment {
  if (img.style.marginLeft !== 'auto') return 'left';
  return img.style.marginRight === 'auto' ? 'center' : 'right';
}

/** Past this much travel, a press on an image becomes a move. */
const DRAG_THRESHOLD_PX = 4;
/** Fractions of the editor's width a resize snaps to when it comes this close (in percentage points). */
const SNAP_WIDTHS = [25, 33, 50, 66, 75];
const SNAP_RANGE = 2;

/**
 * The width a resize stores: pixels, so the image keeps its size when the
 * window changes (`max-width` only shrinks it where the text gets narrower),
 * snapped to common fractions of the editor's current width. Dragged to the
 * full width it becomes `100%`, which is meant to follow the text.
 */
function resizedWidth(px: number, editorW: number): { width: string; label: string } {
  const percent = (px / editorW) * 100;
  if (percent >= 100 - SNAP_RANGE) return { width: '100%', label: '100 %' };
  const near = SNAP_WIDTHS.find((w) => Math.abs(w - percent) <= SNAP_RANGE);
  const snapped = Math.round(near !== undefined ? (editorW * near) / 100 : px);
  return { width: `${snapped}px`, label: near !== undefined ? `${near} % · ${snapped} px` : `${snapped} px` };
}

/**
 * Images resized before widths were stored in pixels carry a percentage of the
 * editor's width and so grow and shrink with the window. Converted once to the
 * pixels of the moment, outside the undo history; full width (`100%`) is meant
 * to follow and stays. Called when an editor starts editing. Without an
 * `update` event: merely opening an entry for editing must not count as a
 * change (autosave, the leave question); the new widths are written with the
 * first real change, and until then the stored content keeps its percentages.
 */
export function pinPercentImageWidths(editor: Editor): void {
  const editorW = editor.view.dom.getBoundingClientRect().width;
  if (!editorW) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return;
    const match = /^(\d+(?:\.\d+)?)%$/.exec(String(node.attrs.width ?? ''));
    if (!match || Number(match[1]) >= 100) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: `${Math.round((editorW * Number(match[1])) / 100)}px` });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
}

/**
 * Which side the resize handles sit on, and how far the width changes per
 * pixel of pointer travel. A left-aligned image grows to the right, a
 * right-aligned one to the left, a centred one on both sides at once,
 * which is why there the width changes twice as fast as the pointer.
 */
function resizeSides(align: unknown): { side: 'left' | 'right'; factor: number }[] {
  if (align === 'center') return [{ side: 'left', factor: -2 }, { side: 'right', factor: 2 }];
  if (align === 'right') return [{ side: 'left', factor: -1 }];
  return [{ side: 'right', factor: 1 }];
}

function ResizableImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  const [resizeLabel, setResizeLabel] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const editable = editor.isEditable;
  const resizing = resizeLabel !== null;
  const showHandle = editable && (selected || hovered || resizing);

  // The stored `src` is a filename; `emerald-img://` resolves it. No load step,
  // no cache — the webview handles both, and the URL is content-addressed so it
  // can be cached forever.
  const displaySrc = imageSrc(node.attrs.src as string);

  const startResize = (e: React.PointerEvent, factor: number) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = imgRef.current?.getBoundingClientRect().width ?? 300;
    // Measure against the editor container (full content width), not the image wrapper
    const editorW =
      imgRef.current?.closest('.ProseMirror')?.getBoundingClientRect().width ?? 600;

    const widthAt = (clientX: number) =>
      resizedWidth(Math.max(80, Math.min(editorW, startW + (clientX - startX) * factor)), editorW);
    setResizeLabel(widthAt(startX).label);

    const onMove = (ev: PointerEvent) => {
      const { width, label } = widthAt(ev.clientX);
      setResizeLabel(label);
      updateAttributes({ width });
    };
    // A cancelled pointer (touch panning, a native drag) ends it like a release.
    const onUp = () => {
      setResizeLabel(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  /**
   * A press on an image not yet selected: a click selects it; once the
   * pointer travels, it marks text, as a drag that starts in the text does —
   * from the image's edge to the pointer, the image included. The page
   * would start no selection from it, since the image is not editable.
   */
  const startSelecting = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const imagePos = () => (typeof getPos === 'function' ? getPos() : undefined);

    const onMove = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      started = true;
      const from = imagePos();
      const { view } = editor;
      const at = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
      if (from === undefined || !at) return;
      const { doc } = editor.state;
      const to = from + node.nodeSize;
      if (at.inside === from) return; // still over this image
      // The far side of the image is the anchor: the text position just
      // before it when marking downwards, just after it when marking upwards.
      const forward = at.pos >= to || (at.inside >= to);
      const anchor = forward
        ? Selection.findFrom(doc.resolve(from), -1, true)?.from ?? from
        : Selection.findFrom(doc.resolve(to), 1, true)?.from ?? to;
      // Over another image, that one is in at once (`headOverImage`).
      const head = headOverImage(view, ev.clientX, ev.clientY, anchor) ?? at.pos;
      view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, anchor, head)).scrollIntoView());
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (started) return;
      const pos = imagePos();
      if (pos !== undefined) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    };
    editor.view.focus();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  /**
   * A press on the image itself. Not yet selected, it selects or marks
   * (`startSelecting`); selected, a click keeps it so, and once the pointer
   * travels it becomes a move, which the host's drop listener finishes
   * (`useEditorPointerDrops`) — as dragging a selected picture moves it in a
   * word processor.
   */
  const onImagePointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return;
    if (!selected) { startSelecting(e); return; }
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (started || Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      started = true;
      setMoving(true);
      document.body.classList.add('editor-image-dragging');
      setImageDrag({ editor, getPos: () => (typeof getPos === 'function' ? getPos() : undefined) });
    };
    const end = (cancelled: boolean) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (!started) return;
      setMoving(false);
      document.body.classList.remove('editor-image-dragging');
      // Cancelled (touch panning, a native drag), nothing is moved. Released,
      // a host has finished the move by now; without one nobody would clear it.
      if (cancelled) setImageDrag(null);
      else window.setTimeout(() => { if (getImageDrag()?.editor === editor) setImageDrag(null); }, 0);
    };
    const onUp = () => end(false);
    const onCancel = () => end(true);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  };

  return (
    <NodeViewWrapper
      style={{
        display: 'block',
        width: node.attrs.width ?? '100%',
        maxWidth: '100%',
        ...alignMargins(node.attrs.align),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative my-3">
        <img
          ref={imgRef}
          src={displaySrc}
          alt={node.attrs.alt ?? ''}
          // Off the main thread and only once near the view: a photo straight
          // from a phone is decoded at full size, whatever it is shown at.
          loading="lazy"
          decoding="async"
          draggable={false}
          onPointerDown={onImagePointerDown}
          className={`block w-full rounded-lg object-contain${selected ? ' ring-2 ring-focus ring-offset-1 ring-offset-well-page' : ''}${editable && selected ? ' cursor-grab' : ''}${moving ? ' opacity-40' : ''}`}
          // While editing a touch drag moves the image instead of scrolling the page.
          style={{ maxHeight: 600, touchAction: editable ? 'none' : undefined }}
        />
        {showHandle && resizeSides(node.attrs.align).map(({ side, factor }) => (
          <div
            key={side}
            className={`editor-image-handle editor-image-handle--${side}`}
            onPointerDown={(e) => startResize(e, factor)}
          />
        ))}
        {resizeLabel && <div className="editor-image-size">{resizeLabel}</div>}
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  // Moved by the node view's own pointer drag: the WebView has no HTML5 drag.
  draggable: false,

  addProseMirrorPlugins() {
    return [imageSelectionPlugin()];
  },

  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: null },
      title: { default: null },
      width: { default: '300px' },
      align: { default: 'left' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const src = img.getAttribute('src');
          return {
            // What arrives here is not always a stored file name:
            // whoever copies an image from the read view and pastes it again
            // brings the resolved `emerald-img` URL along, vault ID included.
            // Reducing that back to the file name keeps the
            // vault affiliation out of the stored content.
            src:   storedImageName(src) ?? src,
            alt:   img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: img.style.width || img.getAttribute('width') || '100%',
            align: img.getAttribute('data-align') ?? alignFromLegacyStyle(img),
          };
        },
      },
    ];
  },

  addCommands() {
    return {
      setImageAlign:
        (align: Alignment) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { width, align, ...rest } = HTMLAttributes;
    const { marginLeft, marginRight } = alignMargins(align);
    return [
      'img',
      mergeAttributes(rest, {
        'data-align': align,
        style: `width:${width ?? '100%'};max-width:100%;display:block;margin-left:${marginLeft};margin-right:${marginRight}`,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
