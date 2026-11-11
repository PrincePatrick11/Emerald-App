import type { CSSProperties, InputHTMLAttributes, Ref } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className' | 'style'> {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** For the field, not the input: its width in the surrounding layout. */
  className?: string;
  style?: CSSProperties;
}

/**
 * The outlined search field of the overlays: global search, link picker,
 * emoji picker, picture picker, the canvas's symbol library. The entry list's
 * borderless field on the frame and a dashboard's `ListSearchField` are different ones.
 * Remaining props go to the input, such as the global search's combobox ARIA.
 */
export default function SearchField({ value, onValueChange, inputRef, className, style, ...inputProps }: SearchFieldProps) {
  const { t } = useTranslation();
  return (
    // In Parchment, `bg-well-raise` beats the `.sidebar-search-inner` override
    // (Documentation/design.md, Specificity Traps); it can go once someone
    // checks the field in Parchment without it.
    <div
      className={`sidebar-search-inner box-border flex items-center gap-2 rounded-md px-2.5 h-8 bg-well-raise${className ? ` ${className}` : ''}`}
      style={style}
    >
      <Search size={14} className="text-subtle flex-shrink-0" />
      <input
        {...inputProps}
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="sidebar-search-input flex-1 min-w-0 bg-transparent text-xs outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={(e) => {
            onValueChange('');
            e.currentTarget.parentElement?.querySelector('input')?.focus();
          }}
          aria-label={t('search.clear')}
          className="flex-shrink-0 opacity-70 hover:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
