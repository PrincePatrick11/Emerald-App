import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, X } from 'lucide-react';
import Button from './Button';

/**
 * Die 56px-Leiste oben in der rechten Seitenleiste. Spiegelt die Tab-Leiste in
 * `LeftSidebarEntryList`, damit beide Seitenleisten ihre Unterkante auf
 * derselben Linie haben — beide synchron halten, mit einer bekannten Ausnahme:
 * jene Leiste ist `min-h-14` und bricht in eine zweite Reihe um, sobald die
 * Eintragsliste schmaler gezogen wird als ihre sechs Tabs. Das hier
 * nachzubilden hieße, diese Leiste aus einem Grund wachsen zu lassen, der mit
 * ihrem Inhalt nichts zu tun hat — sie bleibt 56px.
 */
export function SidebarActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 px-3 h-14 border-b border-stone-700/60 flex-shrink-0 min-w-0">
      {children}
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
