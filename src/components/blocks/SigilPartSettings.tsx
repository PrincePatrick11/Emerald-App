import { useTranslation } from 'react-i18next';
import Dropdown from '../ui/Dropdown';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import { CALC_MODES, type CalcMode, type ChargeDefault, type ElementDef } from '../../lib/blocks/fields';
import BlockCheckbox from './BlockCheckbox';
import { DEFAULT_BRUSH_SIZE, SigilBrushSize, SigilColorSwatches } from './SigilBrushControls';
import { SIGIL_COLORS } from './SigilDrawingCanvas';

type Patch = (p: Partial<ElementDef>) => void;

/**
 * What a sigil part lets you set in the builder: the calculator its
 * mode, the drawing its colour and brush at the start, the charge its default:
 * the lock and what it conceals. `siblings` are the visible elements of the
 * block from which the charge picks its targets.
 */
export default function SigilPartSettings({ element, siblings, onPatch }: {
  element: ElementDef;
  siblings: readonly ElementDef[];
  onPatch: Patch;
}) {
  switch (element.kind) {
    case 'sigilCalc':
      return <CalcSettings element={element} onPatch={onPatch} />;
    case 'sigilCanvas':
      return <CanvasSettings element={element} onPatch={onPatch} />;
    case 'sigilCharge':
      return <ChargeSettings element={element} siblings={siblings} onPatch={onPatch} />;
    default:
      return null;
  }
}

function CalcSettings({ element, onPatch }: { element: ElementDef; onPatch: Patch }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="label-xs">{t('blocks.library.calcMode')}</p>
      <Dropdown<CalcMode>
        portal
        value={element.calcMode ?? 'both'}
        // "Both" is the default; then no value of its own.
        onChange={(mode) => onPatch({ calcMode: mode === 'both' ? undefined : mode })}
        options={CALC_MODES.map((mode) => ({ value: mode, label: t(`blocks.library.calcModes.${mode}`) }))}
      />
    </div>
  );
}

/**
 * As with prefilling: colour and brush exist only once checked. Once checked,
 * both are explicitly in the element, even if they equal the default,
 * otherwise the checkmark would be gone again after saving.
 */
function CanvasSettings({ element, onPatch }: { element: ElementDef; onPatch: Patch }) {
  const { t } = useTranslation();
  const on = element.brushColor !== undefined || element.brushSize !== undefined;
  const color = element.brushColor ?? SIGIL_COLORS[0];
  const size = element.brushSize ?? DEFAULT_BRUSH_SIZE;
  return (
    <>
      <BlockCheckbox
        checked={on}
        onChange={(next) => onPatch(next
          ? { brushColor: color, brushSize: size }
          : { brushColor: undefined, brushSize: undefined })}
        label={t('blocks.library.brushPreset')}
        hint={t('blocks.library.brushPresetHint')}
      />
      {on && (
        <div className="space-y-2">
          <SigilColorSwatches value={color} onChange={(c) => onPatch({ brushColor: c, brushSize: size })} />
          <SigilBrushSize value={size} onChange={(s) => onPatch({ brushColor: color, brushSize: s })} />
        </div>
      )}
    </>
  );
}

function ChargeSettings({ element, siblings, onPatch }: { element: ElementDef; siblings: readonly ElementDef[]; onPatch: Patch }) {
  const { t } = useTranslation();
  const preset = element.defaultValue as ChargeDefault | undefined;
  const tools = siblings.filter((e) => e.kind === 'sigilCalc' || e.kind === 'sigilCanvas');
  const set = (next: ChargeDefault) => onPatch({ defaultValue: next });
  const toggleTool = (id: string, on: boolean) => {
    const current = preset?.targets ?? [];
    set({ lock: preset?.lock ?? 'entry', targets: on ? [...current, id] : current.filter((x) => x !== id) });
  };

  return (
    <>
      <BlockCheckbox
        checked={!!preset}
        onChange={(on) => onPatch({ defaultValue: on ? { lock: 'entry', targets: null } : undefined })}
        label={t('blocks.library.prefill')}
        hint={t('blocks.library.chargePrefillHint')}
      />
      {preset && (
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="label-xs">{t('blocks.sigil.lockScope')}</p>
            <Dropdown<ChargeDefault['lock']>
              portal
              value={preset.lock}
              onChange={(lock) => set({ ...preset, lock })}
              options={[
                { value: 'entry', label: t('blocks.sigil.lockEntry') },
                { value: 'sigil', label: t('blocks.sigil.lockSigil') },
              ]}
            />
          </div>
          <div className="space-y-1">
            <p className="label-xs">{t('blocks.sigil.covers')}</p>
            <BlockCheckbox
              checked={preset.targets === null}
              // Unchecked: targeted at the parts of this block; all of them at the start.
              onChange={(all) => set({ ...preset, targets: all ? null : tools.map((e) => e.id) })}
              label={t('blocks.library.chargeCoversAll')}
            />
            {preset.targets !== null && (tools.length === 0
              ? <p className="block-field-hint">{t('blocks.library.chargeNoTools')}</p>
              : tools.map((tool) => (
                  <BlockCheckbox
                    key={tool.id}
                    checked={preset.targets!.includes(tool.id)}
                    onChange={(on) => toggleTool(tool.id, on)}
                    label={elementLabel(t, tool)}
                  />
                )))}
          </div>
        </div>
      )}
    </>
  );
}
