import { FaviconGlyph } from '../sidebar/fields/Favicon';
import { dashboardIcon } from '../../lib/modules';
import type { Dashboard } from '../../types';

/** The text and box classes of an own icon at each size the app draws a dashboard in. */
const OWN_ICON_CLASSES = {
  14: 'w-[14px] h-[14px] text-xs',
  16: 'w-4 h-4 text-sm',
  18: 'w-[18px] h-[18px] text-[16px]',
} as const;

/**
 * The glyph of a dashboard: its own icon (emoji or uploaded file), else the
 * built-in's or the default dashboard glyph (`dashboardIcon`). One renderer for
 * the rail, the plus's tiles, the sidebar setting, the import destination and
 * the category dialog.
 */
export default function DashboardGlyph({ dashboard, size }: {
  dashboard: Pick<Dashboard, 'icon' | 'builtin'>;
  size: keyof typeof OWN_ICON_CLASSES;
}) {
  if (dashboard.icon) return <FaviconGlyph value={dashboard.icon} className={OWN_ICON_CLASSES[size]} />;
  const Icon = dashboardIcon(dashboard);
  return <Icon size={size} />;
}
