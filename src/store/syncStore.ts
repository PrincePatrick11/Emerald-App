import { create } from 'zustand';

/** What the settings page shows of the sync running in the background. */
interface SyncState {
  running: boolean;
  /** The error code of the last run, until one succeeds. */
  error: string | null;
  lastSync: number | null;
  /** Copies made in this session to keep text both sides changed. */
  conflicts: number;
}

export const useSyncStore = create<SyncState>(() => ({
  running: false,
  error: null,
  lastSync: null,
  conflicts: 0,
}));
