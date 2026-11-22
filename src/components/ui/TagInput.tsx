import { useState, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Tag, X } from 'lucide-react';
import { randomTagColor, useTagMap, useTagStore } from '../../store/tagStore';
import { generateId } from '../../lib/helpers';
import { tagNameKey } from '../../lib/tagRefs';
import type { Tag as TagRow } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { useUIStore } from '../../store/uiStore';
import { useOutsideClick } from '../../hooks/useOutsideClick';

interface TagInputProps {
  /** Tag IDs. Those of tags in the trash stay invisibly in the list. */
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
  /** Reading only: `row` makes the chips 24px tall, for the sidebar,
   *  where they stand in line with the list rows above them. */
  chipSize?: 'default' | 'row';
  /** Flush with the fields around it (a dialog), instead of indented like the sidebar's rows. */
  flush?: boolean;
  /** Dialogs that save later: a new name does not become a tag at once but a draft
   *  with an ID of its own in `tags`; the caller creates it on saving (`commitDraftTags`). */
  drafts?: DraftTag[];
  onDraftsChange?: (drafts: DraftTag[]) => void;
  /** A filter rather than a field to tag with (the export menu): only existing tags,
   *  a new name neither becomes one nor points at the Tags dashboard. */
  existingOnly?: boolean;
}

export type DraftTag = Pick<TagRow, 'id' | 'name' | 'color'>;

/** Creates the drafts still in `tags` and returns the list with their real IDs. */
export async function commitDraftTags(tags: string[], drafts: DraftTag[]): Promise<string[]> {
  const { ensureTag } = useTagStore.getState();
  const result: string[] = [];
  for (const id of tags) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) { result.push(id); continue; }
    // ensureTag finds a tag of the same name, even one from the trash (keeping its own colour);
    // the draft's colour only goes to a tag that is really new.
    const tag = await ensureTag(draft.name, undefined, draft.color);
    result.push(tag.id);
  }
  return [...new Set(result)];
}

export default function TagInput({ tags, onChange, readOnly = false, chipSize = 'default', flush = false, drafts, onDraftsChange, existingOnly = false }: TagInputProps) {
  const { t } = useTranslation();
  const { tags: allTags, ensureTag, getByName } = useTagStore(
    useShallow((s) => ({ tags: s.tags, ensureTag: s.ensureTag, getByName: s.getByName }))
  );
  const activeDrafts = (drafts ?? []).filter((d) => tags.includes(d.id));
  const tagMap = useTagMap();
  // In the order of `tags`, drafts among the real ones.
  const shown = tags
    .map((id) => tagMap.get(id) ?? activeDrafts.find((d) => d.id === id))
    .filter((tag): tag is DraftTag => !!tag);
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
  const draftByName = (name: string) => activeDrafts.find((d) => tagNameKey(d.name) === tagNameKey(name));
  const inputMatchesTag = !!trimmedInput && (!!getByName(trimmedInput) || !!draftByName(trimmedInput));

  const addTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) { setInput(''); return; }
    const pick = (id: string) => {
      onChange([...new Set([...tags, id])]);
      setInput('');
      setOpen(false);
    };
    // A filter picks from existing tags only; a typed new name adds nothing.
    if (existingOnly) {
      const existing = getByName(trimmed);
      if (existing) pick(existing.id);
      return;
    }
    // Without permission to create, only existing tags; the hint in the menu below
    // says where new ones come from.
    if (!createInline && !getByName(trimmed)) { setOpen(true); return; }
    if (onDraftsChange && !getByName(trimmed)) {
      const draft = draftByName(trimmed) ?? { id: generateId(), name: trimmed, color: randomTagColor() };
      onDraftsChange([...activeDrafts.filter((d) => d.id !== draft.id), draft]);
      pick(draft.id);
      return;
    }
    // ensureTag finds "foo" also as "Foo". Always write: if it fetches a
    // tag from the trash, it also takes it out of this entry, and the
    // list here would then be stale.
    pick((await ensureTag(trimmed)).id);
  };

  const removeTag = (id: string) => {
    onChange(tags.filter((t) => t !== id));
    if (drafts?.some((d) => d.id === id)) onDraftsChange?.(drafts.filter((d) => d.id !== id));
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

  // Close dropdown on outside click. Escape is not handled here but in the
  // input's onKeyDown (see handleKeyDown).
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

  const menu = open && ((input && !existingOnly) || suggestions.length > 0) && (
    <div className="absolute top-full left-0 mt-1 z-50 bg-well-solid border border-edge-default rounded-lg shadow-menu min-w-[160px] py-1">
      {suggestions.map((t) => (
        <button
          key={t.id}
          onMouseDown={(e) => { e.preventDefault(); addTag(t.name); }}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-well-raise flex items-center gap-2"
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: t.color }}
          />
          {t.name}
        </button>
      ))}
      {trimmedInput && !inputMatchesTag && !existingOnly && (createInline ? (
        <button
          onMouseDown={(e) => { e.preventDefault(); addTag(input); }}
          className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-well-raise"
        >
          {t('tags.createNamed', { name: trimmedInput })}
        </button>
      ) : (
        <button
          onMouseDown={(e) => { e.preventDefault(); setOpen(false); setActiveView({ type: 'tags' }); }}
          className="w-full text-left px-3 py-1.5 text-xs text-muted hover:bg-well-raise"
        >
          {t('tags.unknownOpenDashboard', { name: trimmedInput })}
        </button>
      ))}
    </div>
  );

  // Editing happens in the sidebar (`TagsField`), in dialogs (`flush`, with drafts) and in a filter (`existingOnly`): the chips (24px,
  // with a round "×") stand on their own, with the field "Add tag …" below.
  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1">
      {shown.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 pt-0.5 pb-1 ${flush ? '' : 'pl-2.5 pr-3'}`}>
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
      {/* Indented like the sidebar's rows, not like its headings. */}
      <div className={`sidebar-add-field ${flush ? '' : 'ml-[9px] mr-3'}`}>
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
