import { useTranslation } from 'react-i18next';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Type } from 'lucide-react';
import PopoverButton from '../../shared/PopoverButton';
import { ToolbarBtn, ToolbarGroup } from '../../shared/toolbarParts';
import type { CanvasElement, CanvasElementType } from '../types';
import { ColorPanel, NumberField, common } from './controlParts';

export const CANVAS_FONTS = ['serif', 'book', 'sans'] as const;
export type CanvasFont = (typeof CANVAS_FONTS)[number];
export type CanvasTextAlign = 'left' | 'center' | 'right';

/** Text that wraps at the box's width; the height follows the lines. */
export interface TextProps {
  text: string;
  font: CanvasFont;
  fontSize: number;
  color: string;
  align: CanvasTextAlign;
  bold: boolean;
  italic: boolean;
}

export type TextElement = CanvasElement<TextProps>;

export const DEFAULT_TEXT_COLOR = '#f4ecd8';

/** The CSS families behind the fonts — all bundled with the app (`fonts.css`). */
export const FONT_FAMILIES: Record<CanvasFont, string> = {
  serif: '"Cormorant Garamond", Georgia, serif',
  book: 'Lora, Georgia, serif',
  sans: 'Inter, system-ui, sans-serif',
};

export const TEXT_LINE_HEIGHT = 1.25;

export function fontString(p: Pick<TextProps, 'font' | 'fontSize' | 'bold' | 'italic'>): string {
  return `${p.italic ? 'italic ' : ''}${p.bold ? 600 : 400} ${p.fontSize}px ${FONT_FAMILIES[p.font]}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * The lines of a text box: explicit line breaks, then words wrapped at
 * `width`; a word wider than that breaks between characters.
 */
export function layoutText(p: TextProps, width: number): string[] {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  const paragraphs = p.text.split('\n');
  if (!ctx) return paragraphs;
  ctx.font = fontString(p);
  const max = Math.max(1, width);
  const fits = (s: string) => ctx.measureText(s).width <= max;
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (fits(line + token)) {
        line += token;
        continue;
      }
      // Spaces at a break vanish.
      if (!token.trim()) {
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (fits(token)) {
        line = token;
        continue;
      }
      for (const char of token) {
        if (line && !fits(line + char)) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The height a text box of `width` needs. */
export function textHeight(p: TextProps, width: number): number {
  return Math.max(1, layoutText(p, width).length) * p.fontSize * TEXT_LINE_HEIGHT;
}

const ALIGN_TITLES: Record<CanvasTextAlign, string> = {
  left: 'editor.toolbar.alignLeft',
  center: 'editor.toolbar.alignCenter',
  right: 'editor.toolbar.alignRight',
};

function TextControls({ elements, update }: {
  elements: TextElement[];
  update: (patch: (el: TextElement) => Partial<TextElement> | null) => void;
}) {
  const { t } = useTranslation();
  const set = (props: (p: TextProps) => Partial<TextProps>) => update((el) => ({ props: { ...el.props, ...props(el.props) } }));
  const font = common(elements, (el) => el.props.font);
  const align = common(elements, (el) => el.props.align);
  const color = common(elements, (el) => el.props.color);
  const bold = elements.every((el) => el.props.bold);
  const italic = elements.every((el) => el.props.italic);
  return (
    <ToolbarGroup>
      <PopoverButton
        icon={<span className="editor-toolbar-btn-label">{font ? t(`canvas.font.${font}`) : t('canvas.fontMixed')}</span>}
        title={t('canvas.fontTitle')}
        active={false}
      >
        {(close) => (
          <div className="canvas-panel">
            {CANVAS_FONTS.map((key) => (
              <button
                key={key}
                type="button"
                className={`canvas-font-option ${font === key ? 'canvas-font-option-active' : ''}`}
                style={{ fontFamily: FONT_FAMILIES[key] }}
                onClick={() => { set(() => ({ font: key })); close(); }}
              >
                {t(`canvas.font.${key}`)}
              </button>
            ))}
          </div>
        )}
      </PopoverButton>
      <NumberField
        inline
        label={t('canvas.fontSize')}
        value={common(elements, (el) => el.props.fontSize)}
        min={4}
        max={1000}
        onChange={(value) => set(() => ({ fontSize: value }))}
      />
      <ToolbarBtn onClick={() => set(() => ({ bold: !bold }))} active={bold} title={t('editor.toolbar.bold')}><Bold size={14} /></ToolbarBtn>
      <ToolbarBtn onClick={() => set(() => ({ italic: !italic }))} active={italic} title={t('editor.toolbar.italic')}><Italic size={14} /></ToolbarBtn>
      {(['left', 'center', 'right'] as const).map((value) => (
        <ToolbarBtn key={value} onClick={() => set(() => ({ align: value }))} active={align === value} title={t(ALIGN_TITLES[value])}>
          {value === 'left' ? <AlignLeft size={14} /> : value === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
        </ToolbarBtn>
      ))}
      <PopoverButton
        icon={<span className="canvas-color-dot" style={{ background: color ?? 'transparent' }} />}
        title={t('canvas.textColor')}
        active={false}
      >
        {(close) => <ColorPanel value={color ?? null} onPick={(picked) => { if (picked) set(() => ({ color: picked })); close(); }} />}
      </PopoverButton>
    </ToolbarGroup>
  );
}

export const textType: CanvasElementType<TextProps> = {
  type: 'text',
  label: (el, t) => el.props.text.split('\n')[0].trim() || t('canvas.newText'),
  keepRatio: true,
  handles: 'corners-and-sides',
  draw: (ctx, el) => {
    const p = el.props;
    const lineHeight = p.fontSize * TEXT_LINE_HEIGHT;
    ctx.font = fontString(p);
    ctx.fillStyle = p.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = p.align;
    const x = p.align === 'left' ? 0 : p.align === 'right' ? el.width : el.width / 2;
    layoutText(p, el.width).forEach((line, i) => ctx.fillText(line, x, i * lineHeight + lineHeight / 2));
  },
  fitHeight: (el) => textHeight(el.props, el.width),
  fonts: (el) => [fontString(el.props)],
  // A corner scales the font with the box; the sides only change the width.
  scaled: (el, _sx, sy) => ({ props: { ...el.props, fontSize: Math.max(4, Math.round(el.props.fontSize * sy * 10) / 10) } }),
  textEdit: {
    get: (el) => el.props.text,
    set: (el, text) => ({ ...el.props, text }),
    style: (el) => ({
      fontFamily: FONT_FAMILIES[el.props.font],
      fontSize: el.props.fontSize,
      fontWeight: el.props.bold ? 600 : 400,
      fontStyle: el.props.italic ? 'italic' : 'normal',
      lineHeight: TEXT_LINE_HEIGHT,
      color: el.props.color,
      textAlign: el.props.align,
    }),
  },
  additions: [{
    key: 'text',
    icon: <Type size={14} />,
    label: (t) => t('canvas.addText'),
    create: (_centre, artboard, t) => {
      const props: TextProps = {
        text: t('canvas.newText'), font: 'serif', fontSize: Math.max(12, Math.round(artboard.height / 14)),
        color: DEFAULT_TEXT_COLOR, align: 'center', bold: false, italic: false,
      };
      const width = Math.round(artboard.width * 0.4);
      return { width, height: textHeight(props, width), props };
    },
  }],
  controls: TextControls,
};
