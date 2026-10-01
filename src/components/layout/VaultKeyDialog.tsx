import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Loader2, Smartphone } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { SwitchRow } from '../ui/Switch';
import { useVaultKeyStore, type VaultKeyRequest } from '../../store/vaultKeyStore';
import {
  KEY_ERRORS, MIN_PASSWORD_LENGTH, createVaultKey, keyErrorOf, recoverVault, unlockVault,
} from '../../lib/vaultKeys';
import { hideSplash } from '../../lib/splash';

/**
 * Passwort festlegen, entsperren, mit dem Wiederherstellungsschlüssel ein
 * neues Passwort setzen — die Fragen von `ensureVaultReady`.
 *
 * Steht über allem, auch über dem Vault-Setup: ein Vault, der gerade geöffnet
 * werden soll, kommt ohne diese Antwort nicht weiter.
 */
export default function VaultKeyDialog() {
  const request = useVaultKeyStore((s) => s.request);
  if (!request) return null;
  // Der Schlüssel: jede neue Frage beginnt mit leeren Feldern.
  return <VaultKeyDialogBody key={`${request.kind}:${request.vaultId}`} request={request} />;
}

type Step = 'unlock' | 'recover' | 'create' | 'showRecovery';

function VaultKeyDialogBody({ request }: { request: VaultKeyRequest }) {
  const { t } = useTranslation();
  const finish = useVaultKeyStore((s) => s.finish);
  const cancel = useVaultKeyStore((s) => s.cancel);

  const [step, setStep] = useState<Step>(request.kind);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  // Beim Anlegen an — der übliche Wunsch auf dem eigenen Rechner. Beim
  // Entsperren aus: wäre der Schlüssel gemerkt, wäre der Dialog gar nicht
  // erschienen, also hat sich hier jemand dagegen entschieden.
  const [remember, setRemember] = useState(request.kind === 'create');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Beim Start fragt der Dialog, bevor der Ladebildschirm von selbst ginge —
  // der läge sonst über der Frage.
  useEffect(hideSplash, []);

  // Beim Wechsel zwischen den Schritten keine Fehlermeldung des vorigen mitnehmen.
  useEffect(() => { setError(''); }, [step]);

  const newPasswordError = (): string => {
    if (password.length < MIN_PASSWORD_LENGTH) return t('vaultKey.tooShort', { count: MIN_PASSWORD_LENGTH });
    if (password !== repeat) return t('vaultKey.mismatch');
    return '';
  };

  async function attempt(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      const code = keyErrorOf(err);
      if (code === KEY_ERRORS.wrongPassword) setError(t('vaultKey.wrongPassword'));
      else if (code === KEY_ERRORS.wrongRecoveryKey) setError(t('vaultKey.wrongRecoveryKey'));
      else if (code === KEY_ERRORS.passwordTooShort) setError(t('vaultKey.tooShort', { count: MIN_PASSWORD_LENGTH }));
      else {
        console.error('[vault-key]', err);
        setError(t('vaultKey.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const submitUnlock = () => attempt(async () => {
    if (!password) return;
    await unlockVault(request.vaultId, password, remember);
    finish();
  });

  const submitRecover = () => attempt(async () => {
    const problem = newPasswordError();
    if (problem) { setError(problem); return; }
    await recoverVault(request.vaultId, recoveryInput, password, remember);
    finish();
  });

  const submitCreate = () => attempt(async () => {
    const problem = newPasswordError();
    if (problem) { setError(problem); return; }
    setRecoveryKey(await createVaultKey(request.vaultId, password, remember));
    setPassword('');
    setRepeat('');
    setStep('showRecovery');
  });

  async function copyRecoveryKey() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch (err) {
      console.error('[vault-key] copy failed', err);
    }
  }

  const onEnter = (submit: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  const title = {
    unlock: t('vaultKey.unlockTitle', { name: request.vaultName }),
    recover: t('vaultKey.recoverTitle'),
    create: t('vaultKey.createTitle', { name: request.vaultName }),
    showRecovery: t('vaultKey.recoveryTitle'),
  }[step];

  // Nach dem Anlegen ist der Vault schon verschlüsselt — Abbrechen hieße dann
  // nur noch, den Wiederherstellungsschlüssel ungesehen wegzuklicken.
  const canCancel = request.cancellable && step !== 'showRecovery';

  const rememberRow = (
    <SwitchRow
      variant="panel"
      icon={Smartphone}
      label={t('vaultKey.remember')}
      hint={t('vaultKey.rememberHint')}
      checked={remember}
      onChange={setRemember}
    />
  );

  const passwordFields = (submit: () => void, autoFocus: boolean) => (
    <>
      <Field label={t('vaultKey.newPassword')}>
        <input
          type="password"
          autoFocus={autoFocus}
          autoComplete="new-password"
          className="input-field settings-field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onEnter(submit)}
        />
      </Field>
      <Field label={t('vaultKey.repeatPassword')}>
        <input
          type="password"
          autoComplete="new-password"
          className="input-field settings-field"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          onKeyDown={onEnter(submit)}
        />
      </Field>
    </>
  );

  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (step === 'unlock') {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.unlockHint')}</p>
        <Field label={t('vaultKey.password')}>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            className="input-field settings-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter(submitUnlock)}
          />
        </Field>
        {rememberRow}
        <div>
          <Button variant="ghost" className="text-xs" onClick={() => setStep('recover')}>
            {t('vaultKey.forgot')}
          </Button>
        </div>
      </>
    );
    actions = (
      <Button variant="primary" disabled={!password || busy} onClick={submitUnlock}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
        {t('vaultKey.unlock')}
      </Button>
    );
  } else if (step === 'recover') {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.recoverHint')}</p>
        <Field label={t('vaultKey.recoveryKey')}>
          <textarea
            autoFocus
            rows={2}
            spellCheck={false}
            className="input-field settings-field font-mono resize-none"
            value={recoveryInput}
            onChange={(e) => setRecoveryInput(e.target.value)}
          />
        </Field>
        {passwordFields(submitRecover, false)}
        {rememberRow}
      </>
    );
    actions = (
      <>
        <Button variant="secondary" onClick={() => setStep('unlock')}>{t('vaultKey.back')}</Button>
        <Button variant="primary" disabled={!recoveryInput.trim() || !password || busy} onClick={submitRecover}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {t('vaultKey.recoverSubmit')}
        </Button>
      </>
    );
  } else if (step === 'create') {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.createHint')}</p>
        {passwordFields(submitCreate, true)}
        {rememberRow}
      </>
    );
    actions = (
      <Button variant="primary" disabled={!password || busy} onClick={submitCreate}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        {t('vaultKey.createSubmit')}
      </Button>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.recoveryHint')}</p>
        <div className="settings-row font-mono text-sm select-all break-all">{recoveryKey}</div>
        <div>
          <Button variant="secondary" onClick={copyRecoveryKey}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('vaultKey.copied') : t('vaultKey.copy')}
          </Button>
        </div>
        <SwitchRow
          variant="panel"
          label={t('vaultKey.stored')}
          checked={stored}
          onChange={setStored}
        />
      </>
    );
    actions = (
      <Button variant="primary" disabled={!stored} onClick={finish}>
        {t('vaultKey.done')}
      </Button>
    );
  }

  return (
    <Modal
      title={title}
      onClose={cancel}
      dismissible={canCancel}
      widthClassName="w-[440px]"
      bodyClassName="px-5 py-4 space-y-4"
    >
      {body}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {canCancel && <Button variant="secondary" onClick={cancel}>{t('vault.cancel')}</Button>}
        {actions}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs block mb-2">{label}</span>
      {children}
    </label>
  );
}
