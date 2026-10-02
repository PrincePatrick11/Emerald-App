import { useEffect, useState } from 'react';
import { useEntryStore } from '../store/entryStore';

/** Weitere Versuche nach einem gescheiterten Laden, je eine Sekunde später. */
const RETRIES = 3;

/**
 * Ob der Inhalt des Eintrags `id` geladen ist — und holt ihn sofort, falls
 * nicht. Der Start lädt Inhalte erst nach den Listen (`fetchEntries`); wer
 * einen Eintrag öffnet, bevor das durch ist, wartet nur auf diesen einen.
 */
export function useEntryContentReady(id: string | undefined): boolean {
  const ready = useEntryStore((s) => !id || !s.pendingContent?.has(id));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || ready) return;
    let cancelled = false;
    useEntryStore.getState().ensureEntryContent(id).catch((err: unknown) => {
      console.error('[entries] loading content failed', err);
      if (!cancelled && attempt < RETRIES) setTimeout(() => { if (!cancelled) setAttempt((n) => n + 1); }, 1000);
    });
    return () => { cancelled = true; };
  }, [id, ready, attempt]);
  return ready;
}
