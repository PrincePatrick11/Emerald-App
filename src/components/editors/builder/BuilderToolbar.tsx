import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter, AlignHorizontalDistributeCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart, AlignLeft, AlignRight, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDown, ArrowUp, Ban, Bold, BringToFront, Circle, Copy,
  Hexagon, ImageDown, Italic, Layers2, Maximize, PaintBucket, Redo2, SendToBack, Shapes, Square, SquareDashed, Star,
  Trash2, Triangle, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { PopoverButton, ToolbarBtn, ToolbarDivider, ToolbarGroup } from '../text/toolbarParts';
import type { BuilderController } from './BuilderEditor';
import {
  BUILDER_FONTS, BUILDER_SHAPES, type BuilderShapeElement, type BuilderShapeType,
  type BuilderTextElement,
} from './types';
import type { AlignEdge } from './builderActions';

/** Colours for shapes and text: metals, parchment, and the colours of the old correspondences. */
export const BUILDER_SWATCHES = [
  '#d4af37', '#c0c0c0', '#b87333', '#f4ecd8', '#ffffff',
  '#8b1e2d', '#c65d1e', '#2e7d5b', '#1e3a6e', '#5b3a7a',
  '#0b0b0f', '#3a3a44',
] as const;

const SHAPE_ICONS: Record<BuilderShapeType, ReactNode> = {
  rect: <Square size={14} />,
  ellipse: <Circle size={14} />,
  triangle: <Triangle size={14} />,
  star: <Star size={14} />,
  hexagon: <Hexagon size={14} />,
};

const ALIGN_ICONS: Record<AlignEdge, ReactNode> = {
  left: <AlignHorizontalJustifyStart size={14} />,
  hcenter: <AlignHorizontalJustifyCenter size={14} />,
  right: <AlignHorizontalJustifyEnd size={14} />,
  top: <AlignVerticalJustifyStart size={14} />,
  vcenter: <AlignVerticalJustifyCenter size={14} />,
  bottom: <AlignVerticalJustifyEnd size={14} />,
};

