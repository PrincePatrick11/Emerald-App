import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Module-level cache: file path → data URL. Each image is read from disk only once per session.
const imageDisplayCache = new Map<string, string>();
// In-flight deduplication: file path → shared Promise. Prevents duplicate invoke() calls when
// multiple NodeViews mount for the same path before the first invoke resolves.
const imageInflight = new Map<string, Promise<string>>();

function loadImage(path: string): Promise<string> {
  const cached = imageDisplayCache.get(path);
  if (cached) return Promise.resolve(cached);

  const inflight = imageInflight.get(path);
  if (inflight) return inflight;

  const promise = invoke<string>('read_image_as_base64', { path })
    .then((dataUrl) => {
      imageDisplayCache.set(path, dataUrl);
      imageInflight.delete(path);
      return dataUrl;
    })
    .catch((e) => {
      imageInflight.delete(path);
      console.error('Failed to load image:', path, e);
      return '';
    });

  imageInflight.set(path, promise);
  return promise;
}

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const editable = editor.isEditable;
  const showHandle = editable && (selected || hovered || resizing);

  const rawSrc = node.attrs.src as string;
  const [displaySrc, setDisplaySrc] = useState<string>(() => {
    // Sync init for already-cached or inline sources
    if (!rawSrc) return '';
    if (rawSrc.startsWith('data:') || rawSrc.startsWith('http')) return rawSrc;
    return imageDisplayCache.get(rawSrc) ?? '';
  });

  useEffect(() => {
    if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('http')) return;
    // Check cache first — may have been populated since the useState initializer ran
    const cached = imageDisplayCache.get(rawSrc);
    if (cached) { setDisplaySrc(cached); return; }
    let cancelled = false;
    loadImage(rawSrc).then((dataUrl) => {
      if (!cancelled && dataUrl) setDisplaySrc(dataUrl);
    });
    return () => { cancelled = true; };
  }, [rawSrc]);

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
          return {
            src:   img.getAttribute('src'),
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
