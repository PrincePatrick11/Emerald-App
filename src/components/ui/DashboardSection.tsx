import type { ReactNode } from 'react';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import CollapsibleGroupHeader from './CollapsibleGroupHeader';

/** A second area below a dashboard's list: a heading that collapses it, remembered per `storageKey`. */
export default function DashboardSection({ storageKey, label, children }: {
  storageKey: string;
  label: string;
  children: ReactNode;
}) {
  const [collapsed, toggle] = usePersistedFlag(storageKey);
  return (
    <div className="mt-8">
      <CollapsibleGroupHeader label={label} collapsed={collapsed} onToggleCollapse={toggle} />
      {!collapsed && children}
    </div>
  );
}
