import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Call `onUpdate` whenever the content of one of `editors` changes — at most
 * once per frame with `perFrame`, however fast the keystrokes come. Follows a
 * changed list of editors (a block added or removed) by their instance ids.
 */
export function useEditorsUpdate(editors: Editor[], onUpdate: () => void, { perFrame = false } = {}): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const editorsRef = useRef(editors);
  editorsRef.current = editors;
  const key = editors.map((ed) => ed.instanceId).join(',');

  useEffect(() => {
    let frame = 0;
    const handler = perFrame
      ? () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; onUpdateRef.current(); }); }
      : () => onUpdateRef.current();
    const list = editorsRef.current;
    list.forEach((ed) => ed.on('update', handler));
    return () => {
      cancelAnimationFrame(frame);
      list.forEach((ed) => ed.off('update', handler));
    };
  }, [key, perFrame]);
}
