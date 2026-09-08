import type { ReactNode } from 'react';

/**
 * Die Ueberschrift eines Einstellungs-Abschnitts. Stand vorher in jeder Sektion
 * einzeln — fuenfmal dieselbe Klassenkette, jedes Mal mit einer Icon-Groesse,
 * die auf der Skala der App keine Stufe ist. `.label-xs` traegt die
 * Schriftregeln, die auch die Seitenleisten benutzen.
 */
export default function SettingsSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="label-xs flex items-center gap-2 mb-3">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}
