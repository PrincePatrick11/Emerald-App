import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Flame, Pencil, Trash2 } from 'lucide-react';
import { formatEntryDate } from '../../lib/formatDate';
import type { TFunction } from 'i18next';
import type { AltarPlacement, AltarRecord } from '../../types';
import { resolveResolutionPixels } from '../../lib/altarConstants';
import { AltarCardPreview } from './AltarCardPreview';
import { AltarRenameField } from './AltarRenameField';
import { imageSrc } from '../../lib/images';
import { FaviconGlyph } from '../sidebar/fields/Favicon';

const baseClass = 'panel-interactive text-left';

/** Bezugsmaß der Leinwand-Vorschau je Kartenbreite: Höhendeckel für das
 *  Thumbnail, Breitendeckel für die Live-Vorschau (die ein aspect-ratio-Kasten
 *  ist und sich nur über die Breite steuern lässt). Die breite Karte füllt die
 *  ganze Spalte, deshalb darf sie so hoch werden, dass man den Altar wirklich
 *  erkennt; im Dreier-Raster bliebe dieselbe Höhe nur ein Briefmarkenbild
 *  neben einer überlangen Karte. Der Icon-Platzhalter unten hat eigene, viel
 *  kleinere Höhen — er soll die Vorschau ersetzen, nicht ihren Platz halten. */
const PREVIEW_BASE = { normal: 176, wide: 380 } as const;

/** Platzhalter, wenn die Vorschau abgeschaltet ist (uiStore.altarShowPreview):
 *  das Icon, das der Altar in seinen Eigenschaften trägt — und nur wenn er
 *  keines hat, das Modul-Icon. Bewusst niedriger als die Vorschau: ein leerer
 *  Kasten in Vorschaugröße wäre nur Luft. */
function PreviewFallback({ altar, wide }: { altar: AltarRecord; wide?: boolean }) {
  return (
    // Ohne Rahmen: der Rahmen gehört zur Vorschau, deren Kante er zeigt. Um
    // ein freistehendes Icon wäre er ein leerer Kasten. Die Höhe bleibt, damit
    // die Karten mit und ohne Icon gleich hoch sind; 32px ist die dekorative
    // Icon-Stufe der Leerzustände (design.md), nicht die UI-Skala.
    <div className={`flex items-center justify-center ${wide ? 'h-24' : 'h-20'}`}>
      {altar.icon_data
        ? <FaviconGlyph value={altar.icon_data} className={wide ? 'h-16 w-16 text-5xl' : 'h-12 w-12 text-4xl'} />
        : <Flame size={32} className="text-stone-600" />}
    </div>
  );
}

/** Dasselbe eine Stufe kleiner, für die Listenzeile. */
function ListPreviewFallback({ altar }: { altar: AltarRecord }) {
  return altar.icon_data
    ? <FaviconGlyph value={altar.icon_data} />
    : <Flame size={14} className="text-stone-600" />;
}

type AltarCardProps = CommonProps & {
  /** Karten in voller Breite: höhere Vorschau, sonst dieselbe Karte. */
  wide?: boolean;
};

