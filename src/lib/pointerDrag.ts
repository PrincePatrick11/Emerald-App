/** Past this much travel, a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

interface PointerDragHandlers {
  /** Travel before the drag starts; until then a release is a click. 0 starts at once. */
  threshold?: number;
  /** The pointer has travelled past `threshold`; called before the first `onMove`. */
  onStart?: (event: PointerEvent) => void;
  /** Every move once started. */
  onMove?: (event: PointerEvent) => void;
  /** Released (`cancelled` false) or cancelled by the system, e.g. touch panning or a native drag. */
  onEnd?: (result: { started: boolean; cancelled: boolean }) => void;
}

/**
 * Follows a press of the pointer on the document until it is released or
 * cancelled: moves, the threshold that turns a press into a drag, and the end.
 * A plain function, not a hook, so ProseMirror node views and canvases can
 * call it from their `pointerdown` alike.
 */
export function trackPointerDrag(
  start: { clientX: number; clientY: number },
  { threshold = 0, onStart, onMove, onEnd }: PointerDragHandlers,
): void {
  let started = false;
  const move = (event: PointerEvent) => {
    if (!started) {
      if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < threshold) return;
      started = true;
      onStart?.(event);
    }
    onMove?.(event);
  };
  const end = (cancelled: boolean) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    onEnd?.({ started, cancelled });
  };
  const up = () => end(false);
  const cancel = () => end(true);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
}
