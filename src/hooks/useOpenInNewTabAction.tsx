import { useTranslation } from 'react-i18next';
import { PanelTopOpen } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import type { ContextMenuAction } from '../components/ui/ContextMenu';
import type { ActiveView } from '../types';

/**
 * Der Kontextmenü-Eintrag „In neuem Tab öffnen" — dasselbe Label, dasselbe
 * Icon in jedem Menü, das einen Eintrag öffnen kann. Das Gegenstück zum
 * Mittelklick auf `DashboardItem` und die Zeilen der Seitenleiste.
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
