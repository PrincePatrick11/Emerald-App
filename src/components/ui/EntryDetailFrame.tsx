import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { displayTitle } from '../../lib/entryTitle';
import { dashboardLabel } from '../../lib/dashboards';
import type { Dashboard } from '../../types';
import TagInput from './TagInput';

/** The page title as a heading: entries and dashboards
 *  (`Dashboard`) are deliberately the same size. One class chain. */
export const ENTRY_TITLE_HEADING_CLASSES = 'entry-view-title text-2xl font-semibold text-primary';

/** The title line as an input: entries when editing and the libraries' pages (`LibraryPageFrame`). */
export const ENTRY_TITLE_INPUT_CLASSES =
  `${ENTRY_TITLE_HEADING_CLASSES} w-full bg-transparent placeholder:text-subtle outline-none selectable`;

/**
 * The narrow row above the title: on the left the way back to the overview
 * (chevron and dashboard name), on the right the date, or when editing the
 * status (`EntryStatus`) instead. Shared by `EntryDetailFrame` and `LibraryPageFrame`.
 */
export function EntryHeaderRow({ back, meta }: {
  back: { label: string; onClick: () => void };
  meta?: ReactNode;
}) {
  return (
    <div className="px-8 pt-5 flex items-center gap-4 flex-shrink-0 min-w-0">
      <button type="button" onClick={back.onClick} className="entry-back-link">
        <ChevronLeft size={14} className="flex-shrink-0" />
        <span className="truncate">{back.label}</span>
      </button>
      {meta && <div className="entry-header-meta ml-auto flex-shrink-0 flex items-center gap-1.5">{meta}</div>}
    </div>
  );
}

/** A status in the row above the title: dot and text. `warning` for unsaved changes. */
export function EntryStatus({ tone, children }: { tone: 'accent' | 'warning'; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {/* Spelled-out classes: Tailwind generates rules from `@layer components`
          only for names that appear literally in the source. */}
      <span
        className={`entry-status-dot flex-shrink-0 ${tone === 'warning' ? 'entry-status-dot-warning' : 'entry-status-dot-accent'}`}
        aria-hidden
      />
      {children}
    </span>
  );
}

interface EntryDetailFrameProps {
  /** The dashboard the entry is shown in — back target and label; `undefined` = "All entries". */
  dashboard: Pick<Dashboard, 'id' | 'name' | 'builtin'> | undefined;
  isEditing: boolean;
  /** Top right above the title when reading, usually the date. When editing, the status is there. */
  meta?: ReactNode;
  /** Edit mode: local title state; view mode: saved title. */
  title: string;
  onTitleChange: (value: string) => void;
  /** Before the title block (the cover). */
  aboveTitle?: ReactNode;
  /** Omit = no tag row. Always readOnly; editing happens in the properties panel. */
  tags?: { value: string[]; onChange: (tags: string[]) => void };
  /** The body scrolls within the frame; the BlockStack's sticky toolbar needs the scroll area here, not in the editor. */
  children: ReactNode;
}

/**
 * The frame of the entry page (`EntryView`): title block (input ↔ h1),
 * optional tag row, body container. Above it the header row
 * (`EntryHeaderRow`): back to the dashboard's list, on the right the date
 * (`meta`) or, when editing, the status. `useEntryEditor`, `setEditActions`
 * and the `editorEpoch` key stay in the view; the frame is purely presentational.
 */
export default function EntryDetailFrame({
  dashboard, isEditing, meta,
  title, onTitleChange, aboveTitle, tags, children,
}: EntryDetailFrameProps) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);

  return (
    <div className="h-full flex flex-col">
      <EntryHeaderRow
        back={{
          label: dashboard ? dashboardLabel(t, dashboard) : t('nav.allEntries'),
          onClick: () => setActiveView({ type: 'dashboard', id: dashboard?.id ?? 'all' }),
        }}
        meta={isEditing ? <EntryStatus tone="accent">{t('editor.editing')}</EntryStatus> : meta}
      />

      {aboveTitle}

      {/* Title */}
      <div className="px-8 pt-4 pb-4 flex-shrink-0">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('entries.untitled')}
            className={ENTRY_TITLE_INPUT_CLASSES}
          />
        ) : (
          <h1 className={ENTRY_TITLE_HEADING_CLASSES}>
            {displayTitle(t, 'entry', title)}
          </h1>
        )}
      </div>

      {tags && (
        <div className="px-8 pb-3 flex-shrink-0">
          <TagInput tags={tags.value} onChange={tags.onChange} readOnly={true} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>
    </div>
  );
}
