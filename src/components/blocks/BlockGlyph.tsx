import type { GlyphSource } from '../../lib/blocks/presets';
import { isImageIcon } from '../../lib/helpers';
import { iconSrc } from '../../lib/icons';

/**
 * The glyph of a block: a lucide icon, or the icon of a custom
 * block (emoji or image) at the same size. Frame, management list and
 * blocks view show it the same way.
 */
export default function BlockGlyph({ icon, size = 12 }: { icon: GlyphSource; size?: number }) {
  if (typeof icon === 'string') {
    if (isImageIcon(icon)) {
      return <img src={iconSrc(icon)} alt="" aria-hidden="true" className="flex-shrink-0 rounded-sm object-contain" style={{ width: size, height: size }} />;
    }
    return <span className="block-glyph-emoji" style={{ fontSize: size }} aria-hidden="true">{icon}</span>;
  }
  const Icon = icon;
  return <Icon size={size} className="flex-shrink-0" />;
}
