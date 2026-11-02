import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useLeaveGuardStore } from '../../store/leaveGuardStore';

/**
 * The question when leaving an edit with changes (see
 * `leaveGuardStore`). Escape, the X and a click outside mean "Keep
 * editing" — nothing is accidentally saved or discarded.
 */
export default function LeaveGuardModal() {
  const { t } = useTranslation();
  const question = useLeaveGuardStore((s) => s.question);
  if (!question) return null;

  return (
    <Modal title={t('leaveGuard.title')} onClose={() => question.answer('stay')} widthClassName="w-[420px]" bodyClassName="px-3.5 py-4" footer={
      <>
        <Button tone="neutral" onClick={() => question.answer('stay')}>{t('leaveGuard.stay')}</Button>
        <Button tone="danger" onClick={() => question.answer('discard')}>{t('leaveGuard.discard')}</Button>
        {/* Focus here: the modal has no input field, and Enter would otherwise hit the editor behind it. */}
        <Button tone="jade" autoFocus onClick={() => question.answer('save')}>{t('common.save')}</Button>
      </>
    }>
      <p className="text-sm text-secondary">
        {t('leaveGuard.message', { name: question.title })}
      </p>
    </Modal>
  );
}
