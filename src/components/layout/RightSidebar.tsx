import { useTranslation } from 'react-i18next';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import type { ComponentType } from 'react';
import { Pencil } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { findEntry, useEntryStore } from '../../store/entryStore';
import type { ActiveView } from '../../types';
import { isEntryView, LIBRARY_VIEW_IDS, moduleMeta, type ViewId } from '../../lib/modules';
import BlockSidebarArea, { BlockAddActions } from '../blocks/BlockSidebarArea';
import JournalPropertiesPanel from '../sidebar/panels/JournalPropertiesPanel';
import WikiPropertiesPanel from '../sidebar/panels/WikiPropertiesPanel';
import OperationPropertiesPanel from '../sidebar/panels/OperationPropertiesPanel';
import Button from '../ui/Button';
import SidebarColumn, { EditActionBar, SidebarActionBar } from '../ui/SidebarColumn';

// Eager, not lazy: the panels depend on stores that are loaded at startup
// anyway, and the sidebar is visible from the first frame.
// tasks deliberately has no panel (tasks are edited inline).
const PROPERTIES_PANELS: Partial<Record<ViewId, ComponentType>> = {
  journal: JournalPropertiesPanel,
  wiki: WikiPropertiesPanel,
  operations: OperationPropertiesPanel,
};

/**
 * Views without entries. They never get the entry action bar: a
 * deep link from the search (`{ type: 'tags' | 'categories', id }`) carries an
 * id, and would otherwise get the entry action bar with an
 * "Edit" button in it, which sets `mode: 'edit'` on a view without an editor.
 * The page of a custom block or a template (`{ type: 'blocks' |
 * 'templates', id }`) brings its own bar and portals it into
 * the same host as a dashboard.
 */
const VIEWS_WITHOUT_ENTRIES: ReadonlySet<ViewId> = new Set<ViewId>(['home', 'tags', 'categories', 'images', ...LIBRARY_VIEW_IDS]);


function PropertiesContent({ activeView }: { activeView: ActiveView }) {
  const { t } = useTranslation();
  const Panel = PROPERTIES_PANELS[activeView.type];
  if (!Panel) return <p className="text-xs text-subtle px-2 py-3">{t('properties.noEntry')}</p>;
  return <Panel />;
}

function RightSidebarActionBar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const editActions = useUIStore((s) => s.editActions);
  const editLocked = useUIStore((s) => s.editLocked);
  // The content of the open entry — for the lock of a loaded sigil.
  const entryView = isEntryView(activeView.type);
  const content = useEntryStore((s) => (entryView && activeView.id ? findEntry(s.entries, activeView.id)?.content : undefined));

  if (!activeView.id) return null;
  const isEditing = activeView.mode === 'edit';

  if (isEditing) {
    if (!editActions) return null;
    // The lock applies from the click that triggers it — not only once the
    // buttons are drawn as locked: that is why every handler asks the store.
    const unlessLocked = (run: () => void | Promise<void>) => () => {
      if (!useUIStore.getState().editLocked) void run();
    };
    return (
      <EditActionBar
        onDone={unlessLocked(editActions.onSave)}
        onDelete={editActions.onDelete && unlessLocked(editActions.onDelete)}
        onCancel={unlessLocked(editActions.onCancel)}
        locked={editLocked}
      />
    );
  }

  // A loaded sigil with the "whole entry" lock cannot be edited — the
  // charge decides, in every entry. The button stays
  // and says why it does nothing.
  const locked = content !== undefined && !!entryBlockSummary(activeView.id, content).sigil?.lockEntry;

  return (
    <SidebarActionBar>
      {/* The tooltip hangs on a wrapper: a locked tone button lets no
          mouse reach it (`disabled:pointer-events-none`). */}
      <span className="flex flex-1 min-w-0" title={locked ? t('editor.lockedBySigil') : undefined}>
        <Button
          tone="amber"
          fill
          disabled={locked}
          title={locked ? undefined : t('editor.edit')}
          aria-label={t('editor.edit')}
          onClick={() => setActiveView({ ...activeView, mode: 'edit' })}
        >
          <Pencil size={14} />
          <span className="truncate">{t('editor.edit')}</span>
        </Button>
      </span>
    </SidebarActionBar>
  );
}

export default function RightSidebar() {
  const activeView = useUIStore((s) => s.activeView);
  const setListHeaderHost = useUIStore((s) => s.setListHeaderHost);
  const dashboardMounted = useUIStore((s) => s.dashboardMounted);

  // If a dashboard is mounted, the bar belongs to its header —
  // action buttons, toolbar and filters are portaled here. Its registration
  // decides that, not `activeView.id`: tasks show their list even
  // with an id (jump target, no open entry), and the id of a
  // deleted entry likewise falls back to the dashboard.
  // Views without entries and list views without an id get the host even
  // before registration, so that it is ready while the chunk of a lazily
  // loaded view is still loading. A placeholder is no longer needed:
  // every view without entries has a dashboard (blocks have their page as well).
  if (dashboardMounted || VIEWS_WITHOUT_ENTRIES.has(activeView.type) || !activeView.id) {
    return <div ref={setListHeaderHost} className="flex flex-col h-full" />;
  }

  // Reading and editing show the same sections (`SidebarSection`) without a
  // line between them; the spacing comes from here.
  return (
    <SidebarColumn bar={<RightSidebarActionBar />} bodyClassName="flex flex-col gap-5">
      {moduleMeta(activeView.type)?.usesBlocks && <BlockAddActions />}
      <PropertiesContent activeView={activeView} />
      {moduleMeta(activeView.type)?.usesBlocks && <BlockSidebarArea />}
    </SidebarColumn>
  );
}
