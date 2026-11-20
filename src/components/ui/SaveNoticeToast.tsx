import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useSaveNoticeStore } from '../../store/saveNoticeStore';

/** The notice for a change that could not be saved (see `saveNoticeStore`). Once in the AppShell. */
export default function SaveNoticeToast() {
  const { t } = useTranslation();
  const notice = useSaveNoticeStore((s) => s.notice);
  const dismiss = useSaveNoticeStore((s) => s.dismiss);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [notice?.id]);

  if (!notice) return null;

  return (
    <div role="alert" className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-well-solid border border-edge rounded-lg shadow-menu animate-slide-in">
      <span className="text-sm text-soft max-w-xs">{t('common.saveFailed')}</span>
      <button onClick={dismiss} className="flex-shrink-0 text-subtle hover:text-muted transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
