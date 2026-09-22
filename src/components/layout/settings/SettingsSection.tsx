import type { ReactNode } from 'react';
import { AlertTriangle, Check, CloudOff } from 'lucide-react';

/**
 * Die Ueberschrift eines Einstellungs-Abschnitts. Stand vorher in jeder Sektion
 * einzeln — fuenfmal dieselbe Klassenkette, jedes Mal mit einer Icon-Groesse,
 * die auf der Skala der App keine Stufe ist. `.label-xs` traegt die
 * Schriftregeln, die auch die Seitenleisten benutzen.
 *
 * `description` sagt in einem Satz, was die Einstellung bewirkt.
 */
export default function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className={`label-xs flex items-center gap-2 ${description ? 'mb-1' : 'mb-3'}`}>
        {icon}
        {title}
      </div>
      {description && <SettingsDescription className="mb-3">{description}</SettingsDescription>}
      {children}
    </section>
  );
}

/**
 * Die Rückmeldung zu einer Aktion: ein Symbol und ein Satz. Stand vorher auf
 * jeder Seite des Fensters einzeln — zehnmal dieselbe Kette, mal mit
 * `items-center gap-1`, mal mit `items-start gap-1.5`.
 *
 * `success` grün, `error` rot, `muted` still: ein Ausgang, der kein Defekt ist
 * (niemand hat geantwortet, es gibt nichts zu tun). Jeder Ton bringt sein
 * Symbol mit; `icon` schlägt es, wo ein Fehler einer ruhigen Lage entspricht.
 */
export function SettingsStatus({ tone, icon, children, className }: {
  tone: 'success' | 'error' | 'muted';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-xs flex items-start gap-1.5 ${STATUS_TONE_CLASS[tone]}${className ? ` ${className}` : ''}`}>
      <span className="shrink-0 mt-0.5">{icon ?? STATUS_ICON[tone]}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

const STATUS_TONE_CLASS = {
  success: 'text-jade-400',
  error: 'text-danger',
  muted: 'text-muted',
} as const;

const STATUS_ICON = {
  success: <Check size={12} />,
  error: <AlertTriangle size={12} />,
  muted: <CloudOff size={12} />,
} as const;

/**
 * Eine Packliste: die Überschrift und darunter Haken in zwei Spalten — was
 * mitkommt, nicht welche Einstellung gilt. Die Haken bringt der Aufrufer mit.
 */
export function SettingsCheckboxGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="label-xs mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>
    </div>
  );
}

/** Der erklärende Satz unter einer Einstellung — unter einem Abschnitt oder einer Zeile darin. */
export function SettingsDescription({ children, className = 'mb-2' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      {children}
    </p>
  );
}
