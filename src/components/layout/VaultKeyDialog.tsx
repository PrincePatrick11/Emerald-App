import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Smartphone } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { SwitchRow } from '../ui/Switch';
import RecoveryKeyBox from './RecoveryKeyBox';
import {
  KeyField, NewPasswordFields, ReencryptProgressLine, keyErrorText, newPasswordProblem, onEnter,
} from './vaultKeyParts';
import { useVaultKeyStore, type VaultKeyRequest } from '../../store/vaultKeyStore';
import {
  createVaultKey, keychainAvailable, recoverVault, unlockVault, type CreatedKey,
} from '../../lib/vaultKeys';
import { hideSplash } from '../../lib/splash';

/**
 * Set a password, unlock, set a new password with the recovery key —
 * the questions of `ensureVaultReady`.
 *
 * Sits above everything, including the vault picker: a vault that is about to
 * be opened cannot go any further without this answer.
 */
export default function VaultKeyDialog() {
  const request = useVaultKeyStore((s) => s.request);
  if (!request) return null;
  // The key: every new question starts with empty fields.
  return <VaultKeyDialogBody key={`${request.kind}:${request.vaultId}`} request={request} />;
}

/** `rememberFailed`: unlocked, but the keychain refused to remember it. */
type Step = 'unlock' | 'recover' | 'create' | 'showRecovery' | 'rememberFailed';

const FAILED_KEY = {
  unlock: 'vaultKey.unlockFailed',
  recover: 'vaultKey.recoverFailed',
  create: 'vaultKey.createFailed',
} as const;

function VaultKeyDialogBody({ request }: { request: VaultKeyRequest }) {
  const { t } = useTranslation();
  const finish = useVaultKeyStore((s) => s.finish);
  const cancel = useVaultKeyStore((s) => s.cancel);

  const [step, setStep] = useState<Step>(request.kind);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  // On when creating — the usual wish on one's own
  // computer. Off when unlocking, but only displayed: as long as nobody moves
  // the switch, the keychain stays as it is (`rememberTouched`).
  const newKey = request.kind !== 'unlock';
  const [remember, setRemember] = useState(newKey);
  const [rememberTouched, setRememberTouched] = useState(newKey);
  const [keychain, setKeychain] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [rememberRefused, setRememberRefused] = useState(false);
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // At startup the dialog asks before the loading screen would go away by itself —
  // it would otherwise lie over the question.
  useEffect(hideSplash, []);

  useEffect(() => {
    let live = true;
    keychainAvailable().then((available) => { if (live) setKeychain(available); }, () => {});
    return () => { live = false; };
  }, []);

  // Do not carry the previous step's error message over when switching between steps.
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

  /** After unlocking: continue — or first say that remembering did not work. */
  const unlocked = (remembered: boolean) => {
    if (rememberWish && !remembered) setStep('rememberFailed');
    else finish();
  };

  const submitUnlock = () => attempt('unlock', async () => {
    if (!password) return;
    unlocked(await unlockVault(request.vaultId, password, rememberWish));
  });

  /**
   * Everything that makes a new key — new vault, "Forgot password" — ends at
   * the new recovery key.
   */
  const submitNewKey = (kind: 'create' | 'recover') => attempt(kind, async () => {
    const problem = newPasswordProblem(t, password, repeat);
    if (problem) { setError(problem); return; }
    const created: CreatedKey = kind === 'recover'
      ? await recoverVault(request.vaultId, recoveryInput, password, rememberWish)
      : await createVaultKey(request.vaultId, password, rememberWish);
    setRecoveryKey(created.recoveryKey);
    setRememberRefused(Boolean(rememberWish) && !created.remembered);
    setPassword('');
    setRepeat('');
    setRecoveryInput('');
    setStep('showRecovery');
  });
  const submitRecover = () => submitNewKey('recover');

  const title = {
    unlock: t('vaultKey.unlockTitle', { name: request.vaultName }),
    recover: t('vaultKey.recoverTitle'),
    create: t('vaultKey.createTitle', { name: request.vaultName }),
    showRecovery: t('vaultKey.recoveryTitle'),
    rememberFailed: t('vaultKey.rememberFailedTitle', { name: request.vaultName }),
  }[step];

  // Cancelling is only possible while nothing has happened yet: after creating
  // it would mean clicking away the recovery key unseen, and
  // while an action is running, Rust would get through with it anyway.
  const cancelShown = step === 'unlock' || step === 'recover' || step === 'create';

  const busyIcon = busy ? <Loader2 size={14} className="animate-spin" /> : null;

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
          {/* A link, not a button: flush with the fields instead of indented by
              the inner padding of `.btn-ghost`. */}
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
      bodyClassName="modal-body space-y-4"
      footer={
        <>
          {cancelShown && <Button tone="neutral" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>}
          {actions}
        </>
      }
    >
      {body}
      {/* "Forgot password" rewrites the whole vault. */}
      <ReencryptProgressLine vaultId={request.vaultId} active={busy && step === 'recover'} />
    </Modal>
  );
}
