import type { GlyphSource } from '../../lib/blocks/presets';
import { isImageIcon } from '../../lib/helpers';

/**
 * Das Zeichen eines Blocks — ein lucide-Icon, oder das Icon eines eigenen
 * Blocks (Emoji oder Bild) in derselben Größe. Rahmen, Verwaltungsliste und
 * Blöcke-Ansicht zeigen es gleich.
 */
export default function BlockGlyph({ icon, size = 12 }: { icon: GlyphSource; size?: number }) {
  if (typeof icon === 'string') {
    if (isImageIcon(icon)) {
      return <img src={icon} alt="" aria-hidden="true" className="flex-shrink-0 rounded-sm object-cover" style={{ width: size, height: size }} />;
    }
    return <span className="block-glyph-emoji" style={{ fontSize: size }} aria-hidden="true">{icon}</span>;
  }
  const Icon = icon;
  return <Icon size={size} className="flex-shrink-0" />;
}
