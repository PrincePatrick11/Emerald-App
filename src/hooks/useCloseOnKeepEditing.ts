import { useEffect, useRef } from 'react';
import { useLeaveGuardStore } from '../store/leaveGuardStore';

/**
 * Closes a window that sits above the page (settings, vaults) as soon as the
 * question about an ongoing edit is answered with "Keep editing"
 * (`leaveGuardStore`): whoever answers that way wants to go to the entry
 * — not back to the window whose plan they just dropped.
 */
export function useCloseOnKeepEditing(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => useLeaveGuardStore.subscribe((s, prev) => {
    if (s.stays !== prev.stays) onCloseRef.current();
  }), []);
}
