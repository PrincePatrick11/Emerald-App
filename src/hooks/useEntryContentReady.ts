import { useEffect, useState } from 'react';
import { useEntryStore } from '../store/entryStore';

/** Further attempts after a failed load, one second apart. */
const RETRIES = 3;

/**
 * Whether the content of entry `id` is loaded — and fetches it right away if
 * not. Startup loads contents only after the lists (`fetchEntries`); whoever
 * opens an entry before that is done waits only for that one.
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
