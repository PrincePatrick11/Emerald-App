import { BookOpen, Library, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportDestinationType } from '../../store/importStore';
import Modal from './Modal';
import Button from './Button';

const OPTIONS: { type: ImportDestinationType; icon: React.ReactNode; labelKey: string }[] = [
  { type: 'journal', icon: <BookOpen size={12} />, labelKey: 'linkPicker.tabJournal' },
  { type: 'wiki', icon: <Library size={12} />, labelKey: 'linkPicker.tabWiki' },
  { type: 'operations', icon: <Wand2 size={12} />, labelKey: 'linkPicker.tabOperations' },
];

export default function ImportDestinationModal() {
  const { t } = useTranslation();
  const pending = useImportStore((s) => s.pending);
  const choose = useImportStore((s) => s.choose);
  const cancel = useImportStore((s) => s.cancel);

  if (!pending) return null;

  return (
    <Modal title={t('importDestination.title')} onClose={cancel} widthClassName="w-[420px]" className="overflow-hidden">
      <div className="px-4 py-3">
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          {t('importDestination.description', { title: pending.title })}
        </p>
        <div className="space-y-1">
          {OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => choose(opt.type)}
              className="context-menu-item-default w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left text-stone-300 hover:text-stone-100 hover:bg-stone-700/50 transition-colors"
            >
              <span className="opacity-70">{opt.icon}</span>
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end px-4 py-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <Button onClick={cancel} variant="secondary">
          {t('importDestination.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