type CommonProps = {
  altar: AltarRecord;
  previewItems: AltarPlacement[];
  /** Aus heißt: Flammen-Icon statt Leinwand-Vorschau. */
  showPreview: boolean;
  isRenaming: boolean;
  renameValue: string;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

export const AltarCard = memo(function AltarCard({
  altar,
  previewItems,
  showPreview,
  wide,
  isRenaming,
  renameValue,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onOpen,
  onContextMenu,
}: AltarCardProps) {
  // Abonniert Sprachwechsel für die Datums-Locale — memo ohne t-Prop würde
  // sonst beim Umschalten das alte Format weiterzeigen.
  useTranslation();
  if (isRenaming) {
    return (
      <div className={`${baseClass} px-4 py-4`}>
        <AltarRenameField
          value={renameValue}
          onChange={onChangeRename}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          className="mb-2 w-full bg-transparent text-sm font-medium text-stone-200 outline-none selectable"
        />
        <p className="text-xs text-stone-600">{formatEntryDate(altar.updated_at)}</p>
      </div>
    );
  }
  const base = wide ? PREVIEW_BASE.wide : PREVIEW_BASE.normal;
  const { w: resW, h: resH } = resolveResolutionPixels(altar.resolution ?? '1920x1080');
  const thumbnail = imageSrc(altar.thumbnail_data);

  let preview;
  if (!showPreview) {
    preview = <PreviewFallback altar={altar} wide={wide} />;
  } else if (thumbnail) {
    preview = <img src={thumbnail} alt="" draggable={false} style={{ maxHeight: base }}
      className="w-auto max-w-full mx-auto block rounded-lg border border-stone-700/40" />;
  } else {
    // Die Live-Vorschau ist ein aspect-ratio-Kasten in voller Breite; über
    // maxWidth statt maxHeight gedeckelt, weil ein höhenbegrenzter Kasten sie
    // nur beschneiden würde.
    preview = (
      <div className="mx-auto w-full" style={{ maxWidth: base * (resW / resH) }}>
        <AltarCardPreview altar={altar} previewItems={previewItems} />
      </div>
    );
  }

  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} w-full px-4 py-4`}>
      <div className="mb-3">{preview}</div>
      <div className="text-sm font-medium text-stone-200 truncate">{altar.title}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="text-parchment-500/70">{formatEntryDate(altar.updated_at)}</span>
      </div>
      {altar.intention && (
        <p className="mt-2 max-h-8 overflow-hidden text-xs leading-4 text-stone-500">{altar.intention}</p>
      )}
    </button>
  );
});

export const AltarListRow = memo(function AltarListRow({
  altar,
  previewItems,
  showPreview,
  isRenaming,
  renameValue,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onOpen,
  onContextMenu,
}: CommonProps) {
  // Siehe AltarCard: Subscription für die Datums-Locale.
  useTranslation();
  if (isRenaming) {
    return (
      <div className={`${baseClass} flex items-center gap-3 px-4 py-3`}>
        <AltarRenameField
          value={renameValue}
          onChange={onChangeRename}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable"
        />
        <span className="text-xs text-parchment-500/70">{formatEntryDate(altar.updated_at)}</span>
      </div>
    );
  }
  const { w: resW, h: resH } = resolveResolutionPixels(altar.resolution ?? '1920x1080');
  const thumbnail = imageSrc(altar.thumbnail_data);

  // Dieselbe Reihenfolge wie auf der Karte, nur auf Zeilenhöhe: Icon statt
  // Vorschau, sonst Thumbnail, sonst die gerechnete Live-Vorschau.
  const preview = !showPreview
    ? <ListPreviewFallback altar={altar} />
    : thumbnail
      ? <img src={thumbnail} alt="" draggable={false}
          className="h-8 rounded object-cover border border-stone-700/40"
          style={{ aspectRatio: `${resW}/${resH}` }} />
      : <AltarCardPreview altar={altar} previewItems={previewItems} compact />;

  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} w-full flex items-center gap-3 px-4 py-3`}>
      <span className="flex-shrink-0">{preview}</span>
      <span className="flex-1 text-sm text-stone-300 truncate">{altar.title}</span>
      <span className="text-xs text-stone-600">{formatEntryDate(altar.updated_at)}</span>
    </button>
  );
});

export function buildAltarContextMenuActions({
  t,
  altar,
  onDuplicate,
  onRename,
  onDelete,
}: {
  t: TFunction;
  altar: AltarRecord;
  onDuplicate: (id: string) => void;
  onRename: (altar: AltarRecord) => void;
  onDelete: (id: string) => void;
}) {
  return [
    { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => onDuplicate(altar.id) },
    { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => onRename(altar) },
    { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(altar.id), danger: true },
  ];
}

