import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useUIStore } from '../../../store/uiStore';
import { Search } from 'lucide-react';
import SidebarSection, { SidebarEmpty, SidebarItemRow, SidebarRowRemove } from './SidebarSection';
import { useLinkItems } from '../../../hooks/useLinkItems';
import LinkedEntryPicker, { LinkItemIcon } from './LinkedEntryPicker';
import {
  requestEntryLinkAppend, requestEntryLinkRemove, requestEntryLinkReveal,
} from '../../../lib/links';
import { extractInternalLinks } from '../../../lib/internalLinkHtml';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import { MOON_PHASE_ORDER } from '../../../lib/moonPhase';
import { viewOfLinkTarget } from '../../../store/entryViews';
import {
  linkItemKey as itemKey, linkItemsByKey, resolveLink, type ResolvedLink as LinkedRow,
} from '../../../lib/linkItems';
import {
  TARGET_KIND_ICONS,
  TARGET_KIND_LABEL_KEYS,
  type SuggestionItem,
} from '../../editors/text/SuggestionList';

interface Props {
  /** The stored HTML content of the entry, the source of the list. */
  content: string;
}

/**
 * This many suggestions the list shows. All five modules are in one pool:
 * with few hits and no search term you would only see the first module.
 * The menu is limited to `max-h-40` and scrolls.
 */
const RESULT_LIMIT = 50;

/** Open/closed state of the links; reading and editing share it. */
const OPEN_KEY = 'entry-sidebar-links-open';

/** Most recently edited first; entries without a timestamp go to the end. */
function byRecency(a: SuggestionItem, b: SuggestionItem): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
}

/** By category, within it by title. Entries without a category come last. */
function byCategory(a: SuggestionItem, b: SuggestionItem): number {
  const ca = a.categoryLabel ?? '';
  const cb = b.categoryLabel ?? '';
  // First the question "does it have a category at all?"; a placeholder character at
  // the end of the alphabet would be shorter, but the collation may ignore it.
  if (!ca !== !cb) return ca ? -1 : 1;
  return ca.localeCompare(cb) || a.label.localeCompare(b.label);
}

const NO_ITEMS: SuggestionItem[] = [];
const NO_KEYS: string[] = [];

/**
 * The links of an entry, sorted by category: the link chips
 * of its content. `pending`/`removed` bridge the autosave when editing
 * (see `LinkedEntriesField`).
 *
 * A target in the trash or deleted for good keeps its row, with the title the
 * chip stored, at the end of the list — like the chip in the text it stays
 * until it is removed, and comes back to life when the target is restored.
 */
function useLinkedEntries(
  content: string,
  pending: SuggestionItem[] = NO_ITEMS,
  removed: string[] = NO_KEYS,
): LinkedRow[] {
  const { t } = useTranslation();
  // Cached per list (`linkItemsByKey`), so the memo below only reruns on a change.
  const byKey = linkItemsByKey(useLinkItems());
  return useMemo(() => {
    const dropped = new Set(removed);
    const seen = new Set<string>();
    const live: SuggestionItem[] = [];
    const gone: SuggestionItem[] = [];
    for (const link of [...extractInternalLinks(content), ...pending]) {
      const key = itemKey(link);
      if (seen.has(key) || dropped.has(key)) continue;
      seen.add(key);
      const row = resolveLink(byKey, link, t);
      (row.gone ? gone : live).push(row.item);
    }
    // Sorted by category, not in text order: links of the same kind
    // thus stand together, regardless of when they got into the
    // entry.
    return [
      ...live.sort(byCategory).map((item) => ({ item, gone: false })),
      ...gone.sort((a, b) => a.label.localeCompare(b.label)).map((item) => ({ item, gone: true })),
    ];
  }, [content, pending, removed, byKey, t]);
}

/** Assignment on the right of a row: the category, else entry/task — or that it is gone. */
function rowMeta(t: TFunction, { item, gone }: LinkedRow): string {
  if (gone) return t('properties.linkGone');
  return item.categoryLabel || t(TARGET_KIND_LABEL_KEYS[item.targetKind]);
}

/**
 * A click shows the place in the entry where the link stands. Only if the
 * editor does not find it does it go to the linked entry itself.
 */
function useRevealLink() {
  const setActiveView = useUIStore((s) => s.setActiveView);
  return ({ item, gone }: LinkedRow) => {
    if (requestEntryLinkReveal(item)) return;
    // A gone target has no view to open.
    if (!gone) setActiveView(viewOfLinkTarget(item.targetKind, item.id));
  };
}

/**
 * The links in the read view: a section with a counter, one row per link:
 * icon, title, and on the right the category (entry/task if there is none).
 */
