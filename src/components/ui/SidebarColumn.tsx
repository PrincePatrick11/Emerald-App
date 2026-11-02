import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, X } from 'lucide-react';

/**
 * The 56px bar at the top of the right sidebar. It draws a line below it: it
 * sits on the sheet, unlike the tighter search row of the entry list on the
 * frame. The line sits on the inner element and therefore only reaches from
 * button edge to button edge, like the dividers in the body below
 * (`.sidebar-divider`).
 */
export function SidebarActionBar({ children }: { children?: ReactNode }) {
  return (
    <div className="px-3 flex-shrink-0 min-w-0">
      <div className="sidebar-divider flex items-center gap-1.5 h-14 border-b min-w-0">
        {children}
      </div>
    </div>
  );
}

/**
 * Done, Delete, Cancel: the bar of every editing mode, for an
 * entry (RightSidebar) and the library pages. "Done" is the one
 * filled primary action, Delete and Cancel are 30px squares beside it
 * (`.edit-bar-*`). Without `onDelete` the Delete button is absent; `busy` disables
 * Done while saving is in progress, `locked` all three while something
 * is writing that is about to replace the page (`uiStore.editLocked`).
 *
 * Own classes instead of `Button`: its tone levels are tinted buttons with
 * 11px type for row actions; the editing bar has exactly one
 * filled primary action with 13px type. The height is the same (`--control-h`).
 */
export function EditActionBar({ onDone, onDelete, onCancel, busy, locked }: {
  onDone: () => void;
  onDelete?: () => void;
  onCancel: () => void;
  busy?: boolean;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SidebarActionBar>
      <button type="button" className="edit-bar-done" disabled={busy || locked} title={t('editor.done')} onClick={onDone}>
        <Check size={14} />
        <span className="truncate">{t('editor.done')}</span>
      </button>
      {onDelete && (
        <button type="button" className="edit-bar-icon edit-bar-icon--danger" disabled={locked} title={t('editor.delete')} aria-label={t('editor.delete')} onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      )}
      <button type="button" className="edit-bar-icon" disabled={locked} title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={onCancel}>
        <X size={14} />
      </button>
    </SidebarActionBar>
  );
}

/**
 * A column of the right sidebar: the bar at the top (`bar`, usually a
 * `SidebarActionBar`), the scrolling body below. The horizontal indentation
 * lives here and nowhere else (design.md: one indentation source per column);
 * `p-3` matches the bar's `px-3`, so that the rows below line up with its
 * buttons. A panel with its own `px-*` would break that again.
 *
 * Users: RightSidebar (an entry's properties), the header of every
 * `Dashboard` and a custom block's page.
 */
export default function SidebarColumn({ bar, children, bodyClassName = '' }: {
  bar?: ReactNode;
  children: ReactNode;
  /** Appended; for the spacing between the groups (dashboard: `space-y-4`). */
  bodyClassName?: string;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {bar}
      <div className={`flex-1 overflow-y-auto p-3 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

/**
 * A labelled section in the sidebar body: `label-xs`
 * heading, content below. The dashboard sidebar stacks them
 * (view, sorting, display, filter); the spacing
 * between heading and content lives only here.
 */
export function SidebarGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {label && <span className="label-xs">{label}</span>}
      {children}
    </div>
  );
}
