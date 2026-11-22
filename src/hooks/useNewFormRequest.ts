import { useEffect, useRef } from 'react';
import { takeNewForm } from '../lib/createItem';
import { useUIStore } from '../store/uiStore';

/**
 * Runs `openNew` — the view's own "New" — when the rail's plus opened this
 * view to create something in it (`takeNewForm`). Also when the view was
 * already open: the plus navigates to a fresh `ActiveView` either way.
 */
export function useNewFormRequest(openNew: () => void): void {
  const activeView = useUIStore((s) => s.activeView);
  const openNewRef = useRef(openNew);
  openNewRef.current = openNew;
  useEffect(() => {
    if (takeNewForm(activeView)) openNewRef.current();
  }, [activeView]);
}
