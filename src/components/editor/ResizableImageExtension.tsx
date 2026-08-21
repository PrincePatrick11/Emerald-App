import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState } from 'react';
import { imageSrc, storedImageName } from '../../lib/images';

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
      style={{ display: 'block', width: node.attrs.width ?? '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative my-3">
        <img
          ref={imgRef}
          src={displaySrc}
          alt={node.attrs.alt ?? ''}
          draggable={false}
          className={`block w-full rounded-lg object-contain${selected ? ' ring-2 ring-jade-500 ring-offset-1 ring-offset-stone-900' : ''}`}
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
            // Was hier ankommt, ist nicht immer ein gespeicherter Dateiname:
            // wer ein Bild aus der Leseansicht kopiert und wieder einfuegt,
            // bringt die aufgeloeste `emerald-img`-URL mit — samt Vault-ID.
            // Die zurueck auf den Dateinamen zu reduzieren haelt die
            // Vault-Zugehoerigkeit aus dem gespeicherten Inhalt heraus.
            src:   storedImageName(src) ?? src,
            alt:   img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: img.style.width || img.getAttribute('width') || '100%',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width, ...rest } = HTMLAttributes;
    return ['img', mergeAttributes(rest, { style: `width:${width ?? '100%'}` })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
