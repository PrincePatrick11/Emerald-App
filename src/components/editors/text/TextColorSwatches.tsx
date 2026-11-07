import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { TEXT_COLORS, type TextColor } from '../../../lib/textColors';

/**
 * The text colours to pick from, in the selection menu and under the
 * toolbar's colour button: first the default colour (struck through), then
 * the six names, whose shades the theme sets.
 */
export default function TextColorSwatches({ current, onPick }: {
  current: TextColor | null;
  onPick: (color: TextColor | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        className={`editor-color-swatch editor-color-swatch--none${current === null ? ' editor-color-swatch--active' : ''}`}
        title={t('editor.menu.defaultColor')}
        onClick={() => onPick(null)}
      />
      {TEXT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`editor-color-swatch${current === color ? ' editor-color-swatch--active' : ''}`}
          style={{ background: `var(--editor-color-${color})` }}
          title={t(`editor.colors.${color}`)}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

/** The colour button's icon, in the colour at the cursor. */
export function TextColorIcon({ color }: { color: TextColor | null }) {
  return <Palette size={14} style={color ? { color: `var(--editor-color-${color})` } : undefined} />;
}
