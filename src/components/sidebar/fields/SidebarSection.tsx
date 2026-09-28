import type { ReactNode } from 'react';
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
 * die Mitte seines 12px-
 * Pfeils also bei 10px. Dort beginnen die Icons der Zeilen: `pl-[9px]` plus
 * 1px, um den ein 14px-Icon in seiner 16px-Spalte eingerückt ist. Rechts
 * enden die Werte mit `pr-3.5` dort, wo der Zähler der Überschrift beginnt.
 * Die Hover-Fläche reicht links wie rechts bis an die Kante.
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
      {open && <div className="mt-1.5 flex flex-col gap-px">{children}</div>}
    </section>
  );
}

/** Feste 16px-Spalte vor jeder Zeile: Emoji und lucide-Icon beginnen so an derselben Stelle. */
function RowIcon({ children }: { children: ReactNode }) {
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
    <div className="flex items-center gap-1.5 pl-[9px] pr-3.5 py-1.5 text-[13px] min-w-0">
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
 */
export function SidebarItemRow({ icon, label, meta, onClick, active = false, title }: {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`sidebar-row flex items-center gap-1.5 w-full pl-[9px] pr-3.5 py-1.5 rounded-md text-[13px] text-left min-w-0${active ? ' sidebar-row--active' : ''}`}
    >
      <RowIcon>{icon}</RowIcon>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {meta && <span className="sidebar-row-meta flex-shrink-0 max-w-[45%] truncate text-[11px]">{meta}</span>}
    </button>
  );
}

/** Der Leerzustand eines Abschnitts, bündig mit den Icons der Zeilen. */
export function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty pl-[9px] pr-3.5 py-1 text-[13px]">{children}</p>;
}
