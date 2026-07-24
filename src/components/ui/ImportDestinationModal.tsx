import { useEffect } from 'react';
import { BookOpen, Library, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportDestinationType } from '../../store/importStore';

const OPTIONS: { type: ImportDestinationType; icon: React.ReactNode; labelKey: string }[] = [
  { type: 'journal', icon: <BookOpen size={16} />, labelKey: 'linkPicker.tabJournal' },
  { type: 'wiki', icon: <Library size={16} />, labelKey: 'linkPicker.tabWiki' },
  { type: 'operations', icon: <Wand2 size={16} />, labelKey: 'linkPicker.tabOperations' },
];

export default function ImportDestinationModal() {
  const { t } = useTranslation();
  const pending = useImportStore((s) => s.pending);
  const choose = useImportStore((s) => s.choose);
  const cancel = useImportStore((s) => s.cancel);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pending, cancel]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="bg-stone-900 border border-stone-700 rounded-xl shadow-2xl w-[420px] overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-700/60">
          <span className="text-sm font-medium text-stone-300">{t('importDestination.title')}</span>
        </div>

        <div className="px-4 py-3">
          <p className="text-sm text-stone-400 mb-3">
            {t('importDestination.description', { title: pending.title })}
          </p>
          <div className="space-y-1">
            {OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => choose(opt.type)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left text-stone-200 hover:bg-stone-800 transition-colors"
              >
                <span className="text-stone-500">{opt.icon}</span>
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-stone-700/40">
          <button
            onClick={cancel}
            className="btn-secondary px-3 py-1.5 rounded-lg text-sm"
          >
            {t('importDestination.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
