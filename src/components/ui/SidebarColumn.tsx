import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, X } from 'lucide-react';
import Button from './Button';

/**
 * Die 56px-Leiste oben in der rechten Seitenleiste. Genauso hoch wie die
 * Suchzeile der Eintragsliste (`EntryListTab`, `h-14`), damit beide
 * Seitenleisten ihre Oberkante des Inhalts auf derselben Linie haben — beide
 * synchron halten. Nur diese Leiste zieht eine Linie darunter: sie liegt auf
 * dem Blatt, die Suchzeile links auf dem Rahmen. Die Linie sitzt am inneren
 * Element und reicht deshalb nur von Knopfkante zu Knopfkante, wie die
 * Trennlinien im Körper darunter (`.sidebar-divider`).
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
 * Fertig, Löschen, Abbrechen — die Leiste jedes Bearbeitungsmodus: ein
 * Eintrag (RightSidebar) und die Seite eines eigenen Blocks. Ohne `onDelete`
 * fehlt der Löschen-Knopf; `busy` sperrt Fertig, solange gespeichert wird.
 */
export function EditActionBar({ onDone, onDelete, onCancel, busy }: {
  onDone: () => void;
  onDelete?: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SidebarActionBar>
      <Button tone="jade" fill disabled={busy} title={t('editor.done')} aria-label={t('editor.done')} onClick={onDone}>
        <Check size={14} />
        <span className="truncate">{t('editor.done')}</span>
      </Button>
      {onDelete && (
        <Button tone="danger" compact title={t('editor.delete')} aria-label={t('editor.delete')} onClick={onDelete}>
          <Trash2 size={14} />
        </Button>
      )}
      <Button tone="neutral" compact title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={onCancel}>
        <X size={14} />
      </Button>
    </SidebarActionBar>
  );
}

/**
 * Eine Spalte der rechten Seitenleiste: oben die Leiste (`bar`, meist eine
 * `SidebarActionBar`), darunter der scrollende Körper. Der waagrechte Einzug
 * lebt hier und nirgends sonst (design.md: eine Einzugsquelle pro Spalte) —
 * `p-3` passt zum `px-3` der Leiste, sodass die Zeilen darunter mit ihren
 * Knöpfen fluchten. Ein Panel mit eigenem `px-*` bräche das wieder.
 *
 * Nutzer: RightSidebar (Eigenschaften eines Eintrags), der Kopf jedes
 * `Dashboard` und die Seite eines eigenen Blocks.
 */
export default function SidebarColumn({ bar, children, bodyClassName = '' }: {
  bar?: ReactNode;
  children: ReactNode;
  /** Wird angehängt — für den Abstand zwischen den Gruppen (Dashboard: `space-y-4`). */
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
 * Ein beschrifteter Abschnitt im Körper der Seitenleiste: `label-xs`-
 * Überschrift, darunter der Inhalt. Die Dashboard-Leiste reiht sie
 * untereinander (Ansicht, Sortierung, Anzeige, Filter) — der Abstand
 * zwischen Überschrift und Inhalt lebt nur hier.
 */
export function SidebarGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {label && <span className="label-xs">{label}</span>}
      {children}
    </div>
  );
}
