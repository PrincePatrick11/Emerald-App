import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../store/uiStore';

/**
 * Renders into the portal target of the right sidebar (`uiStore.listHeaderHost`).
 * If the sidebar is closed it renders nothing, deliberately, as with the dashboards' header:
 * whoever closes the sidebar wants the full width for the content.
 *
 * Readers are `Dashboard` (its header) and a custom block's page
 * (save, display, usage). MainArea renders only one view at a time, so
 * never more than one of the two portals.
 */
export default function SidebarPortal({ children }: { children: ReactNode }) {
  const host = useUIStore((s) => s.listHeaderHost);
  return host ? createPortal(children, host) : null;
}
