/**
 * Import lock for the editor's save paths.
 *
 * A backup restore in replace mode keeps the original IDs. If the import
 * navigated the open editor away, its unmount save fired and wrote the
 * PRE-import content over the row that had just been restored — silent
 * data loss that already existed (spread over three copies) before the
 * useEntryEditor hook. dbBackup holds the lock around replace and
 * add-vault imports; the hook checks it before every
 * automatic save.
 *
 * A counter instead of a boolean flag, so that nested or
 * overlapping locks do not release each other prematurely.
 */
let suspended = 0;

export function suspendEditorSaves(): void {
  suspended++;
}

export function resumeEditorSaves(): void {
  suspended = Math.max(0, suspended - 1);
}

export function editorSavesSuspended(): boolean {
  return suspended > 0;
}
