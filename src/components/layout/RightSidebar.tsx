import { useTranslation } from 'react-i18next';
import { Pencil, Check, X, Trash2, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import type { ActiveView } from '../../types';
import JournalPropertiesPanel from '../sidebar/panels/JournalPropertiesPanel';
import WikiPropertiesPanel from '../sidebar/panels/WikiPropertiesPanel';
import OperationPropertiesPanel from '../sidebar/panels/OperationPropertiesPanel';
import AltarSidebarPanel from '../sidebar/panels/AltarSidebarPanel';
import SidebarActionButton from '../sidebar/fields/SidebarActionButton';

/* Mirrors the entry-list tab bar in LeftSidebarEntryList so both sidebars put their
   bottom border on the same line. Keep the two in sync — with one known
   exception: that bar is `min-h-14` and wraps into a second row once the entry
   list is dragged narrower than its six tabs, and the two borders then sit at
   different heights. Matching that here would mean growing this bar for a
   reason that has nothing to do with its own contents, so it stays 56px. */
const ACTION_BAR_CLASSES = 'flex items-center gap-0.5 px-3 h-14 border-b border-stone-700/60 flex-shrink-0';

function PropertiesContent({ activeView }: { activeView: ActiveView }) {
  const { t } = useTranslation();
  switch (activeView.type) {
    case 'journal':
      return <JournalPropertiesPanel />;
    case 'wiki':
      return <WikiPropertiesPanel />;
    case 'operations':
      return <OperationPropertiesPanel />;
    case 'altar':
      return <AltarSidebarPanel />;
    default:
      return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }
}

function RightSidebarActionBar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const editActions = useUIStore((s) => s.editActions);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const operations = useOperationStore((s) => s.operations);

  if (!activeView.id) return null;
  const isEditing = activeView.mode === 'edit';

  if (isEditing) {
    if (!editActions) return null;
    return (
      <div className={ACTION_BAR_CLASSES}>
        <SidebarActionButton
          icon={<Check size={14} />}
          label={t('editor.done')}
          tone="jade"
          onClick={editActions.onSave}
        />
        {editActions.onDelete && (
          <SidebarActionButton
            icon={<Trash2 size={14} />}
            label={t('editor.delete')}
            tone="danger"
            compact
            onClick={editActions.onDelete}
          />
        )}
        <SidebarActionButton
          icon={<X size={14} />}
          label={t('editor.cancel')}
          tone="neutral"
          compact
          onClick={editActions.onCancel}
        />
      </div>
    );
  }

  // A loaded sigil operation can't be edited (matches OperationSigilView's enterEditMode guard).
  const op = activeView.type === 'operations'
    ? operations.find((o) => o.id === activeView.id)
    : undefined;
  if (op?.category_id === 'sigils' && op.is_loaded) return null;

  const isAltar = activeView.type === 'altar';

  return (
    <div className={ACTION_BAR_CLASSES}>
      <SidebarActionButton
        icon={<Pencil size={14} />}
        label={t('editor.edit')}
        tone="amber"
        onClick={() => setActiveView({ ...activeView, mode: 'edit' })}
      />
      {isAltar && (
        <SidebarActionButton
          icon={altarWindowFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          label={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
          tone="jade"
          active={altarWindowFullscreen}
          compact
          onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
        />
      )}
    </div>
  );
}

export default function RightSidebar() {
  const activeView = useUIStore((s) => s.activeView);

  return (
    <div className="flex flex-col h-full">
      <RightSidebarActionBar />
      {/* The horizontal inset lives here and nowhere else. It matches the
          action bar's `px-3`, so the summary rows below line up with the
          Edit button above them; a panel adding its own `px-*` would break
          that alignment again. */}
      <div className="flex-1 overflow-y-auto p-3">
        <PropertiesContent activeView={activeView} />
      </div>
    </div>
  );
}
