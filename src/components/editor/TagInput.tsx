import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTagStore } from '../../store/tagStore';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
}

export default function TagInput({ tags, onChange, readOnly = false }: TagInputProps) {
  const { tags: allTags, ensureTag, getByName } = useTagStore();
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = allTags.filter(
    (t) =>
      t.name.toLowerCase().includes(input.toLowerCase()) &&
      !tags.includes(t.name)
  );

  const addTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || tags.includes(trimmed)) { setInput(''); return; }
    await ensureTag(trimmed);
    onChange([...tags, trimmed]);
    setInput('');
    setOpen(false);
  };

  const removeTag = (name: string) => {
    onChange(tags.filter((t) => t !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close dropdown on outside click
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (readOnly) {
    if (tags.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((name) => {
          const tag = getByName(name);
          return (
            <span
              key={name}
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: tag ? `${tag.color}20` : '#ffffff10',
                color: tag?.color ?? '#a8a29e',
                border: `1px solid ${tag ? `${tag.color}40` : '#ffffff20'}`,
              }}
            >
              {name}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative flex flex-wrap gap-1.5 items-center">
      {tags.map((name) => {
        const tag = getByName(name);
        return (
          <span
            key={name}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: tag ? `${tag.color}20` : '#ffffff10',
              color: tag?.color ?? '#a8a29e',
              border: `1px solid ${tag ? `${tag.color}40` : '#ffffff20'}`,
            }}
          >
            {name}
            <button
              onClick={() => removeTag(name)}
              className="opacity-60 hover:opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </span>
        );
      })}

      <input
        ref={inputRef}
        value={input}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        className="bg-transparent text-xs text-stone-400 placeholder-stone-700 outline-none min-w-[80px] flex-1 selectable"
      />

      {open && (input || suggestions.length > 0) && (
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
          {input.trim() && !allTags.find((t) => t.name.toLowerCase() === input.toLowerCase()) && (
            <button
              onMouseDown={(e) => { e.preventDefault(); addTag(input); }}
              className="w-full text-left px-3 py-1.5 text-xs text-jade-400 hover:bg-stone-700"
            >
              + Create "{input.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
