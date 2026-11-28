import { FaviconGlyph } from '../sidebar/fields/Favicon';
import { dashboardIcon } from '../../lib/modules';
import { dashboardSymbol, isSymbolIconValue } from '../../lib/dashboardSymbols';
import type { Dashboard } from '../../types';

/** The text and box classes of an own icon at each size the app draws a dashboard in. */
const OWN_ICON_CLASSES = {
  14: 'w-[14px] h-[14px] text-xs',
  16: 'w-4 h-4 text-sm',
  18: 'w-[18px] h-[18px] text-[16px]',
} as const;

/**
 * The glyph of a dashboard: its own icon (line symbol, emoji or uploaded file),
 * else the built-in's or the default dashboard glyph (`dashboardIcon`) — also
 * for a symbol this version does not know. One renderer for the rail, the
 * tabs, the plus's tiles, the sidebar setting and the
 * category dialog. A line symbol is drawn at `size`, like a built-in's glyph.
 */
export default function DashboardGlyph({ dashboard, size }: {
  dashboard: Pick<Dashboard, 'icon' | 'builtin'>;
  size: keyof typeof OWN_ICON_CLASSES;
}) {
  const SymbolIcon = dashboardSymbol(dashboard.icon);
  if (SymbolIcon) return <SymbolIcon size={size} />;
  if (dashboard.icon && !isSymbolIconValue(dashboard.icon)) return <FaviconGlyph value={dashboard.icon} className={OWN_ICON_CLASSES[size]} />;
  const Icon = dashboardIcon(dashboard);
  return <Icon size={size} />;
}
