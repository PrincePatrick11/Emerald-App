import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, Unlock, Trash2, Copy, GripVertical } from 'lucide-react';
import type { AltarPlacement } from '../../types';
import { AltarItemVisual } from '../altar/AltarItemVisual';
import Button from '../ui/Button';

export const PlacedElementRow = memo(function PlacedElementRow({
  placement,
  isEditing,
  isSelected,
  isDragging,
  onSelect,
  onToggleHidden,
  onToggleLocked,
  onDuplicate,
  onRemove,
  onGripPointerDown,
}: {
  placement: AltarPlacement;
  isEditing: boolean;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onGripPointerDown: (e: React.PointerEvent) => void;
}) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-all cursor-pointer select-none ${
          isDragging
            ? 'border-jade-500/60 bg-jade-900/20 text-stone-300 opacity-50 scale-[0.98]'
            : isSelected
              ? 'border-jade-600/70 bg-jade-900/40 text-jade-300'
              : 'border-stone-700/60 bg-stone-900/45 text-stone-400 hover:border-stone-500/70 hover:text-stone-300'
        }`}
      >
        {isEditing && (
          <span
            onPointerDown={onGripPointerDown}
            className={`flex-shrink-0 cursor-grab active:cursor-grabbing touch-none transition-colors ${isSelected ? 'hover:text-jade-200' : 'text-stone-600 hover:text-stone-400'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={12} />
          </span>
        )}
        <AltarItemVisual item={placement} size={16} candleAnimate={placement.category === 'candle'} />
        <span className="flex-1 truncate text-[11px] font-medium">{placement.name}</span>
        {isEditing && (
          <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onDuplicate}
              className={`transition-colors ${isSelected ? 'hover:text-jade-200' : 'text-stone-500 hover:text-stone-300'}`}
              title={t('altar.duplicateElement')}
            >
              <Copy size={11} />
            </button>
            <button
              onClick={onToggleLocked}
              className={`transition-colors ${placement.locked ? 'text-amber-400 hover:text-amber-300' : isSelected ? 'hover:text-jade-200' : 'text-stone-500 hover:text-stone-300'}`}
              title={placement.locked ? t('altar.unlock') : t('altar.lock')}
            >
              {placement.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
            <button
              onClick={onToggleHidden}
              className={`transition-colors ${placement.hidden ? 'text-stone-300 hover:text-stone-100' : isSelected ? 'hover:text-jade-200' : 'text-stone-500 hover:text-stone-300'}`}
              title={placement.hidden ? t('altar.show') : t('altar.hide')}
            >
              {placement.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <Button
              onClick={onRemove}
              variant="danger"
              className="ml-3"
              title={t('altar.removeElement')}
            >
              <Trash2 size={11} />
            </Button>
          </span>
        )}
      </div>
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="min-w-[140px] rounded-lg border border-stone-700 bg-stone-900 py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => { onDuplicate(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-800"
          >
            {t('altar.duplicateElement')}
          </button>
          <button
            onClick={() => { onRemove(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-stone-800"
          >
            {t('altar.removeElement')}
          </button>
        </div>,
        document.body
      )}
    </>
  );
});

