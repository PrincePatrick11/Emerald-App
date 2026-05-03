import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useUndoStore } from '../../store/undoStore';

export default function UndoToast() {
  const { t } = useTranslation();
  const { activeToast, toastVisible, executeUndo, dismissToast } = useUndoStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toastVisible) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dismissToast(), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [activeToast?.id, toastVisible]);

  if (!toastVisible || !activeToast) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-stone-800 border border-stone-700/60 rounded-xl shadow-xl animate-slide-in">
      <span className="text-sm text-stone-300 max-w-xs truncate">{activeToast.description}</span>
      <button
        onClick={executeUndo}
        className="flex-shrink-0 px-3 py-1.5 bg-jade-900/40 hover:bg-jade-900/60 text-jade-400 text-xs font-medium rounded-md border border-jade-800/40 transition-colors"
      >
        {t('undo.action')}
      </button>
      <button onClick={dismissToast} className="flex-shrink-0 text-stone-600 hover:text-stone-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
