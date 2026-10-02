import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Smartphone } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { SwitchRow } from '../ui/Switch';
import RecoveryKeyBox from './RecoveryKeyBox';
import { KeyField, NewPasswordFields, keyErrorText, newPasswordProblem, onEnter } from './vaultKeyParts';
import { useVaultKeyStore, type VaultKeyRequest } from '../../store/vaultKeyStore';
import { createVaultKey, encryptExistingVault, keychainAvailable, recoverVault, unlockVault } from '../../lib/vaultKeys';
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

/** `rememberFailed`: entsperrt, aber der Schlüsselbund hat das Merken abgelehnt. */
type Step = 'unlock' | 'recover' | 'create' | 'encrypt' | 'showRecovery' | 'rememberFailed';

const FAILED_KEY = {
  unlock: 'vaultKey.unlockFailed',
  recover: 'vaultKey.recoverFailed',
  create: 'vaultKey.createFailed',
  encrypt: 'vaultKey.encryptFailed',
} as const;

function VaultKeyDialogBody({ request }: { request: VaultKeyRequest }) {
  const { t } = useTranslation();
  const finish = useVaultKeyStore((s) => s.finish);
  const cancel = useVaultKeyStore((s) => s.cancel);

  const [step, setStep] = useState<Step>(request.kind);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  // Beim Anlegen und Verschlüsseln an — der übliche Wunsch auf dem eigenen
  // Rechner. Beim Entsperren aus, aber nur angezeigt: solange niemand den
  // Schalter bewegt, bleibt der Schlüsselbund, wie er ist (`rememberTouched`).
  const newKey = request.kind !== 'unlock';
  const [remember, setRemember] = useState(newKey);
  const [rememberTouched, setRememberTouched] = useState(newKey);
  const [keychain, setKeychain] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [rememberRefused, setRememberRefused] = useState(false);
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Beim Start fragt der Dialog, bevor der Ladebildschirm von selbst ginge —
  // der läge sonst über der Frage.
  useEffect(hideSplash, []);

  useEffect(() => {
    let live = true;
    keychainAvailable().then((available) => { if (live) setKeychain(available); }, () => {});
    return () => { live = false; };
  }, []);

  // Beim Wechsel zwischen den Schritten keine Fehlermeldung des vorigen mitnehmen.
  useEffect(() => { setError(''); }, [step]);

  const rememberWish = keychain && rememberTouched ? remember : undefined;

  async function attempt(kind: keyof typeof FAILED_KEY, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(keyErrorText(t, err, FAILED_KEY[kind]));
    } finally {
      setBusy(false);
    }
  }

  /** Nach dem Entsperren: weiter — oder erst sagen, dass das Merken nicht ging. */
  const unlocked = (remembered: boolean) => {
    if (rememberWish && !remembered) setStep('rememberFailed');
    else finish();
  };

  const submitUnlock = () => attempt('unlock', async () => {
    if (!password) return;
    unlocked(await unlockVault(request.vaultId, password, rememberWish));
  });

  const submitRecover = () => attempt('recover', async () => {
    const problem = newPasswordProblem(t, password, repeat);
    if (problem) { setError(problem); return; }
    unlocked(await recoverVault(request.vaultId, recoveryInput, password, rememberWish));
  });

  /** Neuer Vault oder Verschlüsselung eines alten — beide enden beim Wiederherstellungsschlüssel. */
  const submitNewKey = (kind: 'create' | 'encrypt') => attempt(kind, async () => {
    const problem = newPasswordProblem(t, password, repeat);
    if (problem) { setError(problem); return; }
    const make = kind === 'create' ? createVaultKey : encryptExistingVault;
    const created = await make(request.vaultId, password, rememberWish);
    setRecoveryKey(created.recoveryKey);
    setRememberRefused(Boolean(rememberWish) && !created.remembered);
    setPassword('');
    setRepeat('');
    setStep('showRecovery');
  });

  const title = {
    unlock: t('vaultKey.unlockTitle', { name: request.vaultName }),
    recover: t('vaultKey.recoverTitle'),
    create: t('vaultKey.createTitle', { name: request.vaultName }),
    encrypt: t('vaultKey.encryptTitle', { name: request.vaultName }),
    showRecovery: t('vaultKey.recoveryTitle'),
    rememberFailed: t('vaultKey.unlockTitle', { name: request.vaultName }),
  }[step];

  // Abbrechen geht nur, solange noch nichts geschehen ist: nach dem Anlegen
  // hieße es, den Wiederherstellungsschlüssel ungesehen wegzuklicken, und
  // während eine Aktion läuft, käme Rust mit ihr trotzdem durch.
  const cancelShown = step === 'unlock' || step === 'recover' || step === 'create' || step === 'encrypt';

  const busyIcon = busy ? <Loader2 size={16} className="animate-spin" /> : null;

  const rememberRow = (
    <SwitchRow
      variant="panel"
      icon={Smartphone}
      label={t('vaultKey.remember')}
      hint={keychain ? t('vaultKey.rememberHint') : t('vaultKey.rememberUnavailable')}
      checked={keychain && remember}
      disabled={!keychain || busy}
      onChange={(next) => { setRemember(next); setRememberTouched(true); }}
    />
  );

  const errorLine = error ? <p className="text-xs text-danger" role="alert">{error}</p> : null;

  const passwordFields = (submit: () => void, autoFocus: boolean) => (
    <NewPasswordFields
      t={t}
      password={password}
      repeat={repeat}
      onPassword={setPassword}
      onRepeat={setRepeat}
      disabled={busy}
      autoFocus={autoFocus}
      onSubmit={submit}
    />
  );

  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (step === 'unlock') {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.unlockHint')}</p>
        <KeyField label={t('vaultKey.password')}>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            className="input-field settings-field"
            value={password}
            disabled={busy}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter(submitUnlock)}
          />
        </KeyField>
        {rememberRow}
        <div>
          {/* Ein Link, kein Knopf: bündig mit den Feldern statt um die
              Innenabstände von `.btn-ghost` eingerückt. */}
          <Button variant="ghost" className="text-xs -ml-1.5" disabled={busy} onClick={() => setStep('recover')}>
            {t('vaultKey.forgot')}
          </Button>
        </div>
        {errorLine}
      </>
    );
    actions = (
      <Button tone="jade" disabled={!password || busy} onClick={submitUnlock}>
        {busyIcon ?? <KeyRound size={14} />}
        {t('vaultKey.unlock')}
      </Button>
    );
  } else if (step === 'recover') {
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.recoverHint')}</p>
        <KeyField label={t('vaultKey.recoveryKey')}>
          <textarea
            autoFocus
            rows={2}
            spellCheck={false}
            className="input-field settings-field font-mono resize-none"
            value={recoveryInput}
            disabled={busy}
            onChange={(e) => setRecoveryInput(e.target.value)}
          />
        </KeyField>
        {passwordFields(submitRecover, false)}
        {rememberRow}
        {errorLine}
      </>
    );
    actions = (
      <>
        <Button tone="neutral" disabled={busy} onClick={() => setStep('unlock')}>{t('vaultKey.back')}</Button>
        <Button tone="jade" disabled={!recoveryInput.trim() || !password || busy} onClick={submitRecover}>
          {busyIcon}
          {t('vaultKey.recoverSubmit')}
        </Button>
      </>
    );
  } else if (step === 'create') {
    const submit = () => submitNewKey('create');
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.createHint')}</p>
        {passwordFields(submit, true)}
        {rememberRow}
        {errorLine}
      </>
    );
    actions = (
      <Button tone="jade" disabled={!password || busy} onClick={submit}>
        {busyIcon}
        {t('vaultKey.createSubmit')}
      </Button>
    );
  } else if (step === 'encrypt') {
    const submit = () => submitNewKey('encrypt');
    body = (
      <>
        <p className="text-sm text-secondary">{t('vaultKey.encryptHint')}</p>
        <p className="text-xs text-muted">{t('vaultKey.encryptNote')}</p>
        {passwordFields(submit, true)}
        {rememberRow}
        {errorLine}
      </>
    );
    actions = (
      <Button tone="jade" disabled={!password || busy} onClick={submit}>
        {busyIcon}
        {busy ? t('vaultKey.encrypting') : t('vaultKey.createSubmit')}
      </Button>
    );
  } else if (step === 'showRecovery') {
    body = (
      <>
        <RecoveryKeyBox recoveryKey={recoveryKey} stored={stored} onStoredChange={setStored} />
        {rememberRefused && <p className="text-xs text-secondary" role="status">{t('vaultKey.rememberFailed')}</p>}
      </>
    );
    actions = (
      <Button tone="jade" disabled={!stored} onClick={finish}>
        {t('vaultKey.done')}
      </Button>
    );
  } else {
    body = <p className="text-sm text-secondary" role="status">{t('vaultKey.rememberFailed')}</p>;
    actions = (
      <Button tone="jade" autoFocus onClick={finish}>
        {t('vaultKey.continue')}
      </Button>
    );
  }

  return (
    <Modal
      title={title}
      onClose={cancel}
      dismissible={cancelShown && !busy}
      widthClassName="w-[440px]"
      bodyClassName="px-5 py-4 space-y-4"
    >
      {body}
      <div className="flex justify-end gap-2 pt-1">
        {cancelShown && <Button tone="neutral" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>}
        {actions}
      </div>
    </Modal>
  );
}
