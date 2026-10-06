import { invoke } from '@tauri-apps/api/core';
import { dbEpoch } from './db';
import { drainSerialized } from './serialize';
import { editorSavesSuspended } from './editorLock';
import { localIsoDay } from './helpers';
import { keyErrorOf, vaultKeyStatus } from './vaultKeys';
import type { BackupSettings } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';
import { hasActiveVault, useVaultStore } from '../store/vaultStore';
import { useAutoBackupStore, type AutoBackupError, type AutoBackupStatus } from '../store/autoBackupStore';

/**
 * Das automatische Backup: wann eines fällig ist, und der Lauf selbst.
 *
 * Einen Hintergrunddienst gibt es nicht — geprüft wird, während die App offen
 * und der Vault entsperrt ist: kurz nach dem Öffnen eines Vaults, nach jeder
 * Änderung der Einstellung oder des Ordners, danach stündlich — und noch
 * einmal, wenn ein Versuch auf einen laufenden Lauf oder Import traf. Wohin geschrieben wird und
 * unter welchem Namen, entscheidet allein `auto_backup.rs`; von hier geht nie
 * ein Pfad hinüber.
 */

/** Abstand zum Öffnen des Vaults und zur letzten Änderung der Einstellung oder des Ordners: der
 *  Start gehört dem Laden, und wer Knöpfe durchprobiert, löst nur einen Lauf aus.
 *  Auch der Abstand, nach dem ein `'busy'` neu versucht wird. */
const SETTLE_MS = 5_000;
/** Für Sitzungen, die über einen Tageswechsel offen bleiben. */
const RECHECK_MS = 60 * 60 * 1000;

/** Erwartet von `auto_backup.rs`, wenn der gewählte Ordner fehlt. */
const DIR_MISSING = 'AUTO_BACKUP_DIR_MISSING';
/** Wirft `getDb()`, solange die Datenbank bewusst geschlossen ist (`withDbClosed`). */
const DB_CLOSED = 'DB_CLOSED';

/**
 * Ob ein Backup ansteht. `newest` und `today` sind lokale Tage (`YYYY-MM-DD`),
 * beide von derselben Uhr in Rust. Fällig heißt: seit dem letzten Termin gibt
 * es noch keines — ein verpasster Termin wird also beim nächsten Öffnen
 * nachgeholt, und ohne jedes Backup ist sofort eines fällig.
 */
export function isBackupDue(settings: Pick<BackupSettings, 'interval' | 'weekday'>, newest: string | null, today: string): boolean {
  if (!newest) return true;
  if (settings.interval === 'daily') return newest < today;
  // Der Erste dieses Monats.
  if (settings.interval === 'monthly') return newest < `${today.slice(0, 8)}01`;
  // Der letzte gewählte Wochentag, heute eingeschlossen.
  const [y, m, d] = today.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - ((day.getDay() - settings.weekday + 7) % 7));
  return newest < localIsoDay(day);
}

// `errorSeen` bedeutet nur etwas, solange `error` gesetzt ist — deshalb schreibt
// nur diese Datei die beiden, und `error` nie ohne `errorSeen`.

function setError(vaultId: string, error: AutoBackupError): void {
  useAutoBackupStore.setState((s) => {
    // Der Stand eines anderen Vaults gehört nicht neben diesen Fehler.
    if (s.vaultId !== vaultId) return { vaultId, status: null, error, errorSeen: false };
    // Derselbe Fehler bei der stündlichen Wiederholung holt den Punkt nicht zurück.
    return { error, errorSeen: s.error === error ? s.errorSeen : false };
  });
}

function clearError(vaultId: string): void {
  if (useAutoBackupStore.getState().vaultId === vaultId) useAutoBackupStore.setState({ error: null, errorSeen: false });
}

/** Der Punkt am Zahnrad hat seine Aufgabe erfüllt. */
export function markAutoBackupErrorSeen(): void {
  useAutoBackupStore.setState({ errorSeen: true });
}

/**
 * Liest Zielordner und jüngstes Backup des Vaults neu in den Store. Ist
 * inzwischen ein anderer Vault offen, bleibt der Store, wie er ist — sonst
 * überschriebe das Ende eines Laufs den Stand des Nachfolgers.
 */
