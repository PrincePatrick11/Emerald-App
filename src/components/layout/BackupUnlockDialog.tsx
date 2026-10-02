import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
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
  return <Body error={request.error} />;
}

function Body({ error }: { error: string | null }) {
  const { t } = useTranslation();
  const answer = useBackupSecretStore((s) => s.answer);
  const cancel = useBackupSecretStore((s) => s.cancel);
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');

  const submit = () => {
    if (!value.trim()) return;
    answer(useRecovery ? { recoveryKey: value } : { password: value });
  };

  return (
    <Modal title={t('backupKey.title')} onClose={cancel} widthClassName="w-[440px]" bodyClassName="px-5 py-4 space-y-4">
      <p className="text-sm text-secondary">{t('backupKey.hint')}</p>
      <KeyField label={useRecovery ? t('vaultKey.recoveryKey') : t('backupKey.password')}>
        {useRecovery ? (
          <textarea
            autoFocus
            rows={2}
            spellCheck={false}
            className="input-field settings-field font-mono resize-none"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            type="password"
            autoFocus
            autoComplete="off"
            className="input-field settings-field"
            value={value}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onEnter(submit)}
          />
        )}
      </KeyField>
      <div>
        <Button variant="ghost" className="text-xs -ml-1.5" onClick={() => { setUseRecovery(!useRecovery); setValue(''); }}>
          {useRecovery ? t('backupKey.usePassword') : t('backupKey.useRecovery')}
        </Button>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button tone="neutral" onClick={cancel}>{t('common.cancel')}</Button>
        <Button tone="jade" disabled={!value.trim()} onClick={submit}>
          <KeyRound size={14} />
          {t('backupKey.open')}
        </Button>
      </div>
    </Modal>
  );
}
