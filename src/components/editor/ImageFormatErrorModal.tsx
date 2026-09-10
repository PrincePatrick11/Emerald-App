import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

/** Hinweis, wenn keine der aus dem Explorer gezogenen Dateien ein erlaubtes Bildformat hat. */
export default function ImageFormatErrorModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('common.unsupportedImageFormat')}
      onClose={onClose}
      widthClassName="w-72"
      bodyClassName="px-4 py-3"
    >
      <div className="flex items-center gap-2 text-red-400 mb-2">
        <AlertCircle size={14} />
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>PNG, JPEG, GIF, WebP, SVG</p>
      </div>
      <Button onClick={onClose} variant="secondary" className="w-full">
        {t('common.ok')}
      </Button>
    </Modal>
  );
}
