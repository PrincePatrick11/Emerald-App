import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The settings' choice button: theme, language, sizes, lists,
 * tag rule, import mode. It carries its state through the three
 * `settings-choice-btn` classes; surface, border colour and text colour are in
 * the stylesheet for both themes, the focus ring in the shared
 * :focus-visible list. That is why there is no jade or stone utility
 * here any more: the theme rules beat them anyway, they would only be a second,
 * dead truth to copy from.
 *
 * The size comes along: almost every button in the window is a chip in a
 * row. `layout="card"` leaves it to the caller again — for the
 * import's mode cards, which are full rows with two lines of text.
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
      // Multiple choice like the sidebar lists needs it, single choice
      // is not harmed by it — and so all buttons in the window carry it.
      aria-pressed={active}
      className={`settings-choice-btn rounded-lg transition-all duration-150 ${
        layout === 'chip' ? 'px-3 py-1.5 text-sm ' : ''
      }${active ? 'settings-choice-btn-active' : 'settings-choice-btn-idle'}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The row such buttons sit in — wrapping, with the window's spacing. */
export function SettingsChoiceRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 flex-wrap">{children}</div>;
}
