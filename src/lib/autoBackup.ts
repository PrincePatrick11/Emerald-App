import { invoke } from '@tauri-apps/api/core';
import { drainSerialized } from './serialize';
import { editorSavesSuspended } from './editorLock';
import { vaultKeyStatus } from './vaultKeys';
import type { BackupSettings } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';
import { hasActiveVault, useVaultStore } from '../store/vaultStore';
import { useAutoBackupStore, type AutoBackupError, type AutoBackupStatus } from '../store/autoBackupStore';

/**
 * Das automatische Backup: wann eines fällig ist, und der Lauf selbst.
 *
 * Einen Hintergrunddienst gibt es nicht — geprüft wird, während die App offen
 * und der Vault entsperrt ist: kurz nach dem Öffnen eines Vaults, nach jeder
 * Änderung der Einstellung und danach stündlich. Wohin geschrieben wird und
 * unter welchem Namen, entscheidet allein `auto_backup.rs`; von hier geht nie
 * ein Pfad hinüber.
 */

/** Abstand zum Öffnen des Vaults: der Start gehört dem Laden, nicht dem Backup. */
const SETTLE_MS = 5_000;
/** Für Sitzungen, die über einen Tageswechsel offen bleiben. */
const RECHECK_MS = 60 * 60 * 1000;

/** Erwartet von `auto_backup.rs`, wenn der gewählte Ordner fehlt. */
const DIR_MISSING = 'AUTO_BACKUP_DIR_MISSING';

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Ob ein Backup ansteht. `newest` und `today` sind lokale Tage (`YYYY-MM-DD`),
 * beide von derselben Uhr in Rust. Fällig heißt: seit dem letzten Termin gibt
 * es noch keines — ein verpasster Termin wird also beim nächsten Öffnen
 * nachgeholt, und ohne jedes Backup ist sofort eines fällig.
 */
export function isBackupDue(settings: Pick<BackupSettings, 'interval' | 'weekday'>, newest: string | null, today: string): boolean {
  if (!newest) return true;
  if (settings.interval === 'daily') return newest < today;
  if (settings.interval === 'monthly') return newest < `${today.slice(0, 8)}01`;
  // Der letzte gewählte Wochentag, heute eingeschlossen.
  const [y, m, d] = today.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - ((day.getDay() - settings.weekday + 7) % 7));
  return newest < isoDay(day);
}

function errorCode(err: unknown): AutoBackupError {
  return String(err instanceof Error ? err.message : err).includes(DIR_MISSING) ? 'dirMissing' : 'failed';
}

function setError(error: AutoBackupError): void {
  // Derselbe Fehler bei der stündlichen Wiederholung holt den Punkt nicht zurück.
  useAutoBackupStore.setState((s) => ({ error, errorSeen: s.error === error ? s.errorSeen : false }));
}

/** Liest Zielordner und jüngstes Backup des Vaults neu in den Store. */
export async function refreshAutoBackupStatus(vaultId: string): Promise<AutoBackupStatus> {
  const status = await invoke<AutoBackupStatus>('auto_backup_status', { vaultId });
  useAutoBackupStore.setState((s) => {
    if (s.vaultId !== vaultId) return { vaultId, status, error: null, errorSeen: false };
    // Der Ordner ist wieder da oder ein anderer gewählt: die Meldung dazu hat sich erledigt.
    return !status.missing && s.error === 'dirMissing' ? { status, error: null, errorSeen: false } : { status };
  });
  return status;
}

/** Öffnet den Ordner-Dialog (in Rust) und merkt sich die Wahl. `false` bei Abbruch. */
export async function pickAutoBackupDir(vaultId: string): Promise<boolean> {
  const picked = await invoke<string | null>('pick_auto_backup_dir', { vaultId });
  if (picked === null) return false;
  await refreshAutoBackupStatus(vaultId);
  return true;
}

/** Zurück zum `backup/`-Ordner des Vaults. */
export async function resetAutoBackupDir(vaultId: string): Promise<void> {
  await invoke('reset_auto_backup_dir', { vaultId });
  await refreshAutoBackupStatus(vaultId);
}

/**
 * Schreibt ein Backup des offenen Vaults, wenn eines fällig ist — mit `force`
 * auch sonst („Jetzt sichern"). Tut still nichts, solange kein Vault offen
 * und entsperrt ist, ein Import läuft oder schon ein Lauf unterwegs ist.
 */
export async function runAutoBackup({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (useAutoBackupStore.getState().running) return;
  const vaultState = useVaultStore.getState();
  const vaultId = vaultState.activeVaultId;
  if (!hasActiveVault(vaultState) || vaultState.locked) return;
  // Die Einstellungen eines anderen Vaults dürfen diesen nie sichern (wie `trashRetentionFor`).
  const settingsState = useSettingsStore.getState();
  if (settingsState.vaultId !== vaultId) return;
  const { backup } = settingsState.settings;
  if (!force && !backup.auto) return;
  if (editorSavesSuspended()) return;

  /** Der Vault ist noch derselbe und nichts tauscht gerade die Datenbank unter ihm aus. */
  const stillCurrent = () => {
    const now = useVaultStore.getState();
    return now.activeVaultId === vaultId && !now.locked && !editorSavesSuspended();
  };

  useAutoBackupStore.setState({ running: true });
  try {
    if (!(await vaultKeyStatus(vaultId)).unlocked) return;
    const status = await refreshAutoBackupStatus(vaultId);
    if (status.missing) {
      setError('dirMissing');
      return;
    }
    if (!force && !isBackupDue(backup, status.newest, status.today)) return;

    await drainSerialized();
    // Dynamisch: `dbBackup` soll nicht in den Haupt-Chunk (siehe LeftSidebarRail).
    const { buildBackup, FULL_BACKUP_OPTIONS } = await import('./dbBackup');
    const content = JSON.stringify(await buildBackup(FULL_BACKUP_OPTIONS));
    if (!stillCurrent()) return;

    await invoke('write_auto_backup', { vaultId, content, keep: backup.keep });
    useAutoBackupStore.setState({ error: null, errorSeen: false });
    await refreshAutoBackupStatus(vaultId);
  } catch (err) {
    // Gesperrt, gewechselt oder mitten im Import: kein Fehler, der nächste Takt versucht es wieder.
    if (!stillCurrent()) return;
    console.error('[auto-backup] failed', err);
    setError(errorCode(err));
  } finally {
    useAutoBackupStore.setState({ running: false });
  }
}

/**
 * Startet die Prüfung für die Dauer der Sitzung; die Rückgabe beendet sie.
 * Der Auslöser ist der Einstellungs-Store: er meldet jeden geöffneten Vault
 * (`loadForVault`) und jede Änderung der Backup-Einstellung.
 */
export function startAutoBackup(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void runAutoBackup(), SETTLE_MS);
  };
  const unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (state.vaultId !== prev.vaultId || state.settings.backup !== prev.settings.backup) schedule();
  });
  const interval = setInterval(() => void runAutoBackup(), RECHECK_MS);
  schedule();
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
  };
}
