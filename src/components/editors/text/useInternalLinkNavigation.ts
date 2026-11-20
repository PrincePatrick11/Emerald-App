import { useEffect } from 'react';
import { useUIStore } from '../../../store/uiStore';
import { isValidLinkTarget } from '../../../lib/links';
import { viewOfLinkTarget } from '../../../store/entryViews';

/**
 * Navigation requests from link chips: a left click in read mode opens the target in
 * place, a middle click (`detail.newTab`) opens it in a new tab, also while editing
 * (the edit stays in its own tab). The chip
 * (InternalLinkNodeView) fires `internal-link-navigate` on the `document`; exactly
 * ONE listener may hang per opened entry, otherwise every
 * text block navigates once and the history list gets duplicates. That is why it hangs on the
 * `BlockStack`, not on the individual editor.
 */
export function useInternalLinkNavigation(isEditing: boolean): void {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, targetKind: rawTargetKind, newTab } = (e as CustomEvent<{ id: string; targetKind: string; newTab?: boolean }>).detail;
      const targetKind = rawTargetKind?.trim();
      // Check before navigating; protects against synthetic events from
      // XSS in the editor content. The same check as when appending and displaying.
      if (!isValidLinkTarget({ id, targetKind })) return;
      // While editing, only the new-tab path may leave the entry's view.
      if (isEditing && newTab !== true) return;
      const view = viewOfLinkTarget(targetKind, id);
      if (newTab === true) openViewInNewTab(view);
      else setActiveView(view);
    };
    document.addEventListener('internal-link-navigate', handler);
    return () => document.removeEventListener('internal-link-navigate', handler);
  }, [isEditing, setActiveView, openViewInNewTab]);
}
