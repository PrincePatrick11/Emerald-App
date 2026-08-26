import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { formatEntryDate } from '../../lib/formatDate';
import type { TFunction } from 'i18next';
import type { AltarPlacement, AltarRecord } from '../../types';
import { resolveResolutionPixels } from '../../lib/altarConstants';
import { AltarCardPreview } from './AltarCardPreview';
import { AltarRenameField } from './AltarRenameField';
import { imageSrc } from '../../lib/images';

type AltarCardVariant = 'cards' | 'list';

const baseClass = 'panel-interactive text-left';

type CommonProps = {
  altar: AltarRecord;
  previewItems: AltarPlacement[];
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
  isRenaming,
  renameValue,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onOpen,
  onContextMenu,
}: CommonProps) {
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
  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} px-4 py-4`}>
      <div className="mb-3">
        {imageSrc(altar.thumbnail_data)
          ? <img src={imageSrc(altar.thumbnail_data)} alt="" draggable={false}
              className="max-h-44 w-auto max-w-full mx-auto block rounded-lg border border-stone-700/40" />
          : <div className="max-h-44 overflow-hidden rounded-lg"><AltarCardPreview altar={altar} previewItems={previewItems} /></div>}
      </div>
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
  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} w-full flex items-center gap-3 px-4 py-3`}>
      <span className="flex-shrink-0">
        {imageSrc(altar.thumbnail_data)
        ? <img src={imageSrc(altar.thumbnail_data)} alt="" draggable={false}
            className="h-8 rounded object-cover border border-stone-700/40"
            style={{ aspectRatio: `${resW}/${resH}` }} />
        : <AltarCardPreview altar={altar} previewItems={previewItems} compact />}
      </span>
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

export type { AltarCardVariant };
