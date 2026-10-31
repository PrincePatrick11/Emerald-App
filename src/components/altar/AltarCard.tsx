import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { displayTitle } from '../../lib/entryTitle';
import { Copy, Flame, Pencil, Trash2 } from 'lucide-react';
import { formatEntryDate } from '../../lib/formatDate';
import type { TFunction } from 'i18next';
import type { AltarPlacement, AltarRecord } from '../../types';
import { resolveResolutionPixels } from '../../lib/altarConstants';
import { AltarCardPreview } from './AltarCardPreview';
import RenameField from '../ui/RenameField';
import { imageSrc } from '../../lib/images';
import { FaviconGlyph } from '../sidebar/fields/Favicon';
import DashboardItem from '../ui/DashboardItem';

/** Reference size of the canvas preview per card width: a height cap for the
 *  thumbnail, a width cap for the live preview (which is an aspect-ratio box
 *  and can only be controlled via its width). The wide card fills the whole
 *  column, so it may grow tall enough for the altar to be recognisable; in the
 *  three-column grid the same height would only be a postage-stamp image next
 *  to an overlong card. The icon placeholder below has its own, much smaller
 *  heights: it is meant to replace the preview, not to hold its space. */
const PREVIEW_BASE = { normal: 176, wide: 380 } as const;

/** Placeholder when the preview is switched off (uiStore.altarShowPreview):
 *  the icon the altar carries in its properties, and only if it has none, the
 *  module icon. Deliberately lower than the preview: an empty box the size of
 *  the preview would just be wasted space. */
function PreviewFallback({ altar, wide }: { altar: AltarRecord; wide?: boolean }) {
  return (
    // No border: the border belongs to the preview, whose edge it shows. Around
    // a freestanding icon it would be an empty box. The height stays so that
    // cards with and without an icon are equally tall; 32px is the decorative
    // icon size of the empty states (design.md), not the UI scale.
    <div className={`flex items-center justify-center ${wide ? 'h-24' : 'h-20'}`}>
      {altar.icon_data
        ? <FaviconGlyph value={altar.icon_data} className={wide ? 'h-16 w-16 text-5xl' : 'h-12 w-12 text-4xl'} />
        : <Flame size={32} className="text-stone-600" />}
    </div>
  );
}

/** The same one step smaller, for the list row. */
function ListPreviewFallback({ altar }: { altar: AltarRecord }) {
  return altar.icon_data
    ? <FaviconGlyph value={altar.icon_data} />
    : <Flame size={14} className="text-stone-600" />;
}

type AltarCardProps = CommonProps & {
  /** Full-width cards: taller preview, otherwise the same card. */
  wide?: boolean;
};

type CommonProps = {
  altar: AltarRecord;
  previewItems: AltarPlacement[];
  /** Off means: flame icon instead of the canvas preview. */
  showPreview: boolean;
  isRenaming: boolean;
  renameValue: string;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

/** Where click and middle click lead. AltarView loads the altar itself via
 *  its `activeView.id` effect, as when opening from the sidebar. */
const altarView = (altar: AltarRecord) => ({ type: 'altar', id: altar.id, mode: 'view' } as const);

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
  onContextMenu,
}: AltarCardProps) {
  // Also subscribes to language changes for the date locale; memo without a t prop
  // would otherwise keep showing the old format after switching.
  const { t } = useTranslation();
  if (isRenaming) {
    return (
      <DashboardItem view={altarView(altar)} layout="card" editing>
        <RenameField
          value={renameValue}
          onChange={onChangeRename}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          className="mb-2 w-full bg-transparent text-sm font-medium text-stone-200 outline-none selectable"
        />
        <p className="text-xs text-stone-600">{formatEntryDate(altar.updated_at)}</p>
      </DashboardItem>
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
    // The live preview is a full-width aspect-ratio box; capped via
    // maxWidth instead of maxHeight, because a height-limited box would
    // only crop it.
    preview = (
      <div className="mx-auto w-full" style={{ maxWidth: base * (resW / resH) }}>
        <AltarCardPreview altar={altar} previewItems={previewItems} />
      </div>
    );
  }

  return (
    <DashboardItem view={altarView(altar)} layout="card" onContextMenu={onContextMenu}>
      <div className="mb-3">{preview}</div>
      <div className="text-sm font-medium text-stone-200 truncate">{displayTitle(t, 'altar', altar.title)}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="text-parchment-500/70">{formatEntryDate(altar.updated_at)}</span>
      </div>
    </DashboardItem>
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
  onContextMenu,
}: CommonProps) {
  // See AltarCard: also the subscription for the date locale.
  const { t } = useTranslation();
  if (isRenaming) {
    return (
      <DashboardItem view={altarView(altar)} layout="row" editing>
        <RenameField
          value={renameValue}
          onChange={onChangeRename}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable"
        />
        <span className="text-xs text-parchment-500/70">{formatEntryDate(altar.updated_at)}</span>
      </DashboardItem>
    );
  }
  const { w: resW, h: resH } = resolveResolutionPixels(altar.resolution ?? '1920x1080');
  const thumbnail = imageSrc(altar.thumbnail_data);

  // The same order as on the card, just at row height: icon instead of
  // preview, otherwise thumbnail, otherwise the computed live preview.
  const preview = !showPreview
    ? <ListPreviewFallback altar={altar} />
    : thumbnail
      ? <img src={thumbnail} alt="" draggable={false}
          className="h-8 rounded object-cover border border-stone-700/40"
          style={{ aspectRatio: `${resW}/${resH}` }} />
      : <AltarCardPreview altar={altar} previewItems={previewItems} compact />;

  return (
    <DashboardItem view={altarView(altar)} layout="row" onContextMenu={onContextMenu}>
      <span className="flex-shrink-0">{preview}</span>
      <span className="flex-1 text-sm text-stone-300 truncate">{displayTitle(t, 'altar', altar.title)}</span>
      <span className="text-xs text-stone-600">{formatEntryDate(altar.updated_at)}</span>
    </DashboardItem>
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

