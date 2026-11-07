import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DragChannel } from '../../../lib/dragChannel';
import type { DropSpot } from './dropSpot';

/**
 * Where a running drag would land: a line between blocks or a caret between
 * characters. It listens to the spot itself, so a pointer move re-renders
 * only this, not the host.
 */
export default function DropIndicator({ spots }: { spots: DragChannel<DropSpot> }) {
  const [spot, setSpot] = useState<DropSpot | null>(null);
  useEffect(() => spots.subscribe(setSpot), [spots]);
  if (!spot) return null;
  const { mark } = spot;
  const style = mark.kind === 'line'
    ? { left: mark.left, top: mark.top - 1, width: mark.width }
    : { left: mark.left - 1, top: mark.top, height: mark.height };
  return createPortal(
    <div className={mark.kind === 'line' ? 'editor-drop-line' : 'editor-drop-caret'} style={style} />,
    document.body,
  );
}
