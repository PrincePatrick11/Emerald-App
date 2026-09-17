import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Modal from './Modal';
import { imageSizeLabel } from '../../lib/imageLimits';
import { useImageNoticeStore } from '../../store/imageNoticeStore';

/**
 * Warum ein Bild nicht eingefügt wurde — für die Wege ohne eigene Meldezeile
 * (siehe `imageNoticeStore`). Einmal in der AppShell.
 */
export default function ImageNoticeModal() {
  const { t } = useTranslation();
  const notice = useImageNoticeStore((s) => s.notice);
  const dismiss = useImageNoticeStore((s) => s.dismiss);
  if (!notice) return null;

  const tooLarge = notice.kind === 'tooLarge';
  const detail = tooLarge
    ? t('common.imageTooLargeDetail', { max: imageSizeLabel(notice.maxBytes, t('common.megabytes')) })
    : 'PNG, JPEG, GIF, WebP, SVG';

  return (
    <Modal
      title={tooLarge ? t('common.imageTooLarge') : t('common.unsupportedImageFormat')}
      onClose={dismiss}
      widthClassName="w-72"
      bodyClassName="px-4 py-3"
    >
      <div className="flex items-start gap-2 text-danger mb-2">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{detail}</p>
      </div>
      <Button onClick={dismiss} variant="secondary" className="w-full">
        {t('common.ok')}
      </Button>
    </Modal>
  );
}
