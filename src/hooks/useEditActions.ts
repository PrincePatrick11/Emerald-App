import { useEffect, useRef } from 'react';
import { useUIStore, type EditActions } from '../store/uiStore';
import { useLeaveGuardStore, withoutLeaveGuard } from '../store/leaveGuardStore';

/** Was eine View anmeldet: ihre Handgriffe, dazu der Wächter für das Verlassen mit Änderungen. */
export interface EditHandlers extends EditActions {
  /**
   * Womit die Seite gefragt wird, bevor man sie mit Änderungen verlässt
   * (`leaveGuardStore`): „Speichern" ruft `onSave`, „Verwerfen" `onCancel`.
   */
  guard?: { key: string; title: () => string; isDirty: () => boolean };
}

/**
 * Registriert Save/Cancel/Delete der aktiven View in der rechten Seitenleiste,
 * solange `active` wahr ist — vorher fünfmal kopiert (Journal/Wiki/Operations/
 * Altar und die frühere Sigillen-Ansicht).
 *
 * Die Handler laufen über einen Ref: die Sidebar ruft dadurch nie eine
 * veraltete Closure, und der Effekt muss nicht bei jedem Render
 * re-registrieren.
 *
 * Mit `guard` meldet die View zugleich ihren Wächter an: wer die Seite mit
 * Änderungen verlässt, wird gefragt (`leaveGuardStore`). Die Knöpfe selbst
 * fragen nicht — sie beenden die Bearbeitung ja gerade.
 */
export function useEditActions(active: boolean, handlers: EditHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const setEditActions = useUIStore((s) => s.setEditActions);

  const key = handlers.guard?.key;

  useEffect(() => {
    if (!active) return;
    // Ohne Wächter (Altar) gibt es nichts zu umgehen.
    const ending = <T,>(run: () => T | Promise<T>) => (key ? withoutLeaveGuard(key, run) : run());
    setEditActions({
      onSave: () => ending(() => handlersRef.current.onSave()),
      onCancel: () => ending(() => handlersRef.current.onCancel()),
      onDelete: handlersRef.current.onDelete ? () => ending(() => handlersRef.current.onDelete?.()) : undefined,
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
