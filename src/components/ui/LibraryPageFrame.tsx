import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { EditActionBar, EditModeBar } from './SidebarColumn';
import { ENTRY_TITLE_HEADING_CLASSES, ENTRY_TITLE_INPUT_CLASSES, EntryHeaderRow, EntryStatus } from './EntryDetailFrame';
import { useUIStore } from '../../store/uiStore';

/**
 * The furnishings of a page that only saves with "Done": the status
 * ("Unsaved" or "Editing…") in the row above the title, Done/Delete/Cancel in the
 * sidebar and, when the sidebar is closed, Done and Cancel
 * in a narrow bar above the title. The three belong together and
 * presuppose `useDraftPage`; a page in its read view passes `read` instead.
 */
interface LibraryPageDraft {
  dirty: boolean;
  busy: boolean;
  onDone: () => void;
  onCancel: () => void;
  onDelete: () => void;
  /**
   * The status above the title: `unsaved` (blocks, templates — always
   * editing) shows "Unsaved" once something changed; `editing` (a language,
   * which also has a read view) shows "Editing…" throughout, like an entry.
   */
  status?: 'unsaved' | 'editing';
}

/** The read view of a page that also has one (a language): heading instead of the title field, "Edit" in the bar. */
interface LibraryPageRead {
  onEdit: () => void;
  /** Top right above the title, usually the date. */
  meta?: ReactNode;
}

interface Props {
  /** The way back to the list (asks about a draft with changes): the link in the row above the title. */
  backLabel: string;
  onBack: () => void;
  name: string;
  nameLabel: string;
  namePlaceholder: string;
  /** Only while editing; the read view shows the name as a heading. */
  onNameChange?: (name: string) => void;
  /** The draft mode, or `read` instead of it, see `LibraryPageDraft`. */
  draft?: LibraryPageDraft;
  /** The read view; the title is then a heading and the bar carries "Edit". */
  read?: LibraryPageRead;
  /** The body of the sidebar below the bar. */
  sidebar: ReactNode;
  /** The scrolling body of the page. */
  children: ReactNode;
}

/**
 * The frame of the library pages: a custom block, a template, a
 * language of the lexicon. Built like `EntryDetailFrame`: the name
 * as title (above it back link and "Unsaved"), below it the scrolling body,
 * and in the sidebar at the top the bar with the actions above
 * the properties body.
 *
 * Which actions are there is up to the page: draft pages pass in
 * `draft` and get Done/Delete/Cancel along with their status; a page with
 * a read view (a language) passes `read` there and gets "Edit", like an
 * entry. The frame itself (back link, title, scrolling, the portals) is
 * the same for both.
 */
export default function LibraryPageFrame({
  backLabel, onBack, name, nameLabel, namePlaceholder, onNameChange,
  draft, read, sidebar, children,
}: Props) {
  const { t } = useTranslation();
  const sidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const editLocked = useUIStore((s) => s.editLocked);

  return (
    <div className="h-full flex flex-col">
      <EntryHeaderRow
        back={{ label: backLabel, onClick: onBack }}
        meta={draft?.status === 'editing'
          ? <EntryStatus tone="accent">{t('editor.editing')}</EntryStatus>
          : draft?.dirty ? <EntryStatus tone="warning">{t('editor.unsaved')}</EntryStatus> : read?.meta}
      />

      {/* Only when the sidebar is closed: otherwise there would be no way to
          save or discard the draft. */}
      {draft && !sidebarOpen && (
        <div className="flex items-center px-6 pt-4 flex-shrink-0">
          <div className="ml-auto flex items-center gap-1.5">
            <Button tone="jade" small disabled={draft.busy || editLocked} onClick={draft.onDone}>
              <Check size={12} />
              <span>{t('editor.done')}</span>
            </Button>
            <Button tone="neutral" compact small disabled={editLocked} title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={draft.onCancel}>
              <X size={12} />
            </Button>
          </div>
        </div>
      )}

      <div className="px-8 pt-4 pb-4 flex-shrink-0">
        {read ? (
          <h1 className={ENTRY_TITLE_HEADING_CLASSES}>{name.trim() || namePlaceholder}</h1>
        ) : (
          <input
            className={ENTRY_TITLE_INPUT_CLASSES}
            value={name}
            placeholder={namePlaceholder}
            aria-label={nameLabel}
            onChange={(e) => onNameChange?.(e.target.value)}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>

      <SidebarPortal>
        <SidebarColumn
          bar={draft
            ? <EditActionBar onDone={draft.onDone} onDelete={draft.onDelete} onCancel={draft.onCancel} busy={draft.busy} locked={editLocked} />
            : read && <EditModeBar onEdit={read.onEdit} />}
        >
          {sidebar}
        </SidebarColumn>
      </SidebarPortal>
    </div>
  );
}
