import type { ButtonHTMLAttributes } from 'react';

interface TabIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** p-1.5 statt p-2 — 26px statt 30px bei 14px-Icon. Für dichte
   *  Segment-Reihen wie Ansicht/Sortierung in der Listen-Kopfzeile, wo zwei
   *  Gruppen nebeneinander passen müssen. */
  compact?: boolean;
}

export default function TabIconButton({ active, compact, className, children, type = 'button', ...rest }: TabIconButtonProps) {
  return (
    <button
      type={type}
      // `border border-transparent` als Grundzustand, weil die Theme-Regeln fuer
      // `.right-sidebar-tab-active` dem aktiven Tab einen 1px-Rahmen geben. Ohne
      // den Platzhalter ist der aktive Tab 32px breit und die inaktiven 30 —
      // die Reihe ruckte bei jedem Tabwechsel um 2px, und in der linken
      // Eintragsliste brach sie dadurch schon bei Standardbreite um.
      // Abweichung von der geteilten :disabled-Regel: bewusst OHNE
      // pointer-events-none, damit der title-Tooltip („… nicht verfügbar")
      // auf deaktivierten Toggles noch erscheint; Klicks blockt das native
      // disabled-Attribut ohnehin. Preis der Abweichung: :hover feuert
      // weiter — deshalb hover:enabled: hier und :not(:disabled) an den
      // Theme-Hover-Regeln in index.css.
      className={`${compact ? 'p-1.5' : 'p-2'} rounded-md border border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'right-sidebar-tab-active bg-stone-700 text-stone-200'
          : 'right-sidebar-tab-idle text-stone-500 hover:enabled:text-stone-300'
      }${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
