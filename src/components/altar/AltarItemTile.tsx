import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { isCandleEmoji } from '../../lib/altarConstants';
import { setAltarDragItem } from '../../lib/altarDragState';
import { imageSrc } from '../../lib/images';
import type { AltarItem } from '../../types';

interface Props {
  item: AltarItem;
  /** Ziehen auf die Leinwand — nur im Altar-Editor, wo es eine Leinwand gibt. */
  draggable?: boolean;
  /** Stift beim Hover. Im Dashboard entfällt er, dort öffnet der Klick selbst. */
  onEdit?: () => void;
  /** Klick auf die Kachel — im Dashboard das Bearbeiten-Modal. */
  onClick?: () => void;
}

/**
 * Die 70px-Kachel eines Bibliothekselements: Bild oder Emoji über dem Namen.
 * Eine Kachel für beide Orte — die Leiste im Editor (ziehbar, Stift) und den
 * Bibliotheks-Teil im Dashboard (klickbar).
 */
export function AltarItemTile({ item, draggable, onEdit, onClick }: Props) {
  const { t } = useTranslation();
  const interactionClass = draggable
    ? 'cursor-grab active:cursor-grabbing'
    : onClick
      ? 'cursor-pointer'
      : 'cursor-default opacity-90';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      onPointerDown={draggable ? (e) => { e.preventDefault(); setAltarDragItem(item); } : undefined}
      className={`altar-item-tile w-[70px] h-[85px] rounded-md border border-stone-700/60 bg-stone-900/40 px-1.5 py-2 flex flex-col ${interactionClass} ${onClick ? 'transition-colors hover:border-stone-600 hover:bg-stone-800/40' : ''}`}
    >
      <div className="mb-1 w-full h-12 flex items-center justify-center overflow-hidden rounded-sm bg-stone-950/35">
        {imageSrc(item.image_data)
          ? <img src={imageSrc(item.image_data)} alt="" className="h-full w-full object-contain" draggable={false} />
          : <span className={`leading-none select-none ${isCandleEmoji(item.emoji) ? 'candle-flame' : ''}`} style={{ fontSize: 34 }}>{item.emoji}</span>}
      </div>
      <div className="mt-auto flex items-center gap-1">
        <span className="flex-1 truncate text-[10px] text-stone-300">{item.name}</span>
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="text-stone-600 hover:text-stone-300 transition-colors p-0.5"
            title={t('editor.edit')}
          >
            <Pencil size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
