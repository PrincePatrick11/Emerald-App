import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useOperationStore } from '../../../store/operationStore';

export default function LinkedOpsInput({
  ids, onChange, inputCls,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  inputCls: string;
}) {
  const { t } = useTranslation();
  const operations = useOperationStore((s) => s.operations);
  const categories = useOperationStore((s) => s.categories);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() =>
    operations
      .filter((o) => !ids.includes(o.id) && !o.deleted_at &&
        o.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8),
    [operations, ids, query]);

  const selectedOps = useMemo(() =>
    ids.map((id) => operations.find((o) => o.id === id)).filter(Boolean) as typeof operations,
    [ids, operations]);

  return (
    <div ref={ref} className="space-y-1.5">
      {/* Selected chips */}
      {selectedOps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedOps.map((op) => {
            const cat = categories.find((c) => c.id === op.category_id);
            const opIcon = op.icon || cat?.emoji || '⚡';
            return (
              <span key={op.id} className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-stone-800/60 border border-stone-700/40 text-stone-300">
                {opIcon.startsWith('data:')
                  ? <img src={opIcon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
                  : <span>{opIcon}</span>}
                <span className="truncate max-w-[110px]">{op.title}</span>
                <button
                  onClick={() => onChange(ids.filter((i) => i !== op.id))}
                  className="text-stone-600 hover:text-stone-400 ml-0.5 flex-shrink-0"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={t('search.operations')}
          className={inputCls}
        />
        {open && (
          <div className="linked-entry-menu absolute top-full left-0 right-0 mt-1 z-50 border border-stone-700/60 rounded-lg shadow-xl py-1 max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-stone-600 px-3 py-2">{t('search.noResultsShort')}</p>
            ) : filtered.map((op) => {
              const cat = categories.find((c) => c.id === op.category_id);
              const opIcon = op.icon || cat?.emoji || '⚡';
              return (
                <button
                  key={op.id}
                  onMouseDown={(e) => { e.preventDefault(); onChange([...ids, op.id]); setQuery(''); setOpen(false); }}
                  className="linked-entry-menu-item w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-stone-400 hover:text-stone-200"
                >
                  {opIcon.startsWith('data:')
                    ? <img src={opIcon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
                    : <span>{opIcon}</span>}
                  <span className="truncate">{op.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
