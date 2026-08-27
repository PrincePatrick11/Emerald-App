import { useEffect, useRef } from 'react';
import { useUIStore, type EditActions } from '../store/uiStore';

/**
 * Registriert Save/Cancel/Delete der aktiven View in der rechten Seitenleiste,
 * solange `active` wahr ist — vorher fünfmal kopiert (Journal/Wiki/Operations/
 * Altar/Sigil).
 *
 * Die Handler laufen über einen Ref: die Sidebar ruft dadurch nie eine
 * veraltete Closure, und der Effekt muss nicht bei jedem Render
 * re-registrieren.
 */
export function useEditActions(active: boolean, handlers: EditActions): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const setEditActions = useUIStore((s) => s.setEditActions);

  useEffect(() => {
    if (!active) return;
    setEditActions({
      onSave: () => handlersRef.current.onSave(),
      onCancel: () => handlersRef.current.onCancel(),
      onDelete: handlersRef.current.onDelete ? () => handlersRef.current.onDelete?.() : undefined,
    });
    return () => setEditActions(null);
  }, [active, setEditActions]);
}
