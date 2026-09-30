import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useUndoStore } from '../../store/undoStore';
import Button from './Button';

export default function UndoToast() {
  const { t } = useTranslation();
  const { active, executeUndo, dismiss } = useUndoStore(
    useShallow((s) => ({ active: s.active, executeUndo: s.executeUndo, dismiss: s.dismiss }))
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dismiss(), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [active?.id]);

  if (!active) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-stone-800 border border-stone-700/60 rounded-xl shadow-xl animate-slide-in">
      <span className="text-sm text-stone-300 max-w-xs truncate">{active.description}</span>
      <Button
        onClick={executeUndo}
        variant="primary"
        className="flex-shrink-0"
      >
        {t('undo.action')}
      </Button>
      <button onClick={dismiss} className="flex-shrink-0 text-stone-600 hover:text-stone-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
