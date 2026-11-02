import { BookOpen, Library, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportDestinationType } from '../../store/importStore';
import Modal from './Modal';
import Button from './Button';

const OPTIONS: { type: ImportDestinationType; icon: React.ReactNode; labelKey: string }[] = [
  { type: 'journal', icon: <BookOpen size={14} />, labelKey: 'linkPicker.tabJournal' },
  { type: 'wiki', icon: <Library size={14} />, labelKey: 'linkPicker.tabWiki' },
  { type: 'operations', icon: <Wand2 size={14} />, labelKey: 'linkPicker.tabOperations' },
];

export default function ImportDestinationModal() {
  const { t } = useTranslation();
  const pending = useImportStore((s) => s.pending);
  const choose = useImportStore((s) => s.choose);
  const cancel = useImportStore((s) => s.cancel);

  if (!pending) return null;

  return (
    <Modal title={t('importDestination.title')} onClose={cancel}
      widthClassName="w-[420px]"
      className="overflow-hidden"
      bodyClassName="px-3.5 py-4 space-y-3"
      footer={<Button tone="neutral" onClick={cancel}>{t('importDestination.cancel')}</Button>}
    >
        <p className="text-sm text-muted">
          {t('importDestination.description', { title: pending.title })}
        </p>
        <div className="space-y-1">
          {OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => choose(opt.type)}
              className="menu-item rounded-md"
            >
              {opt.icon}
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
    </Modal>
  );
}
