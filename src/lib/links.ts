import { isValidLinkTarget } from './internalLinkHtml';
import type { ContentType } from '../types';

/** What the sidebar's linking field sends to the editor. Matches
 *  `SuggestionItem` (where `label` is required), but stays
 *  self-contained here: `lib/` imports no components. */
export interface EntryLinkRequest {
  id: string;
  entryType: ContentType;
  label: string;
  icon?: string | null;
  /** Heading above the appended link — see `SuggestionItem.categoryLabel`. */
  categoryLabel?: string;
  entry_number?: number | null;
}

// Lives in `internalLinkHtml.ts`, because the pure block modules need it too.
export { isValidLinkTarget };

/**
 * The sidebar does not know the TipTap editor — it asks it via an event
 * to append a link at the bottom. The same pattern as `internal-link-navigate`:
 * the editor of the open view listens as long as it is editable.
 */
export const APPEND_ENTRY_LINK_EVENT = 'entry-link-append';

/** `true` if an editable editor accepted the request (it acknowledges
 *  with `preventDefault`). `false` means: nobody is listening right now — the caller
 *  must then not treat the link as inserted. */
export function requestEntryLinkAppend(item: EntryLinkRequest): boolean {
  const event = new CustomEvent<EntryLinkRequest>(APPEND_ENTRY_LINK_EVENT, {
    detail: item,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * Request to the open editor to jump to a link in the content and briefly
 * highlight it. Counterpart to appending — with the same acknowledgement rule:
 * `false` means the link is not (or no longer) in the entry, and the caller may
 * navigate to the target instead.
 */
export const REVEAL_ENTRY_LINK_EVENT = 'entry-link-reveal';

export function requestEntryLinkReveal(target: { id: string; entryType: ContentType }): boolean {
  const event = new CustomEvent(REVEAL_ENTRY_LINK_EVENT, {
    detail: target,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * Request to the editor to remove the link from the content. With the same
 * acknowledgement rule: `false` means no editable editor is listening or the
 * link is not in the text.
 *
 * `categoryLabel` is part of it, even though it is not needed to find the link:
 * the editor only clears an appended link block together with its heading
 * if the heading's text is exactly this category. Without it, the heading
 * would stay.
 */
export const REMOVE_ENTRY_LINK_EVENT = 'entry-link-remove';

export function requestEntryLinkRemove(
  target: { id: string; entryType: ContentType; categoryLabel?: string },
): boolean {
  const event = new CustomEvent(REMOVE_ENTRY_LINK_EVENT, {
    detail: target,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * The other side of the three `requestEntryLink*` requests: checks the target and
 * acknowledges via `preventDefault` if `handler` accepted the request.
 * Returns the unsubscribe function.
 *
 * Together with the request functions, the whole protocol lives here —
 * before, the receiver side stood in the text editor three times, almost identical.
 */
export function subscribeEntryLinkRequest(
  eventName: string,
  handler: (target: EntryLinkRequest) => boolean,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<EntryLinkRequest>).detail;
    if (!isValidLinkTarget(detail)) return;
    if (handler(detail)) e.preventDefault();
  };
  document.addEventListener(eventName, listener);
  return () => document.removeEventListener(eventName, listener);
}
