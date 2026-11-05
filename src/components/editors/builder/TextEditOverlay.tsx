import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BuilderElement } from './types';

/**
 * Typing into an element whose type edits text in place: a text field laid
 * exactly over it, in the type's look (`textEdit.style`), scaled with the view
 * and turned with the element, while the element itself is hidden. Escape,
 * ⌘/Ctrl+Enter and a click elsewhere end it and keep what was typed.
 */
export default function TextEditOverlay({ element, initial, style, view, onDone }: {
  element: BuilderElement;
  initial: string;
  /** The look at zoom 1; a numeric `fontSize` is scaled with the view. */
  style: CSSProperties;
  view: { zoom: number; x: number; y: number };
  onDone: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(text);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // The field grows with its lines, like the element does.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, view.zoom]);

  const z = view.zoom;
  const width = element.width * z;
  return (
    <textarea
      ref={ref}
      className="builder-text-input"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
        }
      }}
      style={{
        ...style,
        fontSize: typeof style.fontSize === 'number' ? style.fontSize * z : style.fontSize,
        left: view.x + element.x * z - width / 2,
        top: view.y + (element.y - element.height / 2) * z,
        width,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: `50% ${(element.height / 2) * z}px`,
        opacity: element.opacity,
      }}
    />
  );
}
