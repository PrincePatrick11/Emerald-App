import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Pencil, Trash2, Type, Hash, Calendar, ToggleLeft, CheckSquare } from 'lucide-react';
import { useCustomPropertyStore } from '../../store/customPropertyStore';
import { useUndoStore } from '../../store/undoStore';
import type { CustomProperty, CustomPropertyType } from '../../types';

export const PROP_TYPE_ICONS: Record<string, React.ReactNode> = {
  text:     <Type size={12} />,
  number:   <Hash size={12} />,
  date:     <Calendar size={12} />,
  toggle:   <ToggleLeft size={12} />,
  checkbox: <CheckSquare size={12} />,
};

export function CustomPropertiesSection({
  entryId,
  entryType,
}: {
  entryId: string;
  entryType: 'journal' | 'wiki' | 'operation';
}) {
  const { t } = useTranslation();
  const { properties, fetchProperties, addProperty, updateProperty, deleteProperty, restoreProperty } =
    useCustomPropertyStore();
  const pushUndo = useUndoStore((s) => s.push);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CustomPropertyType>('text');
  const [newShowInEntry, setNewShowInEntry] = useState(true);
  const [newTrueLabel, setNewTrueLabel] = useState('');
  const [newFalseLabel, setNewFalseLabel] = useState('');
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!typeDropdownRef.current?.contains(e.target as Node)) setTypeDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    fetchProperties(entryId, entryType);
  }, [entryId, entryType]);

  const resetForm = () => {
    setNewName(''); setNewType('text'); setNewShowInEntry(true);
    setNewTrueLabel(''); setNewFalseLabel(''); setAdding(false);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (newType === 'toggle' && (!newTrueLabel.trim() || !newFalseLabel.trim())) return;
    const meta = newType === 'toggle'
      ? JSON.stringify({ trueLabel: newTrueLabel.trim(), falseLabel: newFalseLabel.trim() })
      : null;
    await addProperty(entryId, entryType, newName.trim(), newType, meta, newShowInEntry);
    resetForm();
  };

  const handleDeleteProperty = async (propId: string) => {
    await deleteProperty(propId);
  };

  const inputCls =
    'w-full bg-stone-800/60 rounded-md px-3 py-1.5 text-xs text-stone-300 outline-none ' +
    'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700 [color-scheme:dark]';

  return (
    <div>
      <p className="label-xs mb-3">{t('properties.custom')}</p>

      {/* Property list */}
      <div className="space-y-3 mb-3">
        {properties.map((prop) => (
          <CustomPropertyRow
            key={prop.id}
            prop={prop}
            onUpdate={updateProperty}
            onDelete={handleDeleteProperty}
            onRestoreProperty={restoreProperty}
            pushUndo={pushUndo}
          />
        ))}
      </div>

      {/* Add form — per entry */}
      {adding ? (
        <div className="space-y-2">
          {/* Name field + type icon dropdown */}
          <div className="flex gap-1.5">
            <div className="relative flex-shrink-0" ref={typeDropdownRef}>
              <button
                onClick={() => setTypeDropdownOpen((o) => !o)}
                title={t(`properties.types.${newType}`)}
                className="w-8 h-8 flex items-center justify-center bg-stone-800/60 rounded-md border border-stone-700/40 hover:border-stone-600 text-stone-400 hover:text-stone-300 transition-colors"
              >
                {PROP_TYPE_ICONS[newType]}
              </button>
              {typeDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl py-1 min-w-[130px]">
                  {(['text', 'number', 'date', 'toggle', 'checkbox'] as CustomPropertyType[]).map((type) => (
                    <button
                      key={type}
                      onMouseDown={(e) => { e.preventDefault(); setNewType(type); setTypeDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-stone-700 transition-colors ${
                        newType === type ? 'text-stone-200' : 'text-stone-400'
                      }`}
                    >
                      {PROP_TYPE_ICONS[type]}
                      {t(`properties.types.${type}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') resetForm();
              }}
              placeholder={t('properties.namePlaceholder')}
              className={inputCls}
            />
          </div>
          {newType === 'toggle' && (
            <div className="flex gap-1 min-w-0">
              <input
                value={newTrueLabel}
                onChange={(e) => setNewTrueLabel(e.target.value)}
                placeholder={t('properties.trueLabelPlaceholder') + ' *'}
                className={`flex-1 min-w-0 bg-stone-800/60 rounded px-2 py-1 text-xs text-stone-400 outline-none border transition-colors placeholder-stone-700 ${!newTrueLabel.trim() ? 'border-red-800/60 focus:border-red-600' : 'border-stone-700/40 focus:border-stone-600'}`}
              />
              <input
                value={newFalseLabel}
                onChange={(e) => setNewFalseLabel(e.target.value)}
                placeholder={t('properties.falseLabelPlaceholder') + ' *'}
                className={`flex-1 min-w-0 bg-stone-800/60 rounded px-2 py-1 text-xs text-stone-400 outline-none border transition-colors placeholder-stone-700 ${!newFalseLabel.trim() ? 'border-red-800/60 focus:border-red-600' : 'border-stone-700/40 focus:border-stone-600'}`}
              />
            </div>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-stone-500 hover:text-stone-400">
            <input
              type="checkbox"
              checked={newShowInEntry}
              onChange={(e) => setNewShowInEntry(e.target.checked)}
              className="accent-jade-500 w-3 h-3"
            />
            {t('properties.showInEntry')}
          </label>
          <div className="flex justify-end gap-1">
            <button onClick={handleAdd} className="flex items-center gap-1 btn-ghost text-jade-400 text-xs">
              <Check size={12} /> {t('properties.add')}
            </button>
            <button onClick={resetForm} className="btn-ghost text-xs">
              <X size={12} />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="sidebar-item w-full text-left text-stone-600 hover:text-stone-300"
        >
          <span className="w-5 text-center flex-shrink-0 text-base leading-none">+</span>
          <span className="flex-1 truncate text-xs">{t('properties.addProperty')}</span>
        </button>
      )}
    </div>
  );
}

function CustomPropertyRow({
  prop,
  onUpdate,
  onDelete,
  onRestoreProperty,
  pushUndo,
}: {
  prop: CustomProperty;
  onUpdate: (id: string, changes: Partial<Pick<CustomProperty, 'name' | 'value' | 'meta' | 'show_in_entry'>>) => void;
  onDelete: (id: string) => Promise<void>;
  onRestoreProperty: (prop: CustomProperty) => Promise<void>;
  pushUndo: (action: import('../../store/undoStore').UndoAction) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(prop.name);

  // Keep nameVal in sync if prop.name changes externally
  useEffect(() => { setNameVal(prop.name); }, [prop.name]);

  const handleNameSubmit = () => {
    if (nameVal.trim() && nameVal.trim() !== prop.name) {
      onUpdate(prop.id, { name: nameVal.trim() });
    } else {
      setNameVal(prop.name);
    }
    setEditing(false);
  };

  const handleDelete = () => {
    const snapshot = { ...prop };
    onDelete(prop.id);
    pushUndo({ id: crypto.randomUUID(), description: t('undo.propertyDeleted'), undo: () => onRestoreProperty(snapshot) });
  };

  const handleToggleValue = () => {
    onUpdate(prop.id, { value: prop.value === '1' ? '0' : '1' });
  };

  const handleShowInEntry = (checked: boolean) => {
    onUpdate(prop.id, { show_in_entry: checked });
  };

  const inputCls =
    'w-full bg-stone-800/60 rounded-md px-3 py-1.5 text-xs text-stone-300 outline-none ' +
    'border border-stone-700/40 focus:border-stone-600 transition-colors [color-scheme:dark] placeholder-stone-700';

  const smallInputCls =
    'flex-1 bg-stone-800/60 rounded px-2 py-1 text-xs text-stone-400 outline-none ' +
    'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700';

  const meta = prop.meta ? JSON.parse(prop.meta) : {};
  const trueLabel  = meta.trueLabel  || '';
  const falseLabel = meta.falseLabel || '';
  const isChecked  = prop.value === '1';
  const displayTrue  = trueLabel  || t('operations.active');
  const displayFalse = falseLabel || t('operations.inactive');
  const updateMeta = (patch: Record<string, string>) =>
    onUpdate(prop.id, { meta: JSON.stringify({ ...meta, ...patch }) });

  return (
    <div>
      {/* ── Edit panel (pencil clicked) ── */}
      {editing ? (
        <div className="bg-stone-800/40 rounded-md p-2 mb-1.5 space-y-2 border border-stone-700/40">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') { setNameVal(prop.name); setEditing(false); }
              }}
              className="flex-1 bg-stone-900/60 rounded px-2 py-1 text-xs text-stone-300 outline-none border border-stone-600 focus:border-stone-500"
            />
            <button onClick={handleNameSubmit} className="flex-shrink-0 text-stone-600 hover:text-jade-400 transition-colors p-0.5" title="Confirm">
              <Check size={12} />
            </button>
            <button onClick={() => { setNameVal(prop.name); setEditing(false); }} className="flex-shrink-0 text-stone-700 hover:text-stone-400 transition-colors p-0.5">
              <X size={12} />
            </button>
          </div>
          {/* Show in entry + delete */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-stone-500 hover:text-stone-400">
              <input
                type="checkbox"
                checked={!!prop.show_in_entry}
                onChange={(e) => handleShowInEntry(e.target.checked)}
                className="accent-jade-500 w-3 h-3"
              />
              {t('properties.showInEntry')}
            </label>
            <button onClick={handleDelete} className="flex items-center gap-1 text-xs text-stone-700 hover:text-red-400 transition-colors">
              <Trash2 size={11} /> Delete
            </button>
          </div>
          {/* Toggle label editors — only in edit mode */}
          {prop.type === 'toggle' && (
            <div className="flex gap-1 min-w-0">
              <input value={trueLabel} onChange={(e) => updateMeta({ trueLabel: e.target.value })} placeholder={t('properties.trueLabelPlaceholder')} className={smallInputCls + ' min-w-0'} />
              <input value={falseLabel} onChange={(e) => updateMeta({ falseLabel: e.target.value })} placeholder={t('properties.falseLabelPlaceholder')} className={smallInputCls + ' min-w-0'} />
            </div>
          )}
        </div>
      ) : (
        /* ── View header (always shown) ── */
        <div className="flex items-center gap-1 mb-1.5">
          <span className="text-stone-700 flex-shrink-0">{PROP_TYPE_ICONS[prop.type]}</span>
          <span className="flex-1 text-xs text-stone-500 truncate">{prop.name}</span>
          {prop.show_in_entry && (
            <span className="w-1.5 h-1.5 rounded-full bg-jade-700 flex-shrink-0" title={t('properties.showInEntry')} />
          )}
          <button onClick={() => setEditing(true)} className="flex-shrink-0 text-stone-700 hover:text-stone-400 transition-colors p-0.5">
            <Pencil size={11} />
          </button>
        </div>
      )}

      {/* ── Value — always directly editable ── */}
      {prop.type === 'toggle' ? (
        <button
          onClick={handleToggleValue}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            isChecked
              ? 'bg-jade-900/40 text-jade-400 border border-jade-800/40'
              : 'bg-stone-800/60 text-stone-500 border border-stone-700/40'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-jade-400' : 'bg-stone-600'}`} />
          {isChecked ? displayTrue : displayFalse}
        </button>
      ) : prop.type === 'checkbox' ? (
        <label className="flex items-center gap-2 cursor-pointer px-1">
          <input
            type="checkbox"
            checked={prop.value === '1'}
            onChange={(e) => onUpdate(prop.id, { value: e.target.checked ? '1' : '0' })}
            className="accent-jade-500 w-3.5 h-3.5"
          />
          <span className="text-xs text-stone-400">{prop.value === '1' ? 'Yes' : 'No'}</span>
        </label>
      ) : (
        <input
          type={prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text'}
          value={prop.value ?? ''}
          onChange={(e) => onUpdate(prop.id, { value: e.target.value || null })}
          placeholder="…"
          className={inputCls}
        />
      )}

    </div>
  );
}
