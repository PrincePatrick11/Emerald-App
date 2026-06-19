import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Both maps grow for the lifetime of the session with no eviction.
// For a typical user with a handful of altars and backgrounds, the memory
// footprint is negligible. If long sessions with many unique backgrounds
// become a concern, a simple LRU cap (e.g. 50 entries) could be added.
const cache = new Map<string, string>();
const failed = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function loadPreview(path: string) {
  if (cache.has(path) || failed.has(path) || inFlight.has(path)) return;
  const promise = invoke<string>('read_image_as_base64', { path })
    .then((dataUrl) => {
      cache.set(path, dataUrl);
    })
    .catch((error) => {
      failed.add(path);
      if (error !== 'file not found') {
        console.error('Failed to load background preview:', path, error);
      }
    })
    .finally(() => {
      inFlight.delete(path);
      notify();
    });
  inFlight.set(path, promise);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function readSnapshot(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source.startsWith('data:')) return source;
  if (cache.has(source)) return cache.get(source) ?? null;
  if (failed.has(source)) return null;
  loadPreview(source);
  return null;
}

function getServerSnapshot(): string | null {
  return null;
}

export function getCachedBackgroundPreview(path: string | null | undefined): string | null {
  return readSnapshot(path);
}

export function useBackgroundPreview(source: string | null | undefined): string | null {
  useEffect(() => {
    if (source && !source.startsWith('data:')) loadPreview(source);
  }, [source]);
  return useSyncExternalStore(subscribe, () => readSnapshot(source), getServerSnapshot);
}
