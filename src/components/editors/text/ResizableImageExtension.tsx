import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState } from 'react';
import { imageSrc, storedImageName } from '../../../lib/images';

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

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const editable = editor.isEditable;
  const showHandle = editable && (selected || hovered || resizing);

  // The stored `src` is a filename; `emerald-img://` resolves it. No load step,
  // no cache — the webview handles both, and the URL is content-addressed so it
  // can be cached forever.
  const displaySrc = imageSrc(node.attrs.src as string);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = imgRef.current?.getBoundingClientRect().width ?? 300;
    // Measure against the editor container (full content width), not the image wrapper
    const editorW =
      imgRef.current?.closest('.ProseMirror')?.getBoundingClientRect().width ?? 600;

    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const newW = Math.max(80, Math.min(editorW, startW + (ev.clientX - startX)));
      updateAttributes({ width: `${Math.round((newW / editorW) * 100)}%` });
    };
    const onUp = () => {
      setResizing(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <NodeViewWrapper
      style={{
        display: 'block',
        width: node.attrs.width ?? '100%',
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
          draggable={false}
          className={`block w-full rounded-lg object-contain${selected ? ' ring-2 ring-focus ring-offset-1 ring-offset-well-page' : ''}`}
          style={{ maxHeight: 600 }}
        />
        {showHandle && (
          <div
            className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 rounded-sm cursor-se-resize"
            style={{
              touchAction: 'none',
              background: 'rgba(210,210,210,0.85)',
              border: '1px solid rgba(255,255,255,0.5)',
            }}
            onPointerDown={onPointerDown}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

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
        style: `width:${width ?? '100%'};display:block;margin-left:${marginLeft};margin-right:${marginRight}`,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
