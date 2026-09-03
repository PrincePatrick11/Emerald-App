import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/uiStore';
import { MODULES, type EntryModuleId } from '../../lib/modules';
import TagInput from '../editor/TagInput';

interface EntryDetailFrameProps {
  /** Bestimmt Breadcrumb-Ziel/-Label und den Untitled-Platzhalter (Registry). */
  module: EntryModuleId;
  isEditing: boolean;
  /** Spans nach dem Zurück-Button: Icon, Kategorie, `·`, Datum. */
  breadcrumbMeta?: ReactNode;
  /** Rechte Topbar-Seite (Sigil: Show/Hide-Button). */
  topbarRight?: ReactNode;
  /** Edit-Mode: lokaler Titel-State; View-Mode: gespeicherter Titel. */
  title: string;
  onTitleChange: (value: string) => void;
  /** Vor dem Titelblock (Wiki: Cover-Hero). */
  aboveTitle?: ReactNode;
  /** Zwischen Titel und Tags (Journal: Chips; Operations: Cover + Property-Chips). */
  belowTitle?: ReactNode;
  /** Weglassen = keine Tag-Zeile (Sigil). Immer readOnly — editiert wird im Properties-Panel. */
  tags?: { value: string[]; onChange: (tags: string[]) => void };
  /** 'editor' (Default): overflow-hidden, der Editor scrollt selbst. 'scroll': eigener Scrollbereich (Sigil). */
  body?: 'editor' | 'scroll';
  children: ReactNode;
}

/**
 * Der gemeinsame Detail-View-Rahmen von Journal, Wiki, Operations und
 * OperationSigilView: Topbar mit Breadcrumb und Editing-Marker, Titelblock
 * (Input ↔ h1), optionale Tag-Zeile, Body-Container. `useEntryEditor`,
 * `setEditActions` und der `editorEpoch`-Key bleiben in den Views — der Frame
 * ist rein präsentational plus dem einen Zurück-Klick.
 *
 * AltarView bleibt bewusst außen vor: eigener Titelblock (px-6, Fullscreen-
 * Verhalten), kein Editing-Marker — eine Teilnutzung bräuchte mehr Props als
 * sie Zeilen spart.
 */
export default function EntryDetailFrame({
  module, isEditing, breadcrumbMeta, topbarRight,
  title, onTitleChange, aboveTitle, belowTitle, tags, body = 'editor', children,
}: EntryDetailFrameProps) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const meta = MODULES[module];

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: module })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t(meta.navLabelKey)}
          </button>
          {breadcrumbMeta}
          {isEditing && <span className="text-stone-700 italic ml-1">{t('editor.editing')}</span>}
        </div>
        {topbarRight != null && <div className="flex items-center gap-2">{topbarRight}</div>}
      </div>

      {aboveTitle}

      {/* Title */}
      <div className="px-8 pt-6 pb-4 flex-shrink-0">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t(meta.untitledKey)}
            className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100
                       placeholder-stone-700 outline-none selectable"
          />
        ) : (
          <h1 className="entry-view-title text-2xl font-semibold text-stone-100">
            {title || t(meta.untitledKey)}
          </h1>
        )}
      </div>

      {belowTitle}

      {tags && (
        <div className="px-8 pb-3 flex-shrink-0">
          <TagInput tags={tags.value} onChange={tags.onChange} readOnly={true} />
        </div>
      )}

      {body === 'scroll' ? (
        <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>
      ) : (
        <div className="flex-1 overflow-hidden px-8 pb-8">{children}</div>
      )}
    </div>
  );
}
