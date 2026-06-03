import { memo } from 'react';
import { format } from 'date-fns';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AltarPlacement, AltarRecord } from '../../types';
import { AltarCardPreview } from './AltarCardPreview';
import { AltarRenameField } from './AltarRenameField';

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
        <p className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</p>
      </div>
    );
  }
  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} px-4 py-4`}>
      <div className="mb-3">
        <AltarCardPreview altar={altar} previewItems={previewItems} />
      </div>
      <div className="text-sm font-medium text-stone-200 truncate">{altar.title}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
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
        <span className="text-xs text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
      </div>
    );
  }
  return (
    <button onClick={onOpen} onContextMenu={onContextMenu} className={`${baseClass} w-full flex items-center gap-3 px-4 py-3`}>
      <span className="flex-shrink-0">
        <AltarCardPreview altar={altar} previewItems={previewItems} compact />
      </span>
      <span className="flex-1 text-sm text-stone-300 truncate">{altar.title}</span>
      <span className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
    </button>
  );
});

export function AltarContextMenuActions({
  altar,
  onDuplicate,
  onRename,
  onDelete,
}: {
  altar: AltarRecord;
  onDuplicate: (id: string) => void;
  onRename: (altar: AltarRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return [
    { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => onDuplicate(altar.id) },
    { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => onRename(altar) },
    { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(altar.id), danger: true },
  ];
}

export type { AltarCardVariant };