/** The one value all elements share, or `undefined` when they differ. */
function common<T, V>(items: readonly T[], read: (item: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((item) => read(item) === first) ? first : undefined;
}

/**
 * The builder's bar. Like the text editor's, it shows what the builder can do
 * (`features`) and what the selection allows: in the order of working,
 * undo, what is added (shapes, text), how the selection looks (fill and
 * outline, or font, size, style, alignment and colour of text), where it sits
 * (stacking, aligning), duplicating and removing, and the view at the far end.
 */
export default function BuilderToolbar({ controller: c, end }: { controller: BuilderController; end?: ReactNode }) {
  const { t } = useTranslation();
  const f = c.features;
  const editable = c.selected.filter((el) => !el.locked);
  const shapes = editable.filter((el): el is BuilderShapeElement => el.kind === 'shape');
  const texts = editable.filter((el): el is BuilderTextElement => el.kind === 'text');
  const hasSelection = editable.length > 0;

  const updateShapes = (patch: Partial<BuilderShapeElement>) => c.update((el) => (el.kind === 'shape' ? patch : null));
  const updateTexts = (patch: (el: BuilderTextElement) => Partial<BuilderTextElement>) =>
    c.update((el) => (el.kind === 'text' ? patch(el) : null));

  const fill = common(shapes, (el) => el.fill);
  const stroke = common(shapes, (el) => el.stroke);
  const strokeWidth = common(shapes, (el) => el.strokeWidth);
  const font = common(texts, (el) => el.font);
  const textAlign = common(texts, (el) => el.align);
  const textColor = common(texts, (el) => el.color);
  const bold = texts.length > 0 && texts.every((el) => el.bold);
  const italic = texts.length > 0 && texts.every((el) => el.italic);
  const fontSize = common(texts, (el) => el.fontSize);

  return (
    <div className="editor-toolbar builder-toolbar">
      {f.history && (<>
        <ToolbarGroup>
          <ToolbarBtn onClick={c.undo} active={false} disabled={!c.canUndo} title={t('editor.toolbar.undo')}><Undo2 size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={c.redo} active={false} disabled={!c.canRedo} title={t('editor.toolbar.redo')}><Redo2 size={14} /></ToolbarBtn>
        </ToolbarGroup>
        <ToolbarDivider />
      </>)}

      {(f.shapes || f.text) && (<>
        <ToolbarGroup>
          {f.shapes && (
            <PopoverButton icon={<Shapes size={14} />} title={t('builder.addShape')} active={false}>
              {(close) => (
                <ToolbarGroup>
                  {BUILDER_SHAPES.map((shape) => (
                    <ToolbarBtn key={shape} onClick={() => { c.addShape(shape); close(); }} active={false} title={t(`builder.shape.${shape}`)}>
                      {SHAPE_ICONS[shape]}
                    </ToolbarBtn>
                  ))}
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          {f.text && <ToolbarBtn onClick={c.addText} active={false} title={t('builder.addText')}><Type size={14} /></ToolbarBtn>}
        </ToolbarGroup>
        <ToolbarDivider />
      </>)}

      {shapes.length > 0 && (<>
        <ToolbarGroup>
          <PopoverButton
            icon={<PaintBucket size={14} style={fill ? { color: fill } : undefined} />}
            title={t('builder.fill')}
            active={false}
          >
            {(close) => <ColorPanel value={fill} allowNone onPick={(color) => { updateShapes({ fill: color }); close(); }} />}
          </PopoverButton>
          <PopoverButton
            icon={<SquareDashed size={14} style={stroke ? { color: stroke } : undefined} />}
            title={t('builder.outline')}
            active={false}
          >
            {(close) => (
              <div className="builder-panel">
                <ColorPanel value={stroke} allowNone onPick={(color) => { updateShapes({ stroke: color }); if (!color) close(); }} />
                <NumberRow
                  label={t('builder.outlineWidth')}
                  value={strokeWidth}
                  min={0}
                  max={80}
                  onChange={(value) => updateShapes({ strokeWidth: value })}
                />
                {shapes.every((el) => el.shape === 'rect') && (
                  <NumberRow
                    label={t('builder.cornerRadius')}
                    value={common(shapes, (el) => el.cornerRadius)}
                    min={0}
                    max={400}
                    onChange={(value) => updateShapes({ cornerRadius: value })}
                  />
                )}
              </div>
            )}
          </PopoverButton>
        </ToolbarGroup>
        <ToolbarDivider />
      </>)}

      {texts.length > 0 && (<>
        <ToolbarGroup>
          <PopoverButton
            icon={<span className="editor-toolbar-btn-label">{font ? t(`builder.font.${font}`) : t('builder.fontMixed')}</span>}
            title={t('builder.fontTitle')}
            active={false}
          >
            {(close) => (
              <div className="builder-panel">
                {BUILDER_FONTS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`builder-font-option ${font === key ? 'builder-font-option-active' : ''}`}
                    style={{ fontFamily: FONT_PREVIEW[key] }}
                    onClick={() => { updateTexts(() => ({ font: key })); close(); }}
                  >
                    {t(`builder.font.${key}`)}
                  </button>
                ))}
              </div>
            )}
          </PopoverButton>
          <input
            className="editor-inline-input builder-size-input"
            type="number"
            min={4}
            max={1000}
            value={fontSize !== undefined ? Math.round(fontSize) : ''}
            placeholder="–"
            title={t('builder.fontSize')}
            aria-label={t('builder.fontSize')}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (value >= 4) updateTexts(() => ({ fontSize: Math.min(1000, value) }));
            }}
          />
          <ToolbarBtn onClick={() => updateTexts(() => ({ bold: !bold }))} active={bold} title={t('editor.toolbar.bold')}><Bold size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => updateTexts(() => ({ italic: !italic }))} active={italic} title={t('editor.toolbar.italic')}><Italic size={14} /></ToolbarBtn>
          {(['left', 'center', 'right'] as const).map((value) => (
            <ToolbarBtn key={value} onClick={() => updateTexts(() => ({ align: value }))} active={textAlign === value} title={t(`editor.toolbar.align${value[0].toUpperCase()}${value.slice(1)}`)}>
              {value === 'left' ? <AlignLeft size={14} /> : value === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
            </ToolbarBtn>
          ))}
          <PopoverButton
            icon={<span className="builder-color-dot" style={{ background: textColor ?? 'transparent' }} />}
            title={t('builder.textColor')}
            active={false}
          >
            {(close) => <ColorPanel value={textColor ?? null} onPick={(color) => { if (color) updateTexts(() => ({ color })); close(); }} />}
          </PopoverButton>
        </ToolbarGroup>
        <ToolbarDivider />
      </>)}

      {hasSelection && (<>
        <ToolbarGroup>
          {f.arrange && (
            <PopoverButton icon={<Layers2 size={14} />} title={t('builder.arrange')} active={false}>
              {(close) => (
                <ToolbarGroup>
                  <ToolbarBtn onClick={() => { c.arrange('front'); close(); }} active={false} title={t('builder.toFront')}><BringToFront size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => c.arrange('forward')} active={false} title={t('builder.forward')}><ArrowUp size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => c.arrange('backward')} active={false} title={t('builder.backward')}><ArrowDown size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => { c.arrange('back'); close(); }} active={false} title={t('builder.toBack')}><SendToBack size={14} /></ToolbarBtn>
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          {f.align && (
            <PopoverButton
              icon={<AlignHorizontalJustifyCenter size={14} />}
              title={editable.length > 1 ? t('builder.alignSelection') : t('builder.alignArtboard')}
              active={false}
            >
              {() => (
                <ToolbarGroup>
                  {(Object.keys(ALIGN_ICONS) as AlignEdge[]).map((edge) => (
                    <ToolbarBtn key={edge} onClick={() => c.align(edge)} active={false} title={t(`builder.align.${edge}`)}>
                      {ALIGN_ICONS[edge]}
                    </ToolbarBtn>
                  ))}
                  {editable.length > 2 && (<>
                    <ToolbarDivider />
                    <ToolbarBtn onClick={() => c.distribute('horizontal')} active={false} title={t('builder.distributeHorizontal')}><AlignHorizontalDistributeCenter size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => c.distribute('vertical')} active={false} title={t('builder.distributeVertical')}><AlignVerticalDistributeCenter size={14} /></ToolbarBtn>
                  </>)}
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          <ToolbarBtn onClick={c.duplicate} active={false} title={t('builder.duplicate')}><Copy size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={c.removeSelected} active={false} title={t('builder.remove')}><Trash2 size={14} /></ToolbarBtn>
        </ToolbarGroup>
      </>)}

      <div className="editor-toolbar-end">
        {f.zoom && (
          <ToolbarGroup>
            <ToolbarBtn onClick={c.zoomOut} active={false} title={t('builder.zoomOut')}><ZoomOut size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={c.fit} active={false} title={t('builder.fit')}>
              <span className="editor-toolbar-btn-label tabular-nums">{Math.round(c.zoom * 100)}%</span>
            </ToolbarBtn>
            <ToolbarBtn onClick={c.zoomIn} active={false} title={t('builder.zoomIn')}><ZoomIn size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={c.fit} active={false} title={t('builder.fit')}><Maximize size={14} /></ToolbarBtn>
          </ToolbarGroup>
        )}
        {f.export && c.onExport && (<>
          <ToolbarDivider />
          <ToolbarBtn onClick={c.onExport} active={false} title={t('builder.export')}><ImageDown size={14} /></ToolbarBtn>
        </>)}
        {end}
      </div>
    </div>
  );
}

const FONT_PREVIEW: Record<(typeof BUILDER_FONTS)[number], string> = {
  serif: '"Cormorant Garamond", serif',
  book: 'Lora, serif',
  sans: 'Inter, sans-serif',
};

/** Swatches, "none" where it is allowed, and the system's picker for any other colour. */
function ColorPanel({ value, allowNone = false, onPick }: {
  value: string | null | undefined;
  allowNone?: boolean;
  onPick: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="builder-swatches">
      {allowNone && (
        <button type="button" className={`builder-swatch builder-swatch-none ${value === null ? 'builder-swatch-active' : ''}`} title={t('builder.noColor')} onClick={() => onPick(null)}>
          <Ban size={12} />
        </button>
      )}
      {BUILDER_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          className={`builder-swatch ${value === color ? 'builder-swatch-active' : ''}`}
          style={{ background: color }}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
      <label className="builder-swatch builder-swatch-custom" title={t('builder.customColor')}>
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

function NumberRow({ label, value, min, max, onChange }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="builder-number-row">
      <span>{label}</span>
      <input
        className="editor-inline-input builder-size-input"
        type="number"
        min={min}
        max={max}
        value={value !== undefined ? Math.round(value) : ''}
        placeholder="–"
        onChange={(e) => {
          const next = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
        }}
      />
    </label>
  );
}

