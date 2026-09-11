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
 * Das Altar-Feld: ein verknüpfter Altar mit seinem Bild — das gespeicherte
 * Vorschaubild, das die Altar-Ansicht beim Verlassen rechnet; fehlt es (ein
 * Altar, der nie fertig bearbeitet wurde), die gezeichnete Vorschau der Karte.
 * Gespeichert ist nur der Link-Chip im Slot; das Bild kommt beim Anzeigen aus
 * dem Altar-Store, weil es sich mit jeder Bearbeitung des Altars ändert.
 */

const NO_PLACEMENTS: AltarPlacement[] = [];

/** Der Altar, auf den der Chip im Slot zeigt — samt Platzierungen für die gezeichnete Vorschau. */
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

/** Bearbeiten: die Altar-Suche, darunter das Bild des gewählten. `onChange(null)` entfernt ihn. */
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

/** Lesen: das Bild mit dem Namen darunter; ein Klick öffnet den Altar. */
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
