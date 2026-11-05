import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FONT_FAMILIES, TEXT_LINE_HEIGHT } from './draw';
import type { BuilderTextElement } from './types';

/**
 * Typing into a text element: a text field laid exactly over it, in its font,
 * size, colour and rotation, while the element itself is hidden. Escape and a
 * click elsewhere end it and keep what was typed; ⌘/Ctrl+Enter too.
 * `onDone(null)` would mean: nothing to keep.
 */
export default function TextEditOverlay({ element, view, onDone }: {
  element: BuilderTextElement;
  view: { zoom: number; x: number; y: number };
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(element.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef(false);
  const finish = (value: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(value);
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
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish(text);
        }
      }}
      style={{
        left: view.x + element.x * z - width / 2,
        top: view.y + (element.y - element.height / 2) * z,
        width,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: `50% ${(element.height / 2) * z}px`,
        fontFamily: FONT_FAMILIES[element.font],
        fontSize: element.fontSize * z,
        fontWeight: element.bold ? 600 : 400,
        fontStyle: element.italic ? 'italic' : 'normal',
        lineHeight: TEXT_LINE_HEIGHT,
        color: element.color,
        textAlign: element.align,
        opacity: element.opacity,
      }}
    />
  );
}
