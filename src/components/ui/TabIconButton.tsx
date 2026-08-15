import type { ButtonHTMLAttributes } from 'react';

interface TabIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export default function TabIconButton({ active, className, children, type = 'button', ...rest }: TabIconButtonProps) {
  return (
    <button
      type={type}
      className={`p-2 rounded-md transition-colors ${
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
