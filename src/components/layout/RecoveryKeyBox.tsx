import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import Button from '../ui/Button';
import { SwitchRow } from '../ui/Switch';

/**
 * A freshly generated recovery key: the key itself,
 * copying and the confirmation of having stored it. It is shown only this
 * once — on creating, encrypting and on a password change
 * that brings a new one. What happens after the confirmation is decided
 * by the caller (`stored`).
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
        <Button tone="neutral" onClick={copy}>
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
