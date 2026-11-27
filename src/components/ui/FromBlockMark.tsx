import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { AUX_VIEWS } from '../../lib/modules';

/** The icon of a value that comes from a block: the rail's "Blocks" icon. */
export const FROM_BLOCK_ICON = AUX_VIEWS.blocks.icon;

/**
 * The tooltip of something a block gives: "From the block “X”" — or, with
 * `fixed`, that the block sets it and it cannot be changed here. Without a
 * name (a block that is gone, several unnamed) it says "From a block".
 */
export function fromBlockTitle(t: TFunction, name: string, fixed = false): string {
  if (!name) return t('properties.fromBlockUnnamed');
  return t(fixed ? 'properties.fromBlockFixed' : 'properties.fromBlock', { name });
}

/**
 * The small mark of a value that comes from a block (properties panel, tag
 * chips); the tooltip names the block. `className` is appended: a tag chip
 * gives it the chip's colour.
 */
export default function FromBlockMark({ name, fixed = false, className }: { name: string; fixed?: boolean; className?: string }) {
  const { t } = useTranslation();
  const title = fromBlockTitle(t, name, fixed);
  const Icon = FROM_BLOCK_ICON;
  return (
    <span className={`from-block-mark${className ? ` ${className}` : ''}`} title={title} aria-label={title} role="img">
      <Icon size={12} aria-hidden />
    </span>
  );
}
