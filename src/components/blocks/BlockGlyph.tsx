import type { GlyphSource } from '../../lib/blocks/presets';

/**
 * Das Zeichen eines Blocks — ein lucide-Icon, oder das Emoji eines eigenen
 * Blocks in derselben Größe. Rahmen, Verwaltungsliste und Blöcke-Ansicht
 * zeigen es gleich.
 */
export default function BlockGlyph({ icon, size = 12 }: { icon: GlyphSource; size?: number }) {
  if (typeof icon === 'string') {
    return <span className="block-glyph-emoji" style={{ fontSize: size }} aria-hidden="true">{icon}</span>;
  }
  const Icon = icon;
  return <Icon size={size} className="flex-shrink-0" />;
}
