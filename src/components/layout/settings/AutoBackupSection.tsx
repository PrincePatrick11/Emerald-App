import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, DatabaseBackup, Folder, History, Layers } from 'lucide-react';
import Button from '../../ui/Button';
import { SwitchRow } from '../../ui/Switch';
import { VaultLocationRow } from '../VaultModal';
import {
  backUpNow, pickAutoBackupDir, refreshAutoBackupStatus, requestAutoBackupCheck, resetAutoBackupDir,
} from '../../../lib/autoBackup';
import { formatIsoDateLong, formatWeekday, weekdaysInLocaleOrder } from '../../../lib/formatDate';
import {
  BACKUP_INTERVAL_OPTIONS, BACKUP_KEEP_OPTIONS,
  type BackupInterval,
} from '../../../lib/vaultSettings';
import { useAutoBackupStore, type AutoBackupError } from '../../../store/autoBackupStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useVaultStore } from '../../../store/vaultStore';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection, { SettingsStatus } from './SettingsSection';

const INTERVAL_LABEL_KEYS: Record<BackupInterval, string> = {
  daily: 'settings.autoBackupDaily',
  weekly: 'settings.autoBackupWeekly',
  monthly: 'settings.autoBackupMonthly',
};

const INTERVAL_HINT_KEYS: Record<BackupInterval, string> = {
  daily: 'settings.autoBackupDailyHint',
  weekly: 'settings.autoBackupWeeklyHint',
  monthly: 'settings.autoBackupMonthlyHint',
};

const ERROR_KEYS: Record<AutoBackupError, string> = {
  dirMissing: 'settings.autoBackupErrorDirMissing',
  failed: 'settings.autoBackupErrorFailed',
};

/**
 * Das automatische Backup des offenen Vaults: an/aus, Intervall, wie viele
 * bleiben, wohin. Intervall und Anzahl sind Einstellungen des Vaults; der
 * Zielordner gehört zur Installation und wird von Rust gewählt und gehalten
 * (`auto_backup.rs`) — hier steht er nur zur Anzeige.
 */
