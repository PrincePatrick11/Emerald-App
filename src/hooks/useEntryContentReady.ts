import { useEffect } from 'react';
import { useEntryStore } from '../store/entryStore';

/**
 * Ob der Inhalt des Eintrags `id` geladen ist — und holt ihn sofort, falls
 * nicht. Der Start lädt Inhalte erst nach den Listen (`fetchEntries`); wer
 * einen Eintrag öffnet, bevor das durch ist, wartet nur auf diesen einen.
 */
export function useEntryContentReady(id: string | undefined): boolean {
  const ready = useEntryStore((s) => !id || !s.pendingContent?.has(id));
  useEffect(() => {
    if (!id || ready) return;
    useEntryStore.getState().ensureEntryContent(id)
      .catch((err: unknown) => console.error('[entries] loading content failed', err));
  }, [id, ready]);
  return ready;
}
