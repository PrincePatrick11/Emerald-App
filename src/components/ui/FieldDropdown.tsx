import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import Dropdown, { type DropdownOption } from './Dropdown';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

/** The field look with the font of the filter rows below it: 13px instead of
 *  `text-xs`, 30px tall like the sidebar's primary button; spelled out instead of overridden, so that no two
 *  Tailwind classes fight over the same property. Otherwise the same
 *  classes as OP_PROP_SELECT_CLASSES (the theme bridges hang on
 *  `op-prop-select`). */
const SIDEBAR_SELECT_CLASSES =
  'op-prop-select w-full bg-stone-800/60 rounded-md px-3 py-1 text-[13px] leading-5 text-stone-300 outline-none ' +
  'border border-stone-700/40 focus:border-stone-600 transition-colors';

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Text of the trigger, if it should not come from the chosen option. */
  triggerText?: string;
  align?: 'left' | 'right';
  /** `sidebar`: the dashboard sidebar's select (SortSelect): the
   *  icon of the chosen option at the front, 13px like the filter rows, up/down
   *  chevron; icon and chevron line up with the `SwitchRow`s below. */
  variant?: 'field' | 'sidebar';
  /** aria-label of the trigger, when its text alone does not say what it selects. */
  ariaLabel?: string;
}

/**
 * A select menu in the look of the property fields: full width, field border,
 * chevron. The menu is portalled: the sidebars scroll, and an absolutely
 * positioned menu would be clipped there. Users: `CategorySelect`
 * (`variant="field"`), a template's assignments, the overview of the
 * default templates and the sorting of the dashboard sidebar
 * (`SortSelect`, `variant="sidebar"`).
 */
export default function FieldDropdown<T extends string>({ value, options, onChange, triggerText, align, variant = 'field', ariaLabel }: Props<T>) {
  const sidebar = variant === 'sidebar';
  const current = options.find((o) => o.value === value);
  const text = triggerText ?? (current ? `${current.emoji ? `${current.emoji} ` : ''}${current.label}` : '');
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      align={align}
      portal
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={`${sidebar ? SIDEBAR_SELECT_CLASSES : OP_PROP_SELECT_CLASSES} cursor-pointer flex items-center gap-2.5 text-left`}
        >
          {sidebar && current?.icon}
          <span className="flex-1 min-w-0 truncate">{text}</span>
          {sidebar
            ? <ChevronsUpDown size={14} className="flex-shrink-0 opacity-60" />
            : <ChevronDown size={12} className="flex-shrink-0 opacity-60" />}
        </button>
      )}
    />
  );
}
