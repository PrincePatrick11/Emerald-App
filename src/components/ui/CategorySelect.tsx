import { useTranslation } from 'react-i18next';
import Dropdown from './Dropdown';
import FieldDropdown from './FieldDropdown';

/** The "no category" entry. Not a valid value of the column, only of the menu. */
const NONE = '__none__';

interface Props<C extends { id: string; emoji: string }> {
  categories: readonly C[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Wiki/Ops binden categoryLabel: (c) => categoryLabel(t, 'wiki', c); Tasks: (c) => c.name */
  getLabel: (cat: C) => string;
  /** 'field' = full-width field look (AltarItemModal), 'chip' = inline chip in the TaskRow. */
  variant: 'field' | 'chip';
  align?: 'left' | 'right';
  /** Tooltip of the chip trigger. */
  title?: string;
}

/**
 * Category assignment as a themed menu instead of a native <select>: the
 * app's design language is custom menus (ContextMenu, Dropdown, TaskRow),
 * and an OS popup next to the remaining priority menu of the TaskRow would
 * clash. The popover is unified, the trigger varies per context,
 * the same pattern as in the EmojiPicker.
 *
 * At the very top is "No category", since v39 a real state and no longer
 * merely the display text for a category that no longer exists. It is
 * also what a new entry starts with.
 */
export default function CategorySelect<C extends { id: string; emoji: string }>({
  categories, value, onChange, getLabel, variant, align, title,
}: Props<C>) {
  const { t } = useTranslation();
  const current = value ? categories.find((c) => c.id === value) : undefined;
  const options = [
    { value: NONE, label: t('categories.uncategorized') },
    ...categories.map((c) => ({ value: c.id, label: getLabel(c), emoji: c.emoji })),
  ];
  // A category in the trash also ends up here: its id no longer resolves,
  // so for the reader the entry is as category-less as one with `null`.
  const triggerText = current ? `${current.emoji} ${getLabel(current)}` : t('categories.uncategorized');
  const select = (next: string) => onChange(next === NONE ? null : next);

  if (variant === 'field') {
    return (
      <FieldDropdown value={current ? current.id : NONE} options={options} onChange={select} triggerText={triggerText} align={align} />
    );
  }

  return (
    <Dropdown
      value={current ? current.id : NONE}
      options={options}
      onChange={select}
      align={align}
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="tasks-category-trigger text-xs text-stone-500 hover:text-stone-300 px-1.5 py-0.5 rounded hover:bg-stone-700/50"
          title={title}
        >
          {triggerText}
        </button>
      )}
    />
  );
}
