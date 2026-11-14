import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LinkedEntryPicker, { LinkedEntryChip, LinkItemIcon } from '../sidebar/fields/LinkedEntryPicker';
import { useUIStore } from '../../store/uiStore';
import { useLinkItems } from '../../hooks/useLinkItems';
import { linkFromSlot } from '../../lib/blocks/fields';
import { internalLinkChipHtml, toInternalLinkChip } from '../../lib/internalLinkHtml';
import { isValidLinkTarget } from '../../lib/links';
import { linkItemKey, linkItemsByKey, type SuggestionItem } from '../../lib/linkItems';
import { viewOfLinkTarget } from '../../store/entryViews';

/**
 * A reference to an entry inside a block, stored as
 * a real link chip in the markup (slot), so that the link table, backlinks and
 * merge import see it. Shared by the field block's link field and the
 * sigil's charging technique.
 */

/** This many suggestions the search shows, like the sidebar's links field. */
const LINK_RESULT_LIMIT = 50;

/**
 * Editing: the chosen entry with "×", otherwise the search. `onChange(null)`
 * removes it.
 */
export function LinkEditor({ slot, onChange }: {
  slot: string | undefined;
  onChange: (html: string | null) => void;
}) {
  const { t } = useTranslation();
  const items = useLinkItems();
  const [query, setQuery] = useState('');
  const current = linkFromSlot(slot);

  const results = useMemo(() => {
    const q = query.toLowerCase();
    return items
      .filter((i) => i.label.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, LINK_RESULT_LIMIT);
  }, [items, query]);

  if (current) return <LinkTarget target={current} onRemove={() => onChange(null)} />;
  return (
    <LinkedEntryPicker<SuggestionItem>
      results={results}
      resultKey={linkItemKey}
      onSelect={(item) => onChange(internalLinkChipHtml(toInternalLinkChip(item)))}
      query={query}
      onQueryChange={setQuery}
      placeholder={t('linkPicker.searchPlaceholder')}
      renderResult={(item) => (
        <>
          <LinkItemIcon item={item} />
          <span className="flex-1 truncate">{item.label}</span>
        </>
      )}
    />
  );
}

/** A linked entry, with current title and icon as long as it exists. */
export function LinkTarget({ target, onRemove }: { target: { id: string; entryType: string; label: string }; onRemove?: () => void }) {
  const { t } = useTranslation();
  const items = useLinkItems();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const { id, entryType } = target;
  const live = useMemo(
    () => linkItemsByKey(items).get(linkItemKey({ id, entryType })),
    [items, id, entryType],
  );
  const open = () => {
    if (!isValidLinkTarget(target)) return;
    setActiveView({ type: viewOfLinkTarget(target.entryType, target.id), id: target.id, mode: 'view' });
  };
  return (
    <span className="inline-flex">
      <LinkedEntryChip
        icon={live ? <LinkItemIcon item={live} /> : null}
        label={live?.label ?? target.label}
        labelMaxWidth="max-w-[240px]"
        onClick={onRemove ? undefined : open}
        onRemove={onRemove}
        removeTitle={t('properties.removeLink')}
      />
    </span>
  );
}
