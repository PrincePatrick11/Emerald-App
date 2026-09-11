import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../store/uiStore';

/**
 * Rendert in das Portal-Ziel der rechten Seitenleiste (`uiStore.listHeaderHost`).
 * Ist die Leiste zu, rendert es nichts — bewusst, wie beim Kopf der Dashboards:
 * wer die Leiste schließt, will die ganze Breite für den Inhalt.
 *
 * Leser sind `Dashboard` (sein Kopf) und die Seite eines eigenen Blocks
 * (Speichern, Anzeige, Verwendung). MainArea rendert immer nur eine View, also
 * portalt nie mehr als einer von beiden.
 */
export default function SidebarPortal({ children }: { children: ReactNode }) {
  const host = useUIStore((s) => s.listHeaderHost);
  return host ? createPortal(children, host) : null;
}
