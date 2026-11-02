import { useTranslation } from 'react-i18next';
import { AUX_VIEWS } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import RailButton from '../ui/RailButton';

const BOTTOM_BAR_VIEWS = ['trash', 'categories', 'tags'] as const;

/**
 * The line under everything, as wide as the window, for what is needed less
 * often. Its buttons end where the right sidebar begins, on the main area's side;
 * `AppShell` sets that distance through `paddingRight`.
 */
export default function AppBottomBar({ paddingRight, className = '' }: { paddingRight: string; className?: string }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeViewType = useUIStore((s) => s.activeView.type);
  return (
    <div className={`app-bottom-bar sidebar-bottom-bar flex-shrink-0 flex items-center justify-end gap-1 h-7 ${className}`} style={{ paddingRight }}>
      {BOTTOM_BAR_VIEWS.map((type) => {
        const { icon: Icon, navLabelKey } = AUX_VIEWS[type];
        return (
          <RailButton key={type} active={activeViewType === type} onClick={() => setActiveView({ type })} title={t(navLabelKey)}>
            <Icon size={14} />
          </RailButton>
        );
      })}
    </div>
  );
}
