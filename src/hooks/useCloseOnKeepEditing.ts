import { useEffect, useRef } from 'react';
import { useLeaveGuardStore } from '../store/leaveGuardStore';

/**
 * Schließt ein Fenster, das über der Seite liegt (Einstellungen, Vaults),
 * sobald auf die Frage nach einer laufenden Bearbeitung „Weiter bearbeiten"
 * geantwortet wird (`leaveGuardStore`): wer so antwortet, will in den Eintrag
 * — nicht zurück in das Fenster, dessen Vorhaben er gerade fallen ließ.
 */
export function useCloseOnKeepEditing(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => useLeaveGuardStore.subscribe((s, prev) => {
    if (s.stays !== prev.stays) onCloseRef.current();
  }), []);
}
