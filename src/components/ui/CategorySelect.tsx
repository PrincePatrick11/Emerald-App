import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dropdown from './Dropdown';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

/** Der „ohne Kategorie"-Eintrag. Kein gültiger Wert der Spalte, nur des Menüs. */
const NONE = '__none__';

interface Props<C extends { id: string; emoji: string }> {
  categories: readonly C[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Wiki/Ops binden categoryLabel: (c) => categoryLabel(t, 'wiki', c); Tasks: (c) => c.name */
  getLabel: (cat: C) => string;
  /** 'field' = Properties-Panel-Look (volle Breite), 'chip' = Inline-Chip in der TaskRow. */
  variant: 'field' | 'chip';
  align?: 'left' | 'right';
  /** Tooltip des Chip-Triggers. */
  title?: string;
}

/**
 * Kategorie-Zuweisung als gethemtes Menü statt nativem <select>: die
 * Design-Sprache der App sind eigene Menüs (ContextMenu, Dropdown, TaskRow),
 * und ein OS-Popup neben dem verbleibenden Prioritäts-Menü der TaskRow würde
 * brechen. Vereinheitlicht ist das Popover, der Trigger variiert pro Kontext —
 * dasselbe Muster wie beim EmojiPicker.
 *
 * Ganz oben steht „Ohne Kategorie" — seit v39 ein echter Zustand und nicht
 * mehr bloß der Anzeigetext für eine Kategorie, die es nicht mehr gibt. Er ist
 * zugleich das, was ein neuer Eintrag mitbringt.
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
  // Auch eine Kategorie im Papierkorb landet hier: ihre id löst nicht mehr auf,
  // der Eintrag ist für den Leser so kategorielos wie einer mit `null`.
  const triggerText = current ? `${current.emoji} ${getLabel(current)}` : t('categories.uncategorized');

  return (
    <Dropdown
      value={current ? current.id : NONE}
      options={options}
      onChange={(next) => onChange(next === NONE ? null : next)}
      align={align}
      // Die Panels scrollen (RightSidebar overflow-y-auto) — ohne Portal würde
      // das Menü dort abgeschnitten; das ersetzte native <select> hatte das Problem nie.
      portal={variant === 'field'}
      trigger={({ open, toggle }) => (
        variant === 'field' ? (
          <button
            onClick={toggle}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={OP_PROP_SELECT_CLASSES + ' cursor-pointer flex items-center justify-between gap-2 text-left'}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
          </button>
        ) : (
          <button
            onClick={toggle}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="tasks-category-trigger text-xs text-stone-500 hover:text-stone-300 px-1.5 py-0.5 rounded hover:bg-stone-700/50"
            title={title}
          >
            {triggerText}
          </button>
        )
      )}
    />
  );
}
