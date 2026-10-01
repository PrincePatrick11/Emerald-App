import { useState, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Tag, X } from 'lucide-react';
import { useTagMap, useTagStore, visibleTags } from '../../store/tagStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUIStore } from '../../store/uiStore';
import { useOutsideClick } from '../../hooks/useOutsideClick';

interface TagInputProps {
  /** Tag-IDs. Die von Tags im Papierkorb bleiben unsichtbar in der Liste stehen. */
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
  /** Nur im Lesen: `row` macht die Chips 24px hoch — für die Seitenleiste,
   *  wo sie in einer Zeile mit den Listenzeilen darüber stehen. */
  chipSize?: 'default' | 'row';
}

export default function TagInput({ tags, onChange, readOnly = false, chipSize = 'default' }: TagInputProps) {
  const { t } = useTranslation();
  const { tags: allTags, ensureTag, getByName } = useTagStore(
    useShallow((s) => ({ tags: s.tags, ensureTag: s.ensureTag, getByName: s.getByName }))
  );
  const shown = visibleTags(tags, useTagMap());
  const createInline = useSettingsStore((s) => s.settings.tags.createInline);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = allTags.filter(
    (t) =>
      t.name.toLowerCase().includes(input.toLowerCase()) &&
      !tags.includes(t.id)
  );

  const trimmedInput = input.trim();
  const inputMatchesTag = !!trimmedInput && !!getByName(trimmedInput);

  const addTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) { setInput(''); return; }
    // Ohne Anlegen-Erlaubnis nur vorhandene Tags; der Hinweis im Menü darunter
    // sagt, wo neue entstehen.
    if (!createInline && !getByName(trimmed)) { setOpen(true); return; }
    // ensureTag findet „foo" auch als „Foo".
    const { id } = await ensureTag(trimmed);
    if (!tags.includes(id)) onChange([...tags, id]);
    setInput('');
    setOpen(false);
  };

  const removeTag = (id: string) => {
    onChange(tags.filter((t) => t !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === 'Backspace' && !input && shown.length > 0) {
      removeTag(shown[shown.length - 1].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close dropdown on outside click. Escape wird nicht hier, sondern im
  // onKeyDown des Inputs behandelt (siehe handleKeyDown).
  const wrapperRef = useRef<HTMLDivElement>(null);
  useOutsideClick(open, () => setOpen(false), { refs: [wrapperRef] });

  if (readOnly) {
    if (shown.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {shown.map((tag) => (
          <span
            key={tag.id}
            className={`px-2 rounded-full text-xs font-medium ${chipSize === 'row' ? 'h-6 inline-flex items-center' : 'py-0.5'}`}
            style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    );
  }

  const menu = open && (input || suggestions.length > 0) && (
    <div className="absolute top-full left-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl min-w-[160px] py-1">
      {suggestions.map((t) => (
        <button
          key={t.id}
          onMouseDown={(e) => { e.preventDefault(); addTag(t.name); }}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-700 flex items-center gap-2"
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: t.color }}
          />
          {t.name}
        </button>
      ))}
      {trimmedInput && !inputMatchesTag && (createInline ? (
        <button
          onMouseDown={(e) => { e.preventDefault(); addTag(input); }}
          className="w-full text-left px-3 py-1.5 text-xs text-jade-400 hover:bg-stone-700"
        >
          {t('tags.createNamed', { name: trimmedInput })}
        </button>
      ) : (
        <button
          onMouseDown={(e) => { e.preventDefault(); setOpen(false); setActiveView({ type: 'tags' }); }}
          className="w-full text-left px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-700"
        >
          {t('tags.unknownOpenDashboard', { name: trimmedInput })}
        </button>
      ))}
    </div>
  );

  // Bearbeitet wird nur in der Seitenleiste (`TagsField`): die Chips (24px,
  // mit rundem „×") stehen für sich, darunter das Feld „Tag hinzufügen …".
  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1">
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-2.5 pr-3 pt-0.5 pb-1">
          {shown.map((tag) => (
            <span
              key={tag.id}
              className="h-6 inline-flex items-center gap-0.5 pl-2.5 pr-1 rounded-full text-xs font-medium max-w-full"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
            >
              <span className="min-w-0 truncate">{tag.name}</span>
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="tag-chip-remove flex-shrink-0"
                title={t('properties.removeTag')}
                aria-label={`${t('properties.removeTag')}: ${tag.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Eingerückt wie die Zeilen der Seitenleiste, nicht wie ihre Überschriften. */}
      <div className="sidebar-add-field ml-[9px] mr-3">
        <Tag size={14} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={t('properties.addTag')}
          aria-label={t('properties.addTag')}
          className="selectable"
        />
      </div>
      {menu}
    </div>
  );
}