export default function AutoBackupSection() {
  const { t } = useTranslation();
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const backup = useSettingsStore((s) => s.settings.backup);
  const update = useSettingsStore((s) => s.update);
  // Stand und Fehler eines anderen Vaults gehören nicht hierher.
  const status = useAutoBackupStore((s) => (s.vaultId === vaultId ? s.status : null));
  const error = useAutoBackupStore((s) => (s.vaultId === vaultId ? s.error : null));
  const running = useAutoBackupStore((s) => s.running);
  // Nur für den Ordner-Dialog: was der Lauf selbst meldet, steht im Store.
  const [folderFailed, setFolderFailed] = useState(false);
  // „Jetzt sichern" wartet, wenn gerade ein Import oder Typwechsel schreibt —
  // solange zeigt der Knopf, dass der Klick angekommen ist.
  const requested = useAutoBackupStore((s) => s.requested);
  const pending = running || requested;

  useEffect(() => {
    if (!vaultId) return;
    refreshAutoBackupStatus(vaultId).catch((e: unknown) => console.error('[auto-backup] status failed', e));
  }, [vaultId]);

  /** `change` meldet `false`, wenn nichts geändert wurde (Dialog abgebrochen). */
  async function changeFolder(change: () => Promise<boolean | void>) {
    setFolderFailed(false);
    try {
      if ((await change()) === false) return;
      // Der neue Ordner ist leer oder trägt einen anderen Stand — prüfen, ob
      // etwas fällig ist. Über den Planer: der versucht es erneut, falls gerade
      // noch ein Lauf in den alten Ordner schreibt.
      requestAutoBackupCheck();
    } catch (e) {
      console.error('[auto-backup] folder change failed', e);
      setFolderFailed(true);
    }
  }

  return (
    <SettingsSection icon={<History size={14} />} title={t('settings.autoBackup')} description={t('settings.autoBackupHint')}>
      <div className="space-y-3">
        <SwitchRow
          variant="panel"
          label={t('settings.autoBackupEnable')}
          hint={t('settings.autoBackupEnableHint')}
          checked={backup.auto}
          onChange={(auto) => update('backup', { auto })}
        />

        {backup.auto && (
          <>
            {/* Was die einzelnen Wahlen bedeuten, steht im Tooltip — wie bei den
                Bildgrenzen: eine Zeile Erklärung je Gruppe machte den Abschnitt
                doppelt so hoch wie jeden anderen des Fensters. */}
            <div>
              <p className="label-xs flex items-center gap-2 mb-2">
                <CalendarClock size={14} />
                {t('settings.autoBackupInterval')}
              </p>
              <SettingsChoiceRow>
                {BACKUP_INTERVAL_OPTIONS.map((interval) => (
                  <SettingsChoiceButton
                    key={interval}
                    active={backup.interval === interval}
                    onClick={() => update('backup', { interval })}
                    title={t(INTERVAL_HINT_KEYS[interval])}
                  >
                    {t(INTERVAL_LABEL_KEYS[interval])}
                  </SettingsChoiceButton>
                ))}
              </SettingsChoiceRow>
              {/* Der Wochentag gehört zur Wahl „Wöchentlich" und steht ohne
                  eigene Überschrift direkt darunter. */}
              {backup.interval === 'weekly' && (
                <div className="mt-2" role="group" aria-label={t('settings.autoBackupWeekday')}>
                  <SettingsChoiceRow>
                    {weekdaysInLocaleOrder().map((day) => (
                      <SettingsChoiceButton
                        key={day}
                        active={backup.weekday === day}
                        onClick={() => update('backup', { weekday: day })}
                        title={formatWeekday(day, 'long')}
                      >
                        {formatWeekday(day, 'short')}
                      </SettingsChoiceButton>
                    ))}
                  </SettingsChoiceRow>
                </div>
              )}
            </div>

            <div>
              <p className="label-xs flex items-center gap-2 mb-2">
                <Layers size={14} />
                {t('settings.autoBackupKeep')}
              </p>
              <SettingsChoiceRow>
                {BACKUP_KEEP_OPTIONS.map((keep) => (
                  <SettingsChoiceButton
                    key={keep ?? 'all'}
                    active={backup.keep === keep}
                    onClick={() => update('backup', { keep })}
                    title={t('settings.autoBackupKeepHint')}
                    className="tabular-nums"
                  >
                    {keep ?? t('settings.autoBackupKeepAll')}
                  </SettingsChoiceButton>
                ))}
              </SettingsChoiceRow>
            </div>

            <div title={t('settings.autoBackupFolderHint')}>
              <p className="label-xs flex items-center gap-2 mb-2">
                <Folder size={14} />
                {t('settings.autoBackupFolder')}
              </p>
              <VaultLocationRow
                target={status?.dir ?? null}
                customPath={status?.customDir ?? null}
                onPickFolder={() => void changeFolder(() => pickAutoBackupDir(vaultId))}
                onResetFolder={() => void changeFolder(() => resetAutoBackupDir(vaultId))}
              />
            </div>

            <div className="settings-row">
              <span className="text-sm min-w-0 text-secondary">
                {status?.newest
                  ? t('settings.autoBackupLast', { date: formatIsoDateLong(status.newest) })
                  : t('settings.autoBackupNone')}
              </span>
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={pending}
                onClick={() => void backUpNow()}
                title={t('settings.autoBackupNowHint')}
              >
                <DatabaseBackup size={14} />
                {pending ? t('settings.autoBackupRunning') : t('settings.autoBackupNow')}
              </Button>
            </div>

            {error && <SettingsStatus tone="error">{t(ERROR_KEYS[error])}</SettingsStatus>}
            {folderFailed && <SettingsStatus tone="error">{t('settings.autoBackupErrorFolder')}</SettingsStatus>}
          </>
        )}
      </div>
    </SettingsSection>
  );
}
