import { useTranslation } from 'react-i18next';
import { imageSrc } from '../../lib/images';
import { setImageDragItem } from '../../lib/imageDragState';
import type { VaultImage } from '../../types';

interface Props {
  file: string;
  /** Its row in "Images"; without one the file is only in the vault. */
  image: VaultImage | null;
  onClick?: () => void;
  /** Dragging out (onto a canvas); only where something takes it. */
  draggable?: boolean;
  /** Smaller, for a strip beside a canvas. */
  compact?: boolean;
}

/**
 * A picture of "Images": the image over its name — the picture is its own icon. One tile for the view
 * (click to edit) and for a canvas's strip (drag out).
 */
export default function ImageTile({ file, image, onClick, draggable, compact }: Props) {
  const { t } = useTranslation();
  const name = image?.name || '';
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      onPointerDown={draggable ? (e) => { if (e.button === 0) { e.preventDefault(); setImageDragItem({ file, image }); } } : undefined}
      data-image-id={image?.id}
      title={name || t('images.unnamed')}
      className={`image-tile ${compact ? 'image-tile--compact' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="image-tile-picture">
        <img src={imageSrc(file)} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
      <div className="image-tile-label">
        <span className={`truncate ${name ? 'text-soft' : 'text-subtle italic'}`}>{name || t('images.unnamed')}</span>
      </div>
    </div>
  );
}
