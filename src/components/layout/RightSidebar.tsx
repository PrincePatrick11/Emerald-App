import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Library, Link2, Wand2, SlidersHorizontal, Repeat2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import { ALTAR_CATEGORY_EMOJI, ALTAR_CATEGORIES, CATEGORY_EMOJIS } from '../../lib/altarConstants';
import OpPropertiesPanel from '../sidebar/OpPropertiesPanel';
import RoutinesPanel from '../sidebar/RoutinesPanel';
import WikiPanel from '../sidebar/WikiPanel';
import BacklinksPanel from '../sidebar/BacklinksPanel';
import OperationsPanel from '../sidebar/OperationsPanel';
import AltarSidebarPanel from '../sidebar/AltarSidebarPanel';

export { ALTAR_CATEGORY_EMOJI, ALTAR_CATEGORIES, CATEGORY_EMOJIS };

export default function RightSidebar() {
  const { t } = useTranslation();
  const { toggleRightSidebar, rightSidebarTab, setRightSidebarTab, activeView, wikiSubTab } =
    useUIStore();
  const articles = useWikiStore((s) => s.articles);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarTabs: Array<{
    id: 'op-properties' | 'backlinks' | 'wiki' | 'operations' | 'routines';
    icon: ReactNode;
    label: string;
  }> = [
    { id: 'op-properties', icon: <SlidersHorizontal size={14} />, label: t('operations.properties') },
    { id: 'routines', icon: <Repeat2 size={14} />, label: t('routines.title') },
    { id: 'wiki', icon: <Library size={14} />, label: t('nav.wiki') },
    { id: 'operations', icon: <Wand2 size={14} />, label: t('nav.operations') },
    { id: 'backlinks', icon: <Link2 size={14} />, label: t('backlinks.title') },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header — icon-only tabs + close button */}
      <div className="flex items-center justify-between px-3 h-14 border-b border-stone-700/60">
        <div className="flex items-center gap-0.5">
          {sidebarTabs.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setRightSidebarTab(id)}
              title={label}
                className={`p-2 rounded-md transition-colors ${
                  rightSidebarTab === id
                    ? 'right-sidebar-tab-active bg-stone-700 text-stone-200'
                    : 'right-sidebar-tab-idle text-stone-500 hover:text-stone-300'
                }`}
              >
              {icon}
            </button>
          ))}
        </div>
        <button onClick={toggleRightSidebar} className="btn-ghost">
          <X size={15} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Tab title */}
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 px-2 pb-3">
          {rightSidebarTab === 'op-properties' && t('operations.properties')}
          {rightSidebarTab === 'backlinks' && t('backlinks.title')}
          {rightSidebarTab === 'wiki' && t('nav.wiki')}
          {rightSidebarTab === 'operations' && t('nav.operations')}
          {rightSidebarTab === 'routines' && t('routines.title')}
        </p>
        {rightSidebarTab === 'op-properties' && (
          activeView.type === 'altar' ? <AltarSidebarPanel /> : <OpPropertiesPanel />
        )}
        {rightSidebarTab === 'routines' && (
          <RoutinesPanel />
        )}
        {rightSidebarTab === 'wiki' && (
          <WikiPanel articles={articles} onNavigate={setActiveView} wikiSubTab={wikiSubTab} />
        )}
        {rightSidebarTab === 'backlinks' && (
          <BacklinksPanel currentId={activeView.id} />
        )}
        {rightSidebarTab === 'operations' && (
          <OperationsPanel onNavigate={setActiveView} />
        )}
      </div>
    </div>
  );
}
