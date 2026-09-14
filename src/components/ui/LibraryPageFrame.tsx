import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { EditActionBar } from './SidebarColumn';
import { ENTRY_TITLE_INPUT_CLASSES } from './EntryDetailFrame';
import BlockGlyph from '../blocks/BlockGlyph';
import { useUIStore } from '../../store/uiStore';

interface Props {
  /** Die Brotkrume: zurück zur Liste (lässt einen Entwurf liegen). */
  backLabel: string;
  onBack: () => void;
  icon: string;
  dirty: boolean;
  busy: boolean;
  onDone: () => void;
  onCancel: () => void;
  onDelete: () => void;
  name: string;
  nameLabel: string;
  namePlaceholder: string;
  onNameChange: (name: string) => void;
  /** Der Körper der Seitenleiste unter Fertig/Löschen/Abbrechen. */
  sidebar: ReactNode;
  /** Der scrollende Körper der Seite. */
  children: ReactNode;
}

/**
 * Der Rahmen der Seiten, die erst mit „Fertig" speichern — ein eigener Block,
 * eine Vorlage. Gebaut wie `EntryDetailFrame` im Bearbeiten: Topbar mit
 * Brotkrume, Icon und „Ungespeichert", der Name als Titel, darunter der
 * scrollende Körper; in der Seitenleiste oben Fertig, Löschen und Abbrechen.
 * Ist die Seitenleiste zu, stehen Fertig und Abbrechen oben in der Topbar.
 */
export default function LibraryPageFrame({
  backLabel, onBack, icon, dirty, busy, onDone, onCancel, onDelete,
  name, nameLabel, namePlaceholder, onNameChange, sidebar, children,
}: Props) {
  const { t } = useTranslation();
  const sidebarOpen = useUIStore((s) => s.rightSidebarOpen);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600 min-w-0">
          <button type="button" onClick={onBack} className="text-stone-500 transition-colors hover:text-stone-300">
            {backLabel}
          </button>
          <BlockGlyph icon={icon} size={14} />
          {dirty && <span className="text-stone-700 italic ml-1">{t('editor.unsaved')}</span>}
        </div>
        {!sidebarOpen && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button tone="jade" small disabled={busy} onClick={onDone}>
              <Check size={12} />
              <span>{t('editor.done')}</span>
            </Button>
            <Button tone="neutral" compact small title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={onCancel}>
              <X size={12} />
            </Button>
          </div>
        )}
      </div>

      <div className="px-8 pt-6 pb-4 flex-shrink-0">
        <input
          className={ENTRY_TITLE_INPUT_CLASSES}
          value={name}
          placeholder={namePlaceholder}
          aria-label={nameLabel}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>

      <SidebarPortal>
        <SidebarColumn bar={<EditActionBar onDone={onDone} onDelete={onDelete} onCancel={onCancel} busy={busy} />}>
          {sidebar}
        </SidebarColumn>
      </SidebarPortal>
    </div>
  );
}
