import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import Button from '../ui/Button';
import { SwitchRow } from '../ui/Switch';

/**
 * Ein frisch erzeugter Wiederherstellungsschlüssel: der Schlüssel selbst,
 * Kopieren und die Bestätigung, ihn aufbewahrt zu haben. Er wird nur dieses
 * eine Mal gezeigt — beim Anlegen, Verschlüsseln und beim Passwortwechsel,
 * der einen neuen bringt. Was nach der Bestätigung geschieht, entscheidet
 * der Aufrufer (`stored`).
 */
export default function RecoveryKeyBox({ recoveryKey, stored, onStoredChange }: {
  recoveryKey: string;
  stored: boolean;
  onStoredChange: (stored: boolean) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch (err) {
      console.error('[vault-key] copy failed', err);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">{t('vaultKey.recoveryHint')}</p>
      <div className="input-field settings-field font-mono select-all break-all">{recoveryKey}</div>
      <div>
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('vaultKey.copied') : t('vaultKey.copy')}
        </Button>
      </div>
      <SwitchRow
        variant="panel"
        icon={ShieldCheck}
        label={t('vaultKey.stored')}
        checked={stored}
        onChange={onStoredChange}
      />
    </div>
  );
}
