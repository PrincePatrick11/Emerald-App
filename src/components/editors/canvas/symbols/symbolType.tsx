import { useTranslation } from 'react-i18next';
import { PaintBucket, PenLine, Sparkles } from 'lucide-react';
import PopoverButton from '../../shared/PopoverButton';
import { ToolbarGroup, ToolbarStepper } from '../../shared/toolbarParts';
import type { CanvasAddition, CanvasElement, CanvasElementType } from '../types';
import { attrs, num } from '../svg';
import { ColorPanel, common } from '../elements/controlParts';
import { DEFAULT_FILL } from '../elements/shape';
import { SYMBOL_PACKS, type SymbolDef } from './packs';
import { DEFAULT_WEIGHT, MAX_WEIGHT, MIN_WEIGHT } from './limits';
import SymbolPicker, { SymbolGlyph, symbolName } from './SymbolPicker';

/**
 * A symbol from the library: its path in a box of 100 × 100, drawn as lines
 * of `weight` (in those units) in `color`, its closed parts filled with
 * `fill` if set. The path is kept with the element, so it draws even where
 * its pack is not installed.
 */
export interface SymbolProps {
  /** `pack.name` in the library. */
  symbol: string;
  d: string;
  /** Parts filled in `color`, under the lines. */
  solid?: string;
  color: string;
  weight: number;
  fill: string | null;
}

export type SymbolElement = CanvasElement<SymbolProps>;

/** The library's pick for the next symbol drawn with the tool column's symbol tool. */
let chosen: SymbolDef = SYMBOL_PACKS[0].symbols[0];

const paths = new Map<string, Path2D>();
function pathOf(d: string): Path2D {
  let path = paths.get(d);
  if (!path) {
    path = new Path2D(d);
    paths.set(d, path);
  }
  return path;
}

function SymbolControls({ elements, update }: {
  elements: SymbolElement[];
  update: (patch: (el: SymbolElement) => Partial<SymbolElement> | null) => void;
}) {
  const { t } = useTranslation();
  const set = (props: Partial<SymbolProps>) => update((el) => ({ props: { ...el.props, ...props } }));
  const color = common(elements, (el) => el.props.color);
  const fill = common(elements, (el) => el.props.fill);
  const weight = common(elements, (el) => el.props.weight);
  const symbol = common(elements, (el) => el.props.symbol);
  return (
    <ToolbarGroup>
      <PopoverButton icon={<SymbolGlyph d={elements[0].props.d} solid={elements[0].props.solid} size={15} />} title={t('symbols.swap')} active={false}>
        {(close) => <SymbolPicker current={symbol} onPick={(s) => { set({ symbol: s.id, d: s.d, solid: s.solid }); close(); }} />}
      </PopoverButton>
      <PopoverButton icon={<PenLine size={14} style={color ? { color } : undefined} />} title={t('symbols.lineColor')} active={false}>
        {(close) => <ColorPanel value={color} onPick={(c) => { if (c) set({ color: c }); close(); }} />}
      </PopoverButton>
      <PopoverButton icon={<PaintBucket size={14} style={fill ? { color: fill } : undefined} />} title={t('canvas.fill')} active={false}>
        {(close) => <ColorPanel value={fill} allowNone onPick={(c) => { set({ fill: c }); close(); }} />}
      </PopoverButton>
      <ToolbarStepper
        value={weight ?? DEFAULT_WEIGHT}
        min={MIN_WEIGHT}
        max={MAX_WEIGHT}
        onChange={(w) => set({ weight: w })}
        label={t('symbols.weight')}
      />
    </ToolbarGroup>
  );
}

const addition: CanvasAddition<SymbolProps> = {
  key: 'symbol',
  shortcut: 'y',
  icon: <Sparkles size={14} />,
  label: (t) => t('symbols.title'),
  picker: ({ onPicked }) => <SymbolPicker current={chosen.id} onPick={(s) => { chosen = s; onPicked(); }} />,
  create: (_centre, artboard) => {
    const side = Math.round(Math.min(artboard.width, artboard.height) * 0.18);
    return {
      width: side,
      height: side,
      props: { symbol: chosen.id, d: chosen.d, ...(chosen.solid ? { solid: chosen.solid } : {}), color: DEFAULT_FILL, weight: DEFAULT_WEIGHT, fill: null },
    };
  },
};

export const symbolType: CanvasElementType<SymbolProps> = {
  type: 'symbol',
  label: (el, t) => symbolName(el.props.symbol, t),
  keepRatio: true,
  handles: 'corners',
  draw: (ctx, el) => {
    const p = el.props;
    const path = pathOf(p.d);
    ctx.scale(el.width / 100, el.height / 100);
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill(path, 'evenodd');
    }
    if (p.solid) {
      ctx.fillStyle = p.color;
      ctx.fill(pathOf(p.solid));
    }
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.weight;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  },
  svg: (el) => {
    const p = el.props;
    const transform = `scale(${num(el.width / 100)} ${num(el.height / 100)})`;
    const solid = p.solid ? `<path${attrs({ d: p.solid, transform, fill: p.color })}/>` : '';
    return solid + `<path${attrs({
      d: p.d, transform,
      fill: p.fill ?? 'none', 'fill-rule': p.fill ? 'evenodd' : null,
      stroke: p.color, 'stroke-width': p.weight, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    })}/>`;
  },
  additions: [addition],
  controls: SymbolControls,
};
