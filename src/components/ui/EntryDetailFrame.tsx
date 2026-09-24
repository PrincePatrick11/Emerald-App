import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { MODULES, type EntryModuleId } from '../../lib/modules';
import TagInput from '../editor/TagInput';

/** Der Seitentitel als Überschrift — Einträge, Altar und Dashboards
 *  (`DashboardTitle`, Home) stehen bewusst gleich groß. Eine Klassenkette,
 *  kein `@apply` in `.entry-view-title`: die Theme-Regeln für `.text-stone-100`
 *  griffen sonst nicht mehr. */
export const ENTRY_TITLE_HEADING_CLASSES = 'entry-view-title text-2xl font-semibold text-stone-100';

/** Die Titelzeile als Eingabe — Einträge im Bearbeiten, der Altar und die Seiten der Bibliotheken (`LibraryPageFrame`). */
export const ENTRY_TITLE_INPUT_CLASSES =
  `${ENTRY_TITLE_HEADING_CLASSES} w-full bg-transparent placeholder-stone-700 outline-none selectable`;

/**
 * Die schmale Zeile über dem Titel: links der Weg zurück zur Übersicht
 * (Chevron und Modulname), rechts das Datum — im Bearbeiten stattdessen der
 * Status (`EntryStatus`). Geteilt von `EntryDetailFrame`, `LibraryPageFrame`
 * und `AltarView`; `inset` folgt dem Einzug des Titels darunter.
 */
export function EntryHeaderRow({ back, meta, inset = 'px-8' }: {
  back: { label: string; onClick: () => void };
  meta?: ReactNode;
  inset?: string;
}) {
  return (
    <div className={`${inset} pt-5 flex items-center gap-4 flex-shrink-0 min-w-0`}>
      <button type="button" onClick={back.onClick} className="entry-back-link">
        <ChevronLeft size={14} className="flex-shrink-0" />
        <span className="truncate">{back.label}</span>
      </button>
      {meta && <div className="entry-header-meta ml-auto flex-shrink-0 flex items-center gap-1.5">{meta}</div>}
    </div>
  );
}

/** Ein Status in der Zeile über dem Titel: Punkt und Text. `warning` für Ungespeichertes. */
export function EntryStatus({ tone, children }: { tone: 'accent' | 'warning'; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {/* Ausgeschriebene Klassen: Tailwind erzeugt Regeln aus `@layer components`
          nur für Namen, die wörtlich im Quelltext stehen. */}
      <span
        className={`entry-status-dot flex-shrink-0 ${tone === 'warning' ? 'entry-status-dot-warning' : 'entry-status-dot-accent'}`}
        aria-hidden
      />
      {children}
    </span>
  );
}

interface EntryDetailFrameProps {
  /** Bestimmt Zurück-Ziel/-Label und den Untitled-Platzhalter (Registry). */
  module: EntryModuleId;
  isEditing: boolean;
  /** Rechts über dem Titel im Lesen, meist das Datum. Im Bearbeiten steht dort der Status. */
  meta?: ReactNode;
  /** Edit-Mode: lokaler Titel-State; View-Mode: gespeicherter Titel. */
  title: string;
  onTitleChange: (value: string) => void;
  /** Vor dem Titelblock (Wiki: Cover-Hero). */
  aboveTitle?: ReactNode;
  /** Zwischen Titel und Tags (Journal: Chips; Operations: Cover + Property-Chips). */
  belowTitle?: ReactNode;
  /** Weglassen = keine Tag-Zeile. Immer readOnly — editiert wird im Properties-Panel. */
  tags?: { value: string[]; onChange: (tags: string[]) => void };
  /** Der Körper scrollt im Frame — die sticky Toolbar des BlockStack braucht den Scrollbereich hier, nicht im Editor. */
  children: ReactNode;
}

/**
 * Der gemeinsame Detail-View-Rahmen von Journal, Wiki und Operations (auch
 * Sigillen, seit v41 Blöcke): Titelblock (Input ↔ h1), optionale Tag-Zeile,
 * Body-Container. Darüber die Kopfzeile (`EntryHeaderRow`): zurück zur
 * Übersicht des Moduls, rechts das Datum (`meta`) bzw. im Bearbeiten der
 * Status. `useEntryEditor`, `setEditActions` und der
 * `editorEpoch`-Key bleiben in den Views — der Frame ist rein präsentational.
 *
 * AltarView bleibt bewusst außen vor: eigener Titelblock (px-6, Fullscreen-
 * Verhalten) — eine Teilnutzung bräuchte mehr Props als sie Zeilen spart.
 */
export default function EntryDetailFrame({
  module, isEditing, meta,
  title, onTitleChange, aboveTitle, belowTitle, tags, children,
}: EntryDetailFrameProps) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const moduleInfo = MODULES[module];

  return (
    <div className="h-full flex flex-col">
      <EntryHeaderRow
        back={{ label: t(moduleInfo.navLabelKey), onClick: () => setActiveView({ type: module }) }}
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
            placeholder={t(moduleInfo.untitledKey)}
            className={ENTRY_TITLE_INPUT_CLASSES}
          />
        ) : (
          <h1 className={ENTRY_TITLE_HEADING_CLASSES}>
            {title || t(moduleInfo.untitledKey)}
          </h1>
        )}
      </div>

      {belowTitle}

      {tags && (
        <div className="px-8 pb-3 flex-shrink-0">
          <TagInput tags={tags.value} onChange={tags.onChange} readOnly={true} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>
    </div>
  );
}