export async function refreshAutoBackupStatus(vaultId: string): Promise<AutoBackupStatus> {
  const status = await invoke<AutoBackupStatus>('auto_backup_status', { vaultId });
  if (useVaultStore.getState().activeVaultId !== vaultId) return status;
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
 * und entsperrt ist.
 *
 * `'done'`: für jetzt erledigt — geschrieben, nicht fällig, nicht zuständig oder
 * gescheitert (der Fehler steht dann im Store). `'busy'`: es ging gerade nicht —
 * ein Lauf ist unterwegs, ein Import hält die Datenbank, oder sie wurde
 * während des Laufs geschlossen oder ersetzt — und ein neuer Versuch lohnt sich.
 */
export async function runAutoBackup({ force = false }: { force?: boolean } = {}): Promise<'done' | 'busy'> {
  const vaultState = useVaultStore.getState();
  const vaultId = vaultState.activeVaultId;
  if (!hasActiveVault(vaultState) || vaultState.locked) return 'done';
  // Die Einstellungen eines anderen Vaults dürfen diesen nie sichern (wie `trashRetentionFor`).
  const settingsState = useSettingsStore.getState();
  if (settingsState.vaultId !== vaultId) return 'done';
  const { backup } = settingsState.settings;
  if (!force && !backup.auto) return 'done';
  // `editorSavesSuspended`: ein Import läuft (siehe `editorLock.ts`).
  if (useAutoBackupStore.getState().running || editorSavesSuspended()) return 'busy';

  // Zählt jedes Schließen oder Ersetzen der Datenbank mit (`dbEpoch`): ein Passwortwechsel
  // oder Import, der mitten im Lauf beginnt *und* endet, sähe am Schluss sonst aus wie Ruhe —
  // und das Backup enthielte nur, was vor dem Austausch gelesen wurde.
  const epoch = dbEpoch();
  /** Der Vault ist noch derselbe und nichts hat die Datenbank unter dem Lauf ausgetauscht. */
  const stillCurrent = () => {
    const now = useVaultStore.getState();
    return now.activeVaultId === vaultId && !now.locked && !editorSavesSuspended() && dbEpoch() === epoch;
  };

  useAutoBackupStore.setState({ running: true });
  try {
    if (!(await vaultKeyStatus(vaultId)).unlocked) return 'done';
    const status = await refreshAutoBackupStatus(vaultId);
    if (status.missing) {
      setError(vaultId, 'dirMissing');
      return 'done';
    }
    if (!force && !isBackupDue(backup, status.newest, status.today)) return 'done';

    await drainSerialized();
    // Dynamisch: `dbBackup` soll nicht in den Haupt-Chunk (siehe LeftSidebarRail).
    const { buildBackup, FULL_BACKUP_OPTIONS } = await import('./dbBackup');
    const content = JSON.stringify(await buildBackup(FULL_BACKUP_OPTIONS));
    if (!stillCurrent()) return 'busy';

    await invoke('write_auto_backup', { vaultId, content, keep: backup.keep });
    clearError(vaultId);
    await refreshAutoBackupStatus(vaultId);
    return 'done';
  } catch (err) {
    // Gesperrt, gewechselt, mitten im Import oder Passwortwechsel: kein Fehler,
    // der nächste Versuch findet wieder eine Datenbank vor.
    if (!stillCurrent() || keyErrorOf(err).includes(DB_CLOSED)) return 'busy';
    console.error('[auto-backup] failed', err);
    setError(vaultId, keyErrorOf(err).includes(DIR_MISSING) ? 'dirMissing' : 'failed');
    return 'done';
  } finally {
    useAutoBackupStore.setState({ running: false });
  }
}

/** Der Auslöser der laufenden Sitzung, solange `startAutoBackup` aktiv ist. */
let scheduleCheck: (() => void) | null = null;

/**
 * Prüft in ein paar Sekunden, ob ein Backup fällig ist — für Auslöser von
 * außerhalb (ein neuer Ordner), die auf einen laufenden Lauf treffen können.
 * Ohne laufende Sitzung (`startAutoBackup`) geschieht nichts.
 */
export function requestAutoBackupCheck(): void {
  scheduleCheck?.();
}

/**
 * Startet die Prüfung für die Dauer der Sitzung; die Rückgabe beendet sie.
 * Der Auslöser ist der Einstellungs-Store: er meldet jeden geöffneten Vault
 * (`loadForVault`) und jede Änderung der Backup-Einstellung.
 */
export function startAutoBackup(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    // Ein Lauf, der erst nach dem Beenden zurückkommt, stellt keinen Timer mehr.
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(check, SETTLE_MS);
  };
  // Ein Auslöser, der auf einen laufenden Lauf oder einen Import trifft, ginge
  // sonst verloren — bis zur nächsten vollen Stunde.
  const check = () => void runAutoBackup().then((outcome) => { if (outcome === 'busy') schedule(); });
  const unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (state.vaultId !== prev.vaultId || state.settings.backup !== prev.settings.backup) schedule();
  });
  const interval = setInterval(check, RECHECK_MS);
  scheduleCheck = schedule;
  schedule();
  return () => {
    stopped = true;
    // Nur den eigenen: ein späterer Start hat ihn womöglich schon ersetzt.
    if (scheduleCheck === schedule) scheduleCheck = null;
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
  };
}
