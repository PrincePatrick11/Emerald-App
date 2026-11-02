import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { AUX_VIEWS, MODULES, type ViewId } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import RailButton from '../ui/RailButton';

/** Width of the rail: the 32px buttons with 6px of air each, tight, so the list
 *  moves close to the icons (`.app-sidebar-left-with-rail` in index.css).
 *  `AppShell` uses it to work out the width of the <aside> and the default width
 *  of the right sidebar, the title bar the width of the logo — that is why
 *  it is a number here instead of a class below: two truths would yield
 *  a clipped rail *and* wrong widths next to it. */
export const RAIL_WIDTH = 44;

/** Buttons of one group sit tight; the gap between groups is three times that. */
const RAIL_GROUP = 'w-full flex flex-col items-center gap-1';

export default function LeftSidebarRail() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeViewType = useUIStore((s) => s.activeView.type);

  // One button per view; it is highlighted as long as its view is open —
  // also with an entry open inside it.
  const viewButton = (type: ViewId, meta: { icon: LucideIcon; navLabelKey: string }) => (
    <RailButton
      key={type}
      active={activeViewType === type}
      onClick={() => setActiveView({ type })}
      title={t(meta.navLabelKey)}
    >
      <meta.icon size={18} />
    </RailButton>
  );

  return (
    <div
      // No divider to the list: both are part of the frame.
      className="left-sidebar-rail flex flex-col items-center h-full flex-shrink-0"
      style={{ width: RAIL_WIDTH }}
    >
      {/* The two sidebars are toggled by the "View" menu (useTitleBarMenus,
          native on macOS) — buttons of their own up here were a second place
          for the same thing. */}

      {/* Main nav icons — navigate only, never touch the entry-list panel.
          Groups are set apart by space alone: lines would be more dividers in a
          frame that has none. What is needed less often sits in
          `LeftSidebarFooter`. */}
      <div className="w-full flex flex-col items-center gap-3 pb-2">
        {/* The way to the dashboard. It used to hang on the Emerald logo in the
            title bar, which nobody reads as a navigation target.
            Mind the MCP selectors: lucide exports `Home` as an alias of
            `House`, so the SVG carries `.lucide-house`, not `.lucide-home`. */}
        {viewButton('home', AUX_VIEWS.home)}
        <div className={RAIL_GROUP}>
          {viewButton('journal', MODULES.journal)}
          {viewButton('tasks', MODULES.tasks)}
          {viewButton('operations', MODULES.operations)}
        </div>
        {/* The lexicon is not an entry module, but sits here between wiki and altar. */}
        <div className={RAIL_GROUP}>
          {viewButton('wiki', MODULES.wiki)}
          {viewButton('lexicon', AUX_VIEWS.lexicon)}
          {viewButton('altar', MODULES.altar)}
        </div>
        <div className={RAIL_GROUP}>
          {viewButton('templates', AUX_VIEWS.templates)}
          {viewButton('blocks', AUX_VIEWS.blocks)}
        </div>
      </div>
    </div>
  );
}
