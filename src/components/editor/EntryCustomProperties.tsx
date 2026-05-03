import { useEffect, useState } from 'react';
import { getDb } from '../../lib/db';
import { useCustomPropertyStore } from '../../store/customPropertyStore';
import type { CustomProperty } from '../../types';

interface Props {
  entryId: string;
  entryType: 'journal' | 'wiki' | 'operation';
  isEditing?: boolean;
}

export default function EntryCustomProperties({ entryId, entryType, isEditing = false }: Props) {
  const [props, setProps] = useState<CustomProperty[]>([]);
  const { updateProperty } = useCustomPropertyStore();
  const storeProps = useCustomPropertyStore((s) => s.properties);

  useEffect(() => {
    if (!entryId) return;
    getDb()
      .then((db) =>
        db.select<(Omit<CustomProperty, 'show_in_entry'> & { show_in_entry: number })[]>(
          `SELECT * FROM custom_properties WHERE entry_id=$1 AND entry_type=$2 AND show_in_entry=1 ORDER BY sort_order ASC`,
          [entryId, entryType]
        )
      )
      .then((rows) => setProps(rows.map((r) => ({ ...r, show_in_entry: r.show_in_entry !== 0 }))))
      .catch(() => {});
  }, [entryId, entryType, storeProps]);

  if (props.length === 0) return null;

  const handleUpdate = async (id: string, updates: Partial<Pick<CustomProperty, 'value'>>) => {
    await updateProperty(id, updates);
    setProps((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  return (
    <div className="px-8 pb-3 flex-shrink-0 flex flex-wrap gap-2">
      {props.map((prop) =>
        isEditing ? (
          <EditableProp key={prop.id} prop={prop} onUpdate={handleUpdate} />
        ) : (
          <PropertyBadge key={prop.id} prop={prop} />
        )
      )}
    </div>
  );
}

function EditableProp({
  prop,
  onUpdate,
}: {
  prop: CustomProperty;
  onUpdate: (id: string, updates: Partial<Pick<CustomProperty, 'value'>>) => void;
}) {
  const meta = prop.meta ? JSON.parse(prop.meta) : {};

  if (prop.type === 'toggle') {
    const isChecked = prop.value === '1';
    const trueLabel = meta.trueLabel || 'Yes';
    const falseLabel = meta.falseLabel || 'No';
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-stone-600">{prop.name}</span>
        <button
          onClick={() => onUpdate(prop.id, { value: isChecked ? '0' : '1' })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            isChecked
              ? 'bg-jade-900/40 text-jade-400 border border-jade-800/40 hover:bg-jade-900/60'
              : 'bg-stone-800/60 text-stone-500 border border-stone-700/40 hover:bg-stone-700/60'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-jade-400' : 'bg-stone-600'}`} />
          {isChecked ? trueLabel : falseLabel}
        </button>
      </div>
    );
  }

  if (prop.type === 'checkbox') {
    const isChecked = prop.value === '1';
    return (
      <button
        onClick={() => onUpdate(prop.id, { value: isChecked ? '0' : '1' })}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-stone-800/60 text-stone-400 border border-stone-700/40 hover:bg-stone-700/60 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full transition-colors ${isChecked ? 'bg-jade-400' : 'bg-stone-600'}`} />
        {prop.name}
      </button>
    );
  }

  // text / number / date
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-stone-800/60 border border-stone-700/40">
      <span className="text-xs text-stone-600 flex-shrink-0">{prop.name}:</span>
      <input
        type={prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text'}
        value={prop.value ?? ''}
        onChange={(e) => onUpdate(prop.id, { value: e.target.value || null })}
        placeholder="…"
        className="bg-transparent text-xs text-stone-300 outline-none placeholder-stone-700 min-w-0 w-24 [color-scheme:dark]"
      />
    </div>
  );
}

function PropertyBadge({ prop }: { prop: CustomProperty }) {
  const meta = prop.meta ? JSON.parse(prop.meta) : {};

  if (prop.type === 'toggle') {
    const isChecked = prop.value === '1';
    const label = isChecked ? (meta.trueLabel || 'Yes') : (meta.falseLabel || 'No');
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
          isChecked
            ? 'bg-jade-900/40 text-jade-400 border border-jade-800/40'
            : 'bg-stone-800/60 text-stone-500 border border-stone-700/40'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-jade-400' : 'bg-stone-600'}`} />
        {label}
      </span>
    );
  }

  if (prop.type === 'checkbox') {
    const isChecked = prop.value === '1';
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-stone-800/60 text-stone-400 border border-stone-700/40">
        <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-jade-400' : 'bg-stone-600'}`} />
        {prop.name}
      </span>
    );
  }

  if (!prop.value) return null;

  let displayValue = prop.value;
  if (prop.type === 'date') {
    try { displayValue = new Date(prop.value).toLocaleDateString(); } catch { /* keep raw */ }
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40">
      <span className="text-stone-600">{prop.name}:</span>
      <span className="text-stone-300">{displayValue}</span>
    </span>
  );
}
