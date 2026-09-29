import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useLeaveGuardStore } from '../../store/leaveGuardStore';

/**
 * Die Frage beim Verlassen einer Bearbeitung mit Änderungen (siehe
 * `leaveGuardStore`). Escape, das X und der Klick daneben heißen „Weiter
 * bearbeiten" — nichts wird aus Versehen übernommen oder verworfen.
 */
export default function LeaveGuardModal() {
  const { t } = useTranslation();
  const question = useLeaveGuardStore((s) => s.question);
  if (!question) return null;

  return (
    <Modal title={t('leaveGuard.title')} onClose={() => question.answer('stay')} widthClassName="w-[420px]" bodyClassName="p-4 space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        {t('leaveGuard.message', { name: question.title })}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button tone="neutral" onClick={() => question.answer('stay')}>{t('leaveGuard.stay')}</Button>
        <Button tone="danger" onClick={() => question.answer('discard')}>{t('leaveGuard.discard')}</Button>
        {/* Fokus hierher: das Modal hat kein Eingabefeld, und Enter träfe sonst den Editor dahinter. */}
        <Button tone="jade" autoFocus onClick={() => question.answer('save')}>{t('common.save')}</Button>
      </div>
    </Modal>
  );
}
