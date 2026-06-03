import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Trash2 } from 'lucide-react';
import type { AltarPlacement } from '../../types';
import { AltarItemVisual } from '../altar/AltarItemVisual';

export const PlacedElementRow = memo(function PlacedElementRow({
  placement,
  isEditing,
  isSelected,
  onSelect,
  onToggleHidden,
  onToggleLocked,
  onRemove,
}: {
  placement: AltarPlacement;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onSelect}
      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${isSelected ? 'bg-stone-700/70 text-stone-100' : 'bg-stone-900/40 text-stone-300 hover:bg-stone-800/60'}`}
    >
      <AltarItemVisual item={placement} size={16} candleAnimate={placement.category === 'candle'} />
      <span className="flex-1 truncate text-xs">{placement.name}</span>
      <span className="text-[10px] text-stone-500">z{placement.z_index}</span>
      {isEditing && <span className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
        <button
          onClick={onToggleHidden}
          className="text-stone-500 hover:text-stone-300"
          title={placement.hidden ? t('altar.show') : t('altar.hide')}
        >
          {placement.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button
          onClick={onToggleLocked}
          className="text-stone-500 hover:text-stone-300"
          title={placement.locked ? t('altar.unlock') : t('altar.lock')}
        >
          {placement.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          onClick={onRemove}
          className="text-stone-500 hover:text-red-400"
          title={t('altar.removeElement')}
        >
          <Trash2 size={12} />
        </button>
      </span>}
    </div>
  );
});

export const PlacedElementInspector = memo(function PlacedElementInspector({
  placement,
  onUpdate,
  onBringToFront,
  onBringForward,
  onSendBackward,
  onSendToBack,
}: {
  placement: AltarPlacement;
  onUpdate: (patch: { x?: number; y?: number; width?: number; height?: number; rotation?: number; opacity?: number; z_index?: number }) => void;
  onBringToFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendToBack: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    x: '',
    y: '',
    scalePercent: '',
    rotation: '',
    opacity: '',
    zIndex: '',
  });

  useEffect(() => {
    const scalePercent = Math.round((((placement.width + placement.height) / 2) / 40) * 100);
    setDraft({
      x: placement.x.toFixed(1),
      y: placement.y.toFixed(1),
      scalePercent: scalePercent.toString(),
      rotation: placement.rotation.toFixed(0),
      opacity: Math.round(placement.opacity * 100).toString(),
      zIndex: placement.z_index.toString(),
    });
  }, [placement.id]);

  const applyNumber = (key: 'x' | 'y' | 'rotation' | 'opacity' | 'z_index', value: string) => {
    const next = Number(value);
    if (Number.isNaN(next)) return;
    if (key === 'z_index') {
      const normalized = Math.max(0, Math.round(next));
      setDraft((current) => ({ ...current, zIndex: normalized.toString() }));
      onUpdate({ z_index: normalized });
      return;
    }
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
    onBlur: apply,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur();
    },
  });

  return (
    <div className="rounded-lg border border-stone-700/60 bg-stone-900/40 p-2.5 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{t('altar.inspector')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorX')}</span>
          <input {...bindInput('x', () => applyNumber('x', draft.x))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="x" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorY')}</span>
          <input {...bindInput('y', () => applyNumber('y', draft.y))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="y" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorScale')}</span>
          <input {...bindInput('scalePercent', () => applyScalePercent(draft.scalePercent))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="scale" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorRotation')}</span>
          <input {...bindInput('rotation', () => applyNumber('rotation', draft.rotation))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="rotation" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorOpacity')}</span>
          <input {...bindInput('opacity', () => applyNumber('opacity', draft.opacity))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="opacity" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorZIndex')}</span>
          <input {...bindInput('zIndex', () => applyNumber('z_index', draft.zIndex))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="z-index" />
        </label>
      </div>
      <div className="grid grid-cols-4 gap-1">
        <button onClick={onBringToFront} className="btn-ghost" title={t('altar.toFront')}><ChevronsUp size={12} /></button>
        <button onClick={onBringForward} className="btn-ghost" title={t('altar.forward')}><ArrowUp size={12} /></button>
        <button onClick={onSendBackward} className="btn-ghost" title={t('altar.backward')}><ArrowDown size={12} /></button>
        <button onClick={onSendToBack} className="btn-ghost" title={t('altar.toBack')}><ChevronsDown size={12} /></button>
      </div>
    </div>
  );
});
