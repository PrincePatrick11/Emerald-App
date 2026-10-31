import { useEffect, useRef } from 'react';
import { useUIStore, type EditActions } from '../store/uiStore';
import { useLeaveGuardStore, withoutLeaveGuard } from '../store/leaveGuardStore';

/** What a view registers: its handlers, plus the guard for leaving with changes. */
export interface EditHandlers extends EditActions {
  /**
   * What the page is asked with before it is left with changes
   * (`leaveGuardStore`): "Save" calls `onSave`, "Discard" calls `onCancel`.
   */
  guard?: { key: string; title: () => string; isDirty: () => boolean };
}

/**
 * Registers Save/Cancel/Delete of the active view in the right sidebar,
 * as long as `active` is true — previously copied five times (journal/wiki/operations/
 * altar and the former sigil view).
 *
 * The handlers run through a ref: the sidebar therefore never calls a
 * stale closure, and the effect does not have to re-register on every
 * render.
 *
 * With `guard` the view also registers its guard: whoever leaves the page
 * with changes is asked (`leaveGuardStore`). The buttons themselves do not
 * ask — they are what ends the editing.
 */
export function useEditActions(active: boolean, handlers: EditHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const setEditActions = useUIStore((s) => s.setEditActions);

  const key = handlers.guard?.key;

  useEffect(() => {
    if (!active) return;
    // Without a guard there is nothing to bypass.
    const unguarded = <T,>(run: () => T | Promise<T>) => (key ? withoutLeaveGuard(key, run) : run());
    setEditActions({
      onSave: () => unguarded(() => handlersRef.current.onSave()),
      onCancel: () => unguarded(() => handlersRef.current.onCancel()),
      onDelete: handlersRef.current.onDelete ? () => unguarded(() => handlersRef.current.onDelete?.()) : undefined,
      flush: handlersRef.current.flush ? async () => { await handlersRef.current.flush?.(); } : undefined,
    });
    if (key) {
      useLeaveGuardStore.getState().setGuard({
        key,
        title: () => handlersRef.current.guard?.title() ?? '',
        isDirty: () => handlersRef.current.guard?.isDirty() ?? false,
        save: () => handlersRef.current.onSave(),
        discard: () => handlersRef.current.onCancel(),
      });
    }
    return () => {
      setEditActions(null);
      if (key) useLeaveGuardStore.getState().clearGuard(key);
    };
  }, [active, key, setEditActions]);
}
