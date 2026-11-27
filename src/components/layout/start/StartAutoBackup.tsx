import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, DatabaseBackup, Folder, History, Layers } from 'lucide-react';
import StartSection from './StartSection';
import Button from '../../ui/Button';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { VaultLocationRow } from '../PickerRows';
import SettingsChoiceButton, { SettingsChoiceRow } from '../settings/SettingsChoiceButton';
import { SettingsDescription, SettingsStatus } from '../settings/SettingsSection';
import {
  backUpNow, pickAutoBackupDir, refreshAutoBackup, resetAutoBackupDir, saveAutoBackupSettings,
} from '../../../lib/autoBackup';
import { formatIsoDateLong, formatWeekday, weekdaysInLocaleOrder } from '../../../lib/formatDate';
import {
  BACKUP_INTERVAL_OPTIONS, BACKUP_KEEP_OPTIONS, useAutoBackupStore,
  type AutoBackupError, type BackupInterval,
} from '../../../store/autoBackupStore';
import { useVaultStore } from '../../../store/vaultStore';
import { takeStartFocus, useVaultPickerStore } from '../../../store/vaultPickerStore';

const INTERVAL_LABEL_KEYS: Record<BackupInterval, string> = {
  daily: 'autoBackup.daily',
  weekly: 'autoBackup.weekly',
  monthly: 'autoBackup.monthly',
};

const INTERVAL_HINT_KEYS: Record<BackupInterval, string> = {
  daily: 'autoBackup.dailyHint',
  weekly: 'autoBackup.weeklyHint',
  monthly: 'autoBackup.monthlyHint',
};

const ERROR_KEYS: Record<AutoBackupError, string> = {
  dirMissing: 'autoBackup.errorDirMissing',
  vaultMissing: 'autoBackup.errorVaultMissing',
  interrupted: 'autoBackup.errorInterrupted',
  keyMissing: 'autoBackup.errorKeyMissing',
  tampered: 'autoBackup.errorTampered',
  marksUnreadable: 'autoBackup.errorMarksUnreadable',
  failed: 'autoBackup.errorFailed',
};

/**
 * The automatic backup on the start page: which vaults, how often, how many
 * are kept, where to — once for all of them. It belongs to the installation
 * and runs as long as the app does (`auto_backup.rs`); here it is set, and
 * each chosen vault shows its newest backup or what went wrong.
 */
