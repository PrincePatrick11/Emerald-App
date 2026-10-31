import type { ButtonHTMLAttributes } from 'react';

interface TabIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** p-1.5 instead of p-2: 26px instead of 30px with a 14px icon. For dense
   *  segment rows such as view/sorting in the list header, where two
   *  groups have to fit side by side. */
  compact?: boolean;
}

export default function TabIconButton({ active, compact, className, children, type = 'button', ...rest }: TabIconButtonProps) {
  return (
    <button
      type={type}
      // `border border-transparent` as the base state, because the theme rules for
      // `.right-sidebar-tab-active` give the active tab a 1px border. Without
      // the placeholder the active tab is 32px wide and the inactive ones 30,
      // and the row jerked by 2px on every tab switch.
      // Deviation from the shared :disabled rule: deliberately WITHOUT
      // pointer-events-none, so that the title tooltip ("… not available")
      // still appears on disabled toggles; the native disabled attribute
      // blocks clicks anyway. Price of the deviation: :hover keeps
      // firing, hence hover:enabled: here and :not(:disabled) on the
      // theme hover rules in index.css.
      className={`${compact ? 'p-1.5' : 'p-2'} rounded-md border border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'right-sidebar-tab-active bg-well-active text-secondary'
          : 'right-sidebar-tab-idle text-subtle hover:enabled:text-raise'
      }${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
