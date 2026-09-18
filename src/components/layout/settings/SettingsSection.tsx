import type { ReactNode } from 'react';

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

/** Der erklärende Satz unter einer Einstellung — unter einem Abschnitt oder einer Zeile darin. */
export function SettingsDescription({ children, className = 'mb-2' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs ${className}`} style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
