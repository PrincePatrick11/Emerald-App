import type { ButtonHTMLAttributes } from 'react';

interface TabIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export default function TabIconButton({ active, className, children, type = 'button', ...rest }: TabIconButtonProps) {
  return (
    <button
      type={type}
      // `border border-transparent` als Grundzustand, weil die Theme-Regeln fuer
      // `.right-sidebar-tab-active` dem aktiven Tab einen 1px-Rahmen geben. Ohne
      // den Platzhalter ist der aktive Tab 32px breit und die inaktiven 30 —
      // die Reihe ruckte bei jedem Tabwechsel um 2px, und in der linken
      // Eintragsliste brach sie dadurch schon bei Standardbreite um.
      className={`p-2 rounded-md border border-transparent transition-colors ${
        active
          ? 'right-sidebar-tab-active bg-stone-700 text-stone-200'
          : 'right-sidebar-tab-idle text-stone-500 hover:text-stone-300'
      }${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
