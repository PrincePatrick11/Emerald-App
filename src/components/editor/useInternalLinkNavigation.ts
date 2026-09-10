import { useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { isValidLinkTarget } from '../../lib/links';
import { viewTypeForEntryType } from '../../lib/modules';
import type { ContentType } from '../../types';

/**
 * Klick auf einen Link-Chip im Lesemodus → zum Ziel navigieren. Der Chip
 * (InternalLinkNodeView) feuert `internal-link-navigate` am `document`; es darf
 * genau EIN Zuhörer pro geöffnetem Eintrag hängen, sonst navigiert jeder
 * Textblock einmal und die Verlaufsliste bekommt Duplikate. Deshalb hängt er am
 * `BlockStack`, nicht am einzelnen Editor.
 */
export function useInternalLinkNavigation(enabled: boolean): void {
  const setActiveView = useUIStore((s) => s.setActiveView);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const { id, entryType: rawEntryType } = (e as CustomEvent<{ id: string; entryType: string }>).detail;
      const entryType = rawEntryType?.trim();
      // Prüfen, bevor navigiert wird — schützt gegen synthetische Events aus
      // XSS im Editor-Inhalt. Dieselbe Prüfung wie beim Anhängen und Anzeigen.
      if (!isValidLinkTarget({ id, entryType })) return;
      setActiveView({ type: viewTypeForEntryType(entryType as ContentType), id, mode: 'view' });
    };
    document.addEventListener('internal-link-navigate', handler);
    return () => document.removeEventListener('internal-link-navigate', handler);
  }, [enabled, setActiveView]);
}