export default function StartAutoBackup() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const settings = useAutoBackupStore((s) => s.settings);
  const statuses = useAutoBackupStore((s) => s.statuses);
  const requested = useAutoBackupStore((s) => s.requested);
  const [failed, setFailed] = useState<'save' | 'folder' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    refreshAutoBackup().catch((e: unknown) => console.error('[auto-backup] status failed', e));
  }, []);

  // The failure dot opens the page here.
  const focus = useVaultPickerStore((s) => s.focus);
  useEffect(() => {
    if (focus !== 'backup') return;
    takeStartFocus();
    headingRef.current?.scrollIntoView({ block: 'start' });
    headingRef.current?.focus();
  }, [focus]);

  async function run(kind: 'save' | 'folder', change: () => Promise<unknown>) {
    setFailed(null);
    try {
      await change();
    } catch (e) {
      console.error('[auto-backup] changing the setting failed', e);
      setFailed(kind);
    }
  }

  if (!settings) return null;
  const chosen = new Set(settings.vaults);

  // Flips the vault in the setting as it stands when the save runs, not as
  // the last render showed it: two clicks within one save still cancel out.
  function toggleVault(id: string) {
    void run('save', () => saveAutoBackupSettings((current) => ({
      vaults: current.vaults.includes(id) ? current.vaults.filter((v) => v !== id) : [...current.vaults, id],
    })));
  }

  return (
    <StartSection id="start-backup-heading" icon={<History size={12} />} label={t('autoBackup.title')} headingRef={headingRef}>
      <div className="start-panel space-y-4">
        <SettingsDescription className="">{t('autoBackup.hint')}</SettingsDescription>

        <ul className="space-y-2">
          {vaults.map((vault) => {
            const status = statuses[vault.id];
            const on = chosen.has(vault.id);
            const pending = requested.includes(vault.id) || status?.running;
            return (
              <li key={vault.id} className="flex items-center gap-3 min-w-0">
                <div className="flex-1 min-w-0">
                  <BlockCheckbox checked={on} onChange={() => toggleVault(vault.id)} label={vault.name} />
                </div>
                {on && (
                  <>
                    <span className={`text-xs truncate ${status?.error ? 'text-danger' : 'text-subtle'}`}>
                      {status?.error
                        ? t(ERROR_KEYS[status.error])
                        : status?.newest
                          ? t('autoBackup.last', { date: formatIsoDateLong(status.newest) })
                          : t('autoBackup.none')}
                    </span>
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      disabled={pending}
                      onClick={() => void backUpNow(vault.id)}
                      title={t('autoBackup.nowHint')}
                    >
                      <DatabaseBackup size={12} />
                      {pending ? t('autoBackup.running') : t('autoBackup.now')}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        {/* What the individual choices mean is in the tooltip: a line per
            choice would make the panel taller than all the others. */}
        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <CalendarClock size={14} />
            {t('autoBackup.interval')}
          </p>
          <SettingsChoiceRow>
            {BACKUP_INTERVAL_OPTIONS.map((interval) => (
              <SettingsChoiceButton
                key={interval}
                active={settings.interval === interval}
                onClick={() => void run('save', () => saveAutoBackupSettings(() => ({ interval })))}
                title={t(INTERVAL_HINT_KEYS[interval])}
              >
                {t(INTERVAL_LABEL_KEYS[interval])}
              </SettingsChoiceButton>
            ))}
          </SettingsChoiceRow>
          {/* The weekday belongs to "Weekly" and sits right below it, without a heading of its own. */}
          {settings.interval === 'weekly' && (
            <div className="mt-2" role="group" aria-label={t('autoBackup.weekday')}>
              <SettingsChoiceRow>
                {weekdaysInLocaleOrder().map((day) => (
                  <SettingsChoiceButton
                    key={day}
                    active={settings.weekday === day}
                    onClick={() => void run('save', () => saveAutoBackupSettings(() => ({ weekday: day })))}
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
            {t('autoBackup.keep')}
          </p>
          <SettingsChoiceRow>
            {BACKUP_KEEP_OPTIONS.map((keep) => (
              <SettingsChoiceButton
                key={keep ?? 'all'}
                active={settings.keep === keep}
                onClick={() => void run('save', () => saveAutoBackupSettings(() => ({ keep })))}
                title={t('autoBackup.keepHint')}
                className="tabular-nums"
              >
                {keep ?? t('autoBackup.keepAll')}
              </SettingsChoiceButton>
            ))}
          </SettingsChoiceRow>
        </div>

        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <Folder size={14} />
            {t('autoBackup.folder')}
          </p>
          <VaultLocationRow
            target={settings.customDir ?? t('autoBackup.ownFolder')}
            customPath={settings.customDir}
            onPickFolder={() => void run('folder', pickAutoBackupDir)}
            onResetFolder={() => void run('folder', resetAutoBackupDir)}
          />
          {/* Backups in the vault's own folder go down with its drive. */}
          {!settings.customDir && <SettingsDescription className="mt-3">{t('autoBackup.folderTip')}</SettingsDescription>}
          {settings.dirMissing && <SettingsStatus tone="error" className="mt-2">{t('autoBackup.errorDirMissing')}</SettingsStatus>}
        </div>

        {failed && (
          <SettingsStatus tone="error">{t(failed === 'folder' ? 'autoBackup.errorFolder' : 'autoBackup.errorSave')}</SettingsStatus>
        )}
      </div>
    </StartSection>
  );
}
