import type { PointerEvent, MouseEvent, ReactNode } from 'react';
import { EyeOff, GripVertical, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GlyphSource } from '../../lib/blocks/presets';
import BlockGlyph from './BlockGlyph';

interface BlockFrameProps {
  isEditing: boolean;
  icon: GlyphSource;
  /** The instance's own title or the type name. */
  label: string;
  /** Hidden: gone in read mode, greyed out in edit mode. */
  hidden: boolean;
  /** Show the title in read mode (the block's display rule). */
  showReadTitle: boolean;
  onGripPointerDown: (e: PointerEvent) => void;
  onOpenMenu: (e: MouseEvent) => void;
  children: ReactNode;
}

/**
 * The shell around a block. Invisible in read mode: the blocks flow like
 * a document, at most with a discreet title above. In
 * edit mode a frame with a handle for moving, title and menu.
 *
 * The content sits at the same place in the tree in both modes: if the
 * structure changed with the mode, React would remount the block, and a text block
 * would lose its editor along with unsaved input. For the same reason
 * a hidden block is hidden via CSS in read mode, not
 * omitted.
 */
export default function BlockFrame({
  isEditing, icon, label, hidden, showReadTitle, onGripPointerDown, onOpenMenu, children,
}: BlockFrameProps) {
  const { t } = useTranslation();
  const className = [
    'block-frame',
    isEditing && 'block-frame--editing',
    hidden && 'block-frame--hidden',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      {isEditing ? (
        <div className="block-frame-header">
          <button
            type="button"
            className="block-frame-grip"
            onPointerDown={onGripPointerDown}
            title={t('blocks.dragToMove')}
            aria-label={t('blocks.dragToMove')}
          >
            <GripVertical size={14} />
          </button>
          <BlockGlyph icon={icon} />
          <span className="block-frame-label">{label}</span>
          {hidden && (
            <span className="block-frame-hidden-mark" title={t('blocks.hiddenHint')}>
              <EyeOff size={12} />
            </span>
          )}
          <button
            type="button"
            className="block-frame-menu"
            onClick={onOpenMenu}
            title={t('blocks.actions')}
            aria-label={t('blocks.actions')}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      ) : showReadTitle ? (
        <div className="label-xs block-read-title">{label}</div>
      ) : null}
      <div className="block-frame-body">{children}</div>
    </div>
  );
}
