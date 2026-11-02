import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Modal from './Modal';
import { imageSizeLabel } from '../../lib/imageLimits';
import { useImageNoticeStore } from '../../store/imageNoticeStore';

/**
 * Why an image was not inserted, for the paths without their own notice row
 * (see `imageNoticeStore`). Once in the AppShell.
 */
export default function ImageNoticeModal() {
  const { t } = useTranslation();
  const notice = useImageNoticeStore((s) => s.notice);
  const dismiss = useImageNoticeStore((s) => s.dismiss);
  if (!notice) return null;

  const tooLarge = notice.kind === 'tooLarge';
  const detail = tooLarge
    ? t('common.imageTooLargeDetail', { max: imageSizeLabel(notice.maxBytes, t('common.megabytes')) })
    // The list as its own key: the title only names the reason,
    // otherwise the formats would appear twice, one below the other.
    : t('common.acceptedImageFormats');

  return (
    <Modal
      title={tooLarge ? t('common.imageTooLarge') : t('common.unsupportedImageFormatTitle')}
      onClose={dismiss}
      widthClassName="w-72"
      bodyClassName="px-3.5 py-4"
      footer={<Button tone="neutral" onClick={dismiss}>{t('common.ok')}</Button>}
    >
      <div className="flex items-start gap-2 text-danger">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <p className="text-sm text-secondary">{detail}</p>
      </div>
    </Modal>
  );
}
