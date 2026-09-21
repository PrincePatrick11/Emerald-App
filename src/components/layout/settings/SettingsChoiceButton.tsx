import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Der Auswahl-Knopf der Einstellungen: Theme, Sprache, Groessen, Listen,
 * Tag-Regel, Import-Modus. Er traegt den Zustand ueber die drei
 * `settings-choice-btn`-Klassen; Flaeche, Rahmenfarbe und Schriftfarbe stehen
 * fuer beide Themes im Stylesheet, der Fokusring in der geteilten
 * :focus-visible-Liste. Deshalb steht hier keine jade- oder stone-Utility
 * mehr: die Theme-Regeln schlagen sie ohnehin, sie waeren nur eine zweite,
 * tote Wahrheit zum Abschreiben.
 *
 * Die Groesse kommt mit: fast jeder Knopf des Fensters ist ein Chip in einer
 * Reihe. `layout="card"` ueberlaesst sie wieder dem Aufrufer — fuer die
 * Modus-Karten des Imports, die volle Zeilen mit zwei Textzeilen sind.
 */
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  layout?: 'chip' | 'card';
}

export default function SettingsChoiceButton({
  active,
  layout = 'chip',
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`settings-choice-btn rounded-lg border transition-all duration-150 ${
        layout === 'chip' ? 'px-3 py-1.5 text-sm ' : ''
      }${active ? 'settings-choice-btn-active' : 'settings-choice-btn-idle'}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Die Reihe, in der solche Knoepfe stehen — umbrechend, mit dem Abstand des Fensters. */
export function SettingsChoiceRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 flex-wrap">{children}</div>;
}
