import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { usePersistedFlag } from '../../../hooks/usePersistedFlag';
import SidebarSectionHeader from './SidebarSectionHeader';

/**
 * Ein einklappbarer Abschnitt der Leseansicht in der rechten Seitenleiste —
 * Eigenschaften, Verlinkungen, Tags, Blöcke, beim Altar die Elemente. Kopf mit
 * Chevron, Label und optionalem Zähler rechts; ob er zu ist, merkt sich
 * `storageKey` über alle Einträge hinweg (eine Vorliebe, keine Arbeitsgeste).
 *
 * Die Abschnitte stehen ohne Trennlinie untereinander; den Abstand zwischen
 * ihnen setzt der Aufrufer (`RightSidebar`: `gap-5` im Körper).
 *
 * Der Kopf steht links 4px, rechts 6px innerhalb der Kante (`pl-1 pr-1.5`),
 * die Mitte seines 12px-Pfeils also bei 10px. Dort beginnen die Icons der
 * Zeilen: `pl-[9px]` plus 1px, um den ein 14px-Icon in seiner 16px-Spalte
 * eingerückt ist. Rechts enden die Werte 14px vor der Kante, wo der Zähler
 * der Überschrift beginnt: der Inhalt steht mit `mr-0.5` 2px eingerückt, die
 * Zeilen mit `pr-3`. So endet auch die Hover-Fläche rechts 2px früher und
 * wirkt neben dem Pfeil links nicht breiter.
 */
export default function SidebarSection({ storageKey, label, count, children }: {
  storageKey: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, toggle] = usePersistedFlag(storageKey, true);
  return (
    <section aria-label={label}>
      <SidebarSectionHeader label={label} open={open} onToggle={toggle} count={count} className="w-full pl-1 pr-1.5" />
      {open && <div className="mr-0.5 mt-1.5 flex flex-col gap-px">{children}</div>}
    </section>
  );
}

/** Feste 16px-Spalte vor jeder Zeile: Emoji und lucide-Icon beginnen so an derselben Stelle. */
export function RowIcon({ children }: { children: ReactNode }) {
  return <span className="sidebar-row-icon w-4 flex-shrink-0 flex items-center justify-center leading-none">{children}</span>;
}

/**
 * Eine Eigenschaft: Icon und Name links, Wert rechts. `muted` für einen
 * Leerwert („Keine", „Aus") — er steht leiser und nicht fett.
 */
export function SidebarPropertyRow({ icon, label, value, muted = false }: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 pl-[9px] pr-3 py-1.5 text-[13px] min-w-0">
      <RowIcon>{icon}</RowIcon>
      {/* Wird es eng, kürzt zuerst der Name — der Wert ist das, was man liest.
          Er nimmt höchstens 65 %, darüber kürzt auch er. */}
      <span className="sidebar-prop-label min-w-0 truncate" title={label}>{label}</span>
      {/* Kein `truncate` am Flex-Container selbst: mit `justify-end` schnitte er
          links ab. Ein Text kürzt in seiner eigenen Spanne am Ende. */}
      <span className={`ml-auto flex-shrink-0 max-w-[65%] flex items-center justify-end gap-1.5 ${muted ? 'sidebar-prop-value--muted' : 'sidebar-prop-value'}`}>
        {typeof value === 'string' ? <span className="min-w-0 truncate" title={value}>{value}</span> : value}
      </span>
    </div>
  );
}

/**
 * Eine anklickbare Listenzeile — eine Verlinkung, ein Block, ein Element des
 * Altars: Icon, Name, rechts leise eine Zuordnung (`meta`). Hover hebt die
 * Zeile als Fläche an; `active` markiert die gewählte.
 *
 * `action` hängt im Bearbeiten einen Knopf hinter die Zeile (die Verlinkungen:
 * `SidebarRowRemove`). Die Zeile ist dann ein Rahmen um zwei Knöpfe — der
 * Hauptteil trägt Icon, Name und Zuordnung wie sonst die ganze Zeile.
 */
export function SidebarItemRow({ icon, label, meta, onClick, active = false, title, action }: {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  action?: ReactNode;
}) {
  const state = active ? ' sidebar-row--active' : '';
  if (action !== undefined) {
    return (
      <div className={`sidebar-row flex items-center gap-1 h-8 pr-1 rounded-md text-[13px] min-w-0${state}`}>
        <button
          type="button"
          onClick={onClick}
          title={title}
          aria-pressed={active}
          className="sidebar-row-main flex flex-1 min-w-0 h-full items-center gap-1.5 pl-[9px] rounded-md text-left"
        >
          <RowIcon>{icon}</RowIcon>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {meta && <span className="sidebar-row-meta flex-shrink-0 max-w-[45%] truncate text-[11px]">{meta}</span>}
        </button>
        {action}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`sidebar-row flex items-center gap-1.5 w-full pl-[9px] pr-3 py-1.5 rounded-md text-[13px] text-left min-w-0${state}`}
    >
      <RowIcon>{icon}</RowIcon>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {meta && <span className="sidebar-row-meta flex-shrink-0 max-w-[45%] truncate text-[11px]">{meta}</span>}
    </button>
  );
}

/**
 * Das „×" am Ende einer `SidebarItemRow` (`action`). Ohne `onClick` bleibt nur
 * sein Platz leer — so fluchten die Zuordnungen mit denen der Zeilen, die eines haben.
 */
export function SidebarRowRemove({ title, onClick }: { title: string; onClick?: () => void }) {
  if (!onClick) return <span className="w-6 flex-shrink-0" />;
  return (
    <button type="button" onClick={onClick} className="sidebar-row-remove" title={title} aria-label={title}>
      <X size={13} />
    </button>
  );
}

/** Der Leerzustand eines Abschnitts, bündig mit den Icons der Zeilen. */
export function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty pl-[9px] pr-3 py-1 text-[13px]">{children}</p>;
}
