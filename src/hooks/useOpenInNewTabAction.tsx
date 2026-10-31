import { useTranslation } from 'react-i18next';
import { PanelTopOpen } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import type { ContextMenuAction } from '../components/ui/ContextMenu';
import type { ActiveView } from '../types';

/**
 * The context menu item "Open in new tab" — the same label, the same
 * icon in every menu that can open an entry. The counterpart to the
 * middle click on `DashboardItem` and the sidebar rows.
 */
export function useOpenInNewTabAction(): (view: ActiveView) => ContextMenuAction {
  const { t } = useTranslation();
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);
  return (view) => ({
    label: t('contextMenu.openInNewTab'),
    icon: <PanelTopOpen size={12} />,
    onClick: () => openViewInNewTab(view),
  });
}
