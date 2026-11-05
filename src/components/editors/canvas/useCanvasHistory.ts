import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasElement } from './types';

const LIMIT = 100;
/** Outside changes this close together are one step: a slider in a side panel. */
const MERGE_MS = 600;
/** How long an undo waits for the place to hand back what it applied. */
const SETTLE_MS = 400;

function same(a: readonly CanvasElement[], b: readonly CanvasElement[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const key = (list: readonly CanvasElement[]) => JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)));
  return key(a) === key(b);
}

export interface CanvasHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Call before the canvas editor's own `onChange`: that change is one step of its own. */
  markLocal: () => void;
}

/**
 * Undo and redo for a canvas editor whose elements live with the place that embeds
 * it. The history follows the `elements` it is handed, whoever changed them:
 * the canvas editor's own gestures are one step each, changes from outside (a side
 * panel) too, except that a burst of them counts once. Undo hands an earlier
 * list to `apply`; what comes back from the place replaces it, so clamping
 * there does not count as a new step.
 *
 * `resetKey`: when it changes, the history starts over at the current list.
 */
export function useCanvasHistory(
  elements: readonly CanvasElement[],
  apply: (elements: CanvasElement[]) => void,
  resetKey: string,
): CanvasHistory {
  const state = useRef({
    past: [] as CanvasElement[][],
    present: elements as CanvasElement[],
    future: [] as CanvasElement[][],
    local: false,
    applying: 0,
    lastOutside: 0,
  });
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const keyRef = useRef(resetKey);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    Object.assign(state.current, { past: [], future: [], present: elements, local: false, applying: 0, lastOutside: 0 });
  }

  useEffect(() => {
    const s = state.current;
    if (same(s.present, elements)) {
      s.local = false;
      return;
    }
    const now = performance.now();
    if (s.applying && now - s.applying < SETTLE_MS) {
      s.present = elements as CanvasElement[];
      s.applying = 0;
      return;
    }
    s.applying = 0;
    if (s.local) {
      s.past.push(s.present);
      s.local = false;
    } else {
      if (now - s.lastOutside > MERGE_MS) s.past.push(s.present);
      s.lastOutside = now;
    }
    if (s.past.length > LIMIT) s.past.shift();
    s.present = elements as CanvasElement[];
    s.future = [];
    bump();
  }, [elements]);

  const undo = useCallback(() => {
    const s = state.current;
    const previous = s.past.pop();
    if (!previous) return;
    s.future.push(s.present);
    s.present = previous;
    s.applying = performance.now();
    s.lastOutside = 0;
    applyRef.current(previous);
    bump();
  }, []);

  const redo = useCallback(() => {
    const s = state.current;
    const next = s.future.pop();
    if (!next) return;
    s.past.push(s.present);
    s.present = next;
    s.applying = performance.now();
    s.lastOutside = 0;
    applyRef.current(next);
    bump();
  }, []);

  const markLocal = useCallback(() => { state.current.local = true; }, []);

  return {
    undo,
    redo,
    canUndo: state.current.past.length > 0,
    canRedo: state.current.future.length > 0,
    markLocal,
  };
}
