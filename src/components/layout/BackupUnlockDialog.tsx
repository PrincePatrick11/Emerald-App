import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { KeyField, onEnter } from './vaultKeyParts';
import { useBackupSecretStore } from '../../store/backupSecretStore';

/**
 * Die Frage nach Passwort oder Wiederherstellungsschlüssel eines Backups, das
 * keiner der offenen Vaults öffnen kann — eines aus einem anderen Vault, oder
 * aus diesem, aber vor einem Passwortwechsel.
 */
export default function BackupUnlockDialog() {
  const request = useBackupSecretStore((s) => s.request);
  if (!request) return null;
  return <Body error={request.error} busy={request.busy} />;
}

function Body({ error, busy }: { error: string | null; busy: boolean }) {
  const { t } = useTranslation();
  const answer = useBackupSecretStore((s) => s.answer);
  const cancel = useBackupSecretStore((s) => s.cancel);
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  // Der Fehler gilt dem Versuch, nach dem er kam — nicht der anderen Eingabeart.
  const [shownError, setShownError] = useState(error);
  useEffect(() => { setShownError(error); }, [error]);

  const submit = () => {
    if (!value.trim() || busy) return;
    answer(useRecovery ? { recoveryKey: value } : { password: value });
  };

  const switchMode = () => {
    setUseRecovery(!useRecovery);
    setValue('');
    setShownError(null);
  };

  return (
    <Modal
      title={t('backupKey.title')}
      onClose={cancel}
      dismissible={!busy}
      widthClassName="w-[440px]"
      bodyClassName="px-5 py-4 space-y-4"
    >
      <p className="text-sm text-secondary">{t('backupKey.hint')}</p>
      <KeyField label={useRecovery ? t('vaultKey.recoveryKey') : t('backupKey.password')}>
        {useRecovery ? (
          <textarea
            autoFocus
            rows={2}
            spellCheck={false}
            className="input-field settings-field font-mono resize-none"
            value={value}
            disabled={busy}
            aria-invalid={Boolean(shownError) || undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onEnter(submit)}
          />
        ) : (
          <input
            type="password"
            autoFocus
            autoComplete="off"
            className="input-field settings-field"
            value={value}
            disabled={busy}
            aria-invalid={Boolean(shownError) || undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onEnter(submit)}
          />
        )}
      </KeyField>
      <div>
        {/* Ein Link, kein Knopf — bündig mit dem Feld, wie im Entsperr-Dialog. */}
        <Button variant="ghost" className="text-xs -ml-1.5" disabled={busy} onClick={switchMode}>
          {useRecovery ? t('backupKey.usePassword') : t('backupKey.useRecovery')}
        </Button>
      </div>
      {shownError && <p className="text-xs text-danger" role="alert">{shownError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button tone="neutral" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>
        <Button tone="jade" disabled={!value.trim() || busy} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          {t('backupKey.open')}
        </Button>
      </div>
    </Modal>
  );
}
