import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseBlocks } from '../../../lib/blocks/blockHtml';
import { blockLabel } from '../../../lib/blocks/blockAttrs';
import { resolveBlockType } from '../../../lib/blocks/blockTypes';
import { entryBlockSummary } from '../../../lib/blocks/entrySummary';
import type { BlockSuggestions } from '../../../lib/blocks/entryProperties';
import { blockValueText } from '../../../lib/blockValueText';
import { valueLabel } from '../../../lib/blocks/blockType';
import { SidebarPropertyRow } from './SidebarSection';
import FromBlockMark, { FROM_BLOCK_ICON } from '../../ui/FromBlockMark';
import type { BlockTagChip } from '../../ui/TagInput';
import type { Entry } from '../../../types';

/**
 * What an entry's blocks put into its properties panel (interface 3): the
 * values they suggest for icon and cover, their rows, the tags they give —
 * each marked as the block's (the rail's "Blocks" icon, the block's name as
 * tooltip). The panel builds the display; the blocks only deliver values.
 */

export interface EntryBlockSources {
  suggestions: BlockSuggestions;
  /** The name of the entry's block with this ID ("" if gone). */
  blockName: (blockId: string) => string;
  /** The tags the blocks give that the user has not given too. */
  blockTags: BlockTagChip[];
}

export function useEntryBlockSources(entry: Entry): EntryBlockSources {
  const { t } = useTranslation();
  const { content, tags, block_tags: blockTagIds } = entry;
  const suggestions = entryBlockSummary(entry).properties;
  const needsBlocks = suggestions.icon || suggestions.cover || suggestions.rows.length > 0 || (blockTagIds?.length ?? 0) > 0;
  // Parsed only when something is the blocks' — most entries have nothing of theirs here.
  const blocks = useMemo(() => (needsBlocks ? parseBlocks(content) : []), [needsBlocks, content]);
  const blockName = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    return block ? blockLabel(t, block, resolveBlockType(block)) : '';
  };
  const blockTags = (blockTagIds ?? []).filter((id) => !tags.includes(id)).map((id) => {
    const givers = blocks.filter((b) => resolveBlockType(b)?.properties?.tags?.(b).includes(id));
    return { id, blockName: givers.map((b) => blockLabel(t, b, resolveBlockType(b))).join(', ') };
  });
  return { suggestions, blockName, blockTags };
}

/** The rows the entry's visible blocks add, in stack order — the same rows in reading and editing. */
export function BlockPropertyRows({ sources }: { sources: EntryBlockSources }) {
  const { t } = useTranslation();
  return (
    <>
      {sources.suggestions.rows.map((row) => {
        const Icon = row.icon ?? FROM_BLOCK_ICON;
        const value = blockValueText(t, row.value);
        return (
          <SidebarPropertyRow
            key={`${row.blockId}:${row.key}`}
            icon={<Icon size={14} />}
            label={valueLabel(row, t)}
            value={<><span className="min-w-0 truncate" title={value}>{value}</span><FromBlockMark name={sources.blockName(row.blockId)} /></>}
          />
        );
      })}
    </>
  );
}
