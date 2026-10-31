import type { ButtonHTMLAttributes } from 'react';

interface RailButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The currently open view; gets the same accent border as
   *  `.sidebar-item.active`. */
  active?: boolean;
}

export default function RailButton({ className, children, type = 'button', active = false, ...rest }: RailButtonProps) {
  return (
    <button
      type={type}
      className={`btn-ghost rail-button${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
