import { useEffect } from 'react';
import { useUIStore } from '../../../store/uiStore';
import { isValidLinkTarget } from '../../../lib/links';
import { viewTypeForEntryType } from '../../../lib/modules';
import type { ContentType } from '../../../types';

/**
 * Click on a link chip in read mode → navigate to the target. The chip
 * (InternalLinkNodeView) fires `internal-link-navigate` on the `document`; exactly
 * ONE listener may hang per opened entry, otherwise every
 * text block navigates once and the history list gets duplicates. That is why it hangs on the
 * `BlockStack`, not on the individual editor.
 */
export function useInternalLinkNavigation(enabled: boolean): void {
  const setActiveView = useUIStore((s) => s.setActiveView);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const { id, entryType: rawEntryType } = (e as CustomEvent<{ id: string; entryType: string }>).detail;
      const entryType = rawEntryType?.trim();
      // Check before navigating; protects against synthetic events from
      // XSS in the editor content. The same check as when appending and displaying.
      if (!isValidLinkTarget({ id, entryType })) return;
      setActiveView({ type: viewTypeForEntryType(entryType as ContentType), id, mode: 'view' });
    };
    document.addEventListener('internal-link-navigate', handler);
    return () => document.removeEventListener('internal-link-navigate', handler);
  }, [enabled, setActiveView]);
}
