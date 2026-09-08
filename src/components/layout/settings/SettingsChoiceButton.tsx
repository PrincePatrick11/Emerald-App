import type { ButtonHTMLAttributes } from 'react';

/**
 * Der Auswahl-Knopf der Einstellungen: Theme, Sprache, Import-Modus. Er traegt
 * den Zustand ueber die drei `settings-choice-btn`-Klassen; Flaeche, Rahmenfarbe
 * und Schriftfarbe stehen fuer beide Themes im Stylesheet, der Fokusring in der
 * geteilten :focus-visible-Liste. Deshalb steht hier keine jade- oder
 * stone-Utility mehr: die Theme-Regeln schlagen sie ohnehin, sie waeren nur eine
 * zweite, tote Wahrheit zum Abschreiben.
 *
 * Innenabstand und Form bleiben beim Aufrufer:
 * die Modus-Karten des Imports sind volle Zeilen mit zwei Textzeilen, die
 * Theme- und Sprachwahl daneben schmale Chips.
 */
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

export default function SettingsChoiceButton({
  active,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`settings-choice-btn rounded-lg border transition-all duration-150 ${
        active ? 'settings-choice-btn-active' : 'settings-choice-btn-idle'
      }${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