export function LinkedEntriesSection({ content }: Props) {
  const { t } = useTranslation();
  const linked = useLinkedEntries(content);
  const reveal = useRevealLink();
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.linkedEntries')} count={linked.length}>
      {linked.length === 0 && <SidebarEmpty>{t('properties.noLinkedEntries')}</SidebarEmpty>}
      {linked.map((row) => (
        <SidebarItemRow
          key={itemKey(row.item)}
          icon={<LinkItemIcon item={row.item} />}
          label={row.item.label}
          meta={rowMeta(t, row)}
          gone={row.gone}
          onClick={() => reveal(row)}
        />
      ))}
    </SidebarSection>
  );
}

/**
 * What the entry links to, read from the internal link chips of its
 * content, not from dedicated columns. So the field also shows the links that
 * were created in the running text via `[[` or the link picker, and a
 * selection here conversely ends up as a chip at the bottom of the entry. The edit
 * variant of `LinkedEntriesSection`: the same rows, plus a "×" on each and
 * the search field below.
 *
 * A link can also be removed again here.
 */
export default function LinkedEntriesField({ content }: Props) {
  const { t } = useTranslation();
  const items = useLinkItems();
  const [query, setQuery] = useState('');

  // The store content lags behind the editor by the autosave debounce. That
  // holds for links added here as well as for those created in the text via `[[`.
  // The field can only bridge its own: they live here until
  // they drop out again as soon as the stored content includes them.
  const [pending, setPending] = useState<SuggestionItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => { setPending([]); setRemoved([]); }, [content]);

  const linked = useLinkedEntries(content, pending, removed);

  const filtered = useMemo(() => {
    const linkedKeys = new Set(linked.map((row) => itemKey(row.item)));
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => !linkedKeys.has(itemKey(i)) && i.label.toLowerCase().includes(q))
      // Most recently edited first; otherwise the order of `buildLinkItems`
      // would decide, and with no search term no task would be in the list.
      .sort(byRecency)
      .slice(0, RESULT_LIMIT);
  }, [items, linked, query]);

  const reveal = useRevealLink();

  const add = (item: SuggestionItem) => {
    // Only mark as inserted if an editor acknowledged the request;
    // otherwise there would be a row here for a link that does not exist in the entry.
    if (requestEntryLinkAppend(item)) {
      setPending((prev) => [...prev, item]);
      setRemoved((prev) => prev.filter((k) => k !== itemKey(item)));
    }
  };

  // A gone target's category is unknown: the editor may take along any
  // heading an appended link block could have carried (`headingLabels`).
  const categories = useCategoryStore((s) => s.categories);
  const remove = ({ item, gone }: LinkedRow) => {
    const headingLabels = gone
      ? [...categories.map((c) => categoryLabel(t, c)), ...MOON_PHASE_ORDER.map((p) => t(`moonPhase.${p}`))]
      : undefined;
    if (!requestEntryLinkRemove({ ...item, headingLabels })) return;
    setPending((prev) => prev.filter((p) => itemKey(p) !== itemKey(item)));
    setRemoved((prev) => [...prev, itemKey(item)]);
  };

  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.linkedEntries')} count={linked.length}>
      {linked.length === 0 && <SidebarEmpty>{t('properties.noLinkedEntries')}</SidebarEmpty>}
      {linked.map((row) => (
        <SidebarItemRow
          key={itemKey(row.item)}
          icon={<LinkItemIcon item={row.item} />}
          label={row.item.label}
          meta={rowMeta(t, row)}
          title={row.item.label}
          gone={row.gone}
          onClick={() => reveal(row)}
          action={<SidebarRowRemove title={t('properties.removeLink')} onClick={() => remove(row)} />}
        />
      ))}
      <div className="mt-1 pl-[9px] pr-3">
        <LinkedEntryPicker
          results={filtered}
          resultKey={itemKey}
          onSelect={add}
          query={query}
          onQueryChange={setQuery}
          placeholder={t('properties.linkEntry')}
          fieldIcon={<Search size={14} />}
          renderResult={(item) => {
            const TypeIcon = TARGET_KIND_ICONS[item.targetKind];
            return (
              <>
                <LinkItemIcon item={item} />
                <span className="flex-1 truncate">{item.label}</span>
                <TypeIcon size={12} className="text-subtle flex-shrink-0" />
                <span className="text-subtle flex-shrink-0">{t(TARGET_KIND_LABEL_KEYS[item.targetKind])}</span>
              </>
            );
          }}
        />
      </div>
    </SidebarSection>
  );
}