export const PlacedElementInspector = memo(function PlacedElementInspector({
  placement,
  onUpdate,
}: {
  placement: AltarPlacement;
  onUpdate: (patch: { x?: number; y?: number; width?: number; height?: number; rotation?: number; opacity?: number }) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    x: '',
    y: '',
    scalePercent: '',
    rotation: '',
    opacity: '',
  });
  const focusedFieldRef = useRef<string | null>(null);

  useEffect(() => {
    const scalePercent = Math.round((((placement.width + placement.height) / 2) / 40) * 100);
    const f = focusedFieldRef.current;
    setDraft((d) => ({
      x:            f === 'x'            ? d.x            : placement.x.toFixed(1),
      y:            f === 'y'            ? d.y            : placement.y.toFixed(1),
      scalePercent: f === 'scalePercent' ? d.scalePercent : scalePercent.toString(),
      rotation:     f === 'rotation'     ? d.rotation     : placement.rotation.toFixed(0),
      opacity:      f === 'opacity'      ? d.opacity      : Math.round(placement.opacity * 100).toString(),
    }));
  }, [placement.id, placement.x, placement.y, placement.width, placement.height, placement.rotation, placement.opacity]);

  const applyNumber = (key: 'x' | 'y' | 'rotation' | 'opacity', value: string) => {
    const next = Number(value);
    if (Number.isNaN(next)) return;
    if (key === 'x' || key === 'y') {
      const normalized = Math.max(0, Math.min(100, next));
      onUpdate({ [key]: normalized });
      return;
    }
    if (key === 'rotation') {
      const normalized = Math.max(-360, Math.min(360, next));
      onUpdate({ rotation: normalized });
      return;
    }
    const normalizedOpacity = Math.max(0, Math.min(100, next)) / 100;
    onUpdate({ opacity: normalizedOpacity });
  };

  const applyScalePercent = (value: string) => {
    const percent = Number(value);
    if (Number.isNaN(percent)) return;
    const normalized = (Math.max(10, Math.min(1250, percent)) / 100) * 40;
    onUpdate({ width: normalized, height: normalized });
  };

  const bindInput = (field: keyof typeof draft, apply: () => void) => ({
    value: draft[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setDraft((current) => ({ ...current, [field]: event.target.value }));
    },
    onFocus: () => { focusedFieldRef.current = field; },
    onBlur: () => { focusedFieldRef.current = null; apply(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur();
    },
  });

  const inputClass = 'w-full rounded border border-stone-700/50 bg-stone-800/50 px-1.5 py-1 text-[11px] text-stone-200 outline-none focus:border-stone-500/60 placeholder:text-stone-600';

  const opacityPercent = Math.max(5, Math.min(100, Number(draft.opacity) || 100));

  return (
    <div className="rounded border border-stone-700/50 bg-stone-900/40 px-2 py-1.5 space-y-1.5">
      <div className="grid grid-cols-4 gap-1">
        {([
          { field: 'x'            as const, label: t('altar.inspectorX'),        apply: () => applyNumber('x', draft.x),             unit: '%' },
          { field: 'y'            as const, label: t('altar.inspectorY'),        apply: () => applyNumber('y', draft.y),             unit: '%' },
          { field: 'rotation'     as const, label: t('altar.inspectorRotation'), apply: () => applyNumber('rotation', draft.rotation), unit: '°' },
          { field: 'scalePercent' as const, label: t('altar.inspectorScale'),    apply: () => applyScalePercent(draft.scalePercent),  unit: '%' },
        ]).map(({ field, label, apply, unit }) => (
          <label key={field} className="space-y-0.5">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">{label}</span>
            <div className="relative">
              <input {...bindInput(field, apply)} className={inputClass + (unit ? ' pr-4' : '')} aria-label={field} />
              {unit && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-stone-500 pointer-events-none">{unit}</span>}
            </div>
          </label>
        ))}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorOpacity')}</span>
          <span className="text-[10px] tabular-nums text-stone-300">{opacityPercent}%</span>
        </div>
        <div className="relative h-4 flex items-center">
          <div className="absolute inset-x-0 h-1 rounded-full bg-stone-800/80" />
          <div className="absolute left-0 h-1 rounded-full bg-jade-600/60" style={{ width: `${opacityPercent}%` }} />
          <div
            className="absolute h-2.5 w-2.5 rounded-full bg-jade-500 border border-jade-400/50 shadow pointer-events-none"
            style={{ left: `calc(${opacityPercent}% - 5px)` }}
          />
          <input
            type="range"
            min={5}
            max={100}
            value={opacityPercent}
            onChange={(e) => {
              const val = e.target.value;
              setDraft((d) => ({ ...d, opacity: val }));
              applyNumber('opacity', val);
            }}
            className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4"
          />
        </div>
      </div>
    </div>
  );
});
