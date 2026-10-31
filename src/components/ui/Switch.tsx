import type { LucideIcon } from 'lucide-react';

/**
 * An on/off switch with track and knob. For settings that take effect
 * immediately and have no third state: in the dashboard sidebar,
 * grouping and display. A block's yes/no field (`ToggleSwitch` in
 * FieldValueEditor) is deliberately something else: there the value is content, with
 * a label, not a control.
 */
export default function Switch({ checked, onChange, disabled, title }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`switch${checked ? ' switch--on' : ''}`}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/**
 * A row of icon, label and `Switch` on the right. The whole row is the
 * label: a click anywhere toggles, the switch itself remains the one
 * focusable button. With `hint` a quiet hint stands below the label,
 * and the switch sits at its first line of text.
 *
 * `variant="sidebar"`: the edit sidebar (display of a custom
 * block), indented like its rows, with a hover surface.
 * `variant="panel"`: without indentation and hover surface, flush with the fields
 * above it, in a block's settings below its row and in the
 * sections of the settings window.
 */
export function SwitchRow({ icon: Icon, label, hint, checked, onChange, disabled, title, variant = 'dashboard' }: {
  icon?: LucideIcon;
  label: string;
  /** Sits quietly below the label and may wrap. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Tooltip, e.g. why the switch is currently disabled. */
  title?: string;
  variant?: 'dashboard' | 'sidebar' | 'panel';
}) {
  const sidebar = variant === 'sidebar';
  return (
    <label
      title={title}
      // Dashboard: px-3 like the trigger of the select above it (FieldDropdown)
      // and the filter rows below; icon and switch line up with the icon
      // and chevron of the sorting. One line is 30px tall like the other
      // controls in the sidebar; if the label wraps, it stays tight.
      // Sidebar: the icon starts at 10px like the row icons there.
      className={`switch-row flex ${hint ? 'items-start' : 'items-center'} gap-2.5 ${
        sidebar ? 'switch-row--sidebar pl-2.5 pr-3 py-1 rounded-md' : variant === 'panel' ? 'switch-row--panel px-0.5 py-1' : 'px-3 py-[7px]'
      } text-[13px] leading-4${disabled ? ' switch-row--disabled' : ''}`}
    >
      {Icon && <Icon size={14} className="flex-shrink-0" />}
      <span className="flex-1 min-w-0">
        {label}
        {hint && <span className="switch-row-hint block mt-0.5 text-xs leading-[1.4]">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} title={title} />
    </label>
  );
}
