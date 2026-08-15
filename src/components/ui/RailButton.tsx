import type { ButtonHTMLAttributes } from 'react';

export default function RailButton({ className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`btn-ghost${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
