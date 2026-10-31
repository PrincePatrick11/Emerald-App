import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * An on/off state that survives a restart — a preference like "which
 * section of the altar dashboard stays collapsed". Persistent and per vault,
 * along with the other preferences (`uiStore.flags`, `vaultPrefs`).
 *
 * If a vault has never set the key, what stood app-wide under the same key
 * before the per-vault preferences applies — so nothing pops open after the
 * update.
 */
export function usePersistedFlag(key: string, fallback = false): [boolean, () => void, (value: boolean) => void] {
  const value = useUIStore((s) => resolve(s.flags, key, fallback));
  const setFlag = useUIStore((s) => s.setFlag);

  const set = useCallback((next: boolean) => setFlag(key, next), [key, setFlag]);
  const toggle = useCallback(() => {
    setFlag(key, !resolve(useUIStore.getState().flags, key, fallback));
  }, [key, fallback, setFlag]);

  return [value, toggle, set];
}

function resolve(flags: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return flags[key] ?? legacyFlag(key) ?? fallback;
}

function legacyFlag(key: string): boolean | undefined {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? undefined : saved === '1';
  } catch {
    return undefined;
  }
}
