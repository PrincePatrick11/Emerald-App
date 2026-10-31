import { useTranslation } from 'react-i18next';
import { AltarCardPreview } from '../altar/AltarCardPreview';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { linkFromSlot } from '../../lib/blocks/fields';
import { imageSrc } from '../../lib/images';
import { viewTypeForEntryType } from '../../lib/modules';
import type { AltarPlacement, AltarRecord } from '../../types';
import { LinkEditor } from './BlockLink';

/**
 * The altar field: a linked altar with its image, the stored
 * thumbnail that the altar view computes when it is left; if that is missing (an
 * altar that was never finished editing), the card's drawn preview.
 * Only the link chip is stored in the slot; the image comes from the altar
 * store when displayed, because it changes with every edit of the altar.
 */

const NO_PLACEMENTS: AltarPlacement[] = [];

/** The altar the chip in the slot points to, along with placements for the drawn preview. */
function useLinkedAltar(slot: string | undefined) {
  const link = linkFromSlot(slot);
  const id = link?.entryType === 'altar' ? link.id : null;
  const altar = useAltarStore((s) => (id ? s.altars.find((a) => a.id === id) : undefined));
  const placements = useAltarStore((s) => (id ? s.previewPlacements[id] : undefined)) ?? NO_PLACEMENTS;
  return { link, altar, placements };
}

function AltarPicture({ altar, placements }: { altar: AltarRecord; placements: AltarPlacement[] }) {
  const thumbnail = imageSrc(altar.thumbnail_data);
  if (thumbnail) return <img src={thumbnail} alt="" draggable={false} className="block-altar-image" />;
  return <AltarCardPreview altar={altar} previewItems={placements} />;
}

/** Editing: the altar search, below it the image of the chosen one. `onChange(null)` removes it. */
export function AltarFieldEditor({ slot, onChange }: { slot: string | undefined; onChange: (html: string | null) => void }) {
  const { t } = useTranslation();
  const { altar, placements } = useLinkedAltar(slot);
  return (
    <div className="space-y-2">
      <LinkEditor slot={slot} entryType="altar" placeholder={t('blocks.altar.search')} onChange={onChange} />
      {altar && <div className="block-altar"><AltarPicture altar={altar} placements={placements} /></div>}
    </div>
  );
}

/** Reading: the image with the name below it; a click opens the altar. */
export function AltarFieldReader({ slot }: { slot: string | undefined }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const { link, altar, placements } = useLinkedAltar(slot);
  if (!link) return null;
  if (!altar) return <span className="block-field-hint">{t('blocks.altar.missing', { name: link.label })}</span>;
  return (
    <button
      type="button"
      className="block-altar"
      onClick={() => setActiveView({ type: viewTypeForEntryType('altar'), id: altar.id, mode: 'view' })}
      title={t('blocks.altar.open')}
    >
      <AltarPicture altar={altar} placements={placements} />
      <span className="block-altar-title">{altar.title || t('altar.untitled')}</span>
    </button>
  );
}
