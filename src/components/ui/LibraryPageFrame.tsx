import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { EditActionBar } from './SidebarColumn';
import { ENTRY_TITLE_INPUT_CLASSES } from './EntryDetailFrame';
import BlockGlyph from '../blocks/BlockGlyph';
import { useUIStore } from '../../store/uiStore';

/**
 * Die Ausstattung einer Seite, die erst mit „Fertig" speichert: die Marke
 * „Ungespeichert" neben der Brotkrume, Fertig/Löschen/Abbrechen in der
 * Seitenleiste und — bei geschlossener Seitenleiste — Fertig und Abbrechen
 * oben in der Topbar. Die drei gehören zusammen und setzen `useDraftPage`
 * voraus; eine Seite ohne Entwurf lässt sie weg und bringt ihre eigene Leiste
 * mit (`bar`).
 */
export interface LibraryPageDraft {
  dirty: boolean;
  busy: boolean;
  onDone: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

interface Props {
  /** Die Brotkrume: zurück zur Liste (lässt einen Entwurf liegen). */
  backLabel: string;
  onBack: () => void;
  icon: string;
  name: string;
  nameLabel: string;
  namePlaceholder: string;
  onNameChange: (name: string) => void;
  /** Der Entwurfs-Betrieb — oder `bar` statt seiner, siehe `LibraryPageDraft`. */
  draft?: LibraryPageDraft;
  /** Die Leiste oben in der Seitenleiste, wenn die Seite keinen Entwurf hat. */
  bar?: ReactNode;
  /** Der Körper der Seitenleiste unter der Leiste. */
  sidebar: ReactNode;
  /** Der scrollende Körper der Seite. */
  children: ReactNode;
}

/**
 * Der Rahmen der Bibliotheksseiten — ein eigener Block, eine Vorlage, eine
 * Sprache des Lexikons. Gebaut wie `EntryDetailFrame` im Bearbeiten: Topbar
 * mit Brotkrume und Icon, der Name als Titel, darunter der scrollende Körper,
 * und in der Seitenleiste oben eine Leiste über dem Eigenschaften-Körper.
 *
 * Was in dieser Leiste steht, ist Sache der Seite: Entwurfsseiten reichen
 * `draft` herein und bekommen Fertig/Löschen/Abbrechen samt „Ungespeichert";
 * eine Seite, die sofort speichert, reicht ihre eigene `bar` und hat nichts
 * zurückzunehmen. Der Rahmen selbst — Brotkrume, Icon, Titelfeld, Scrollen,
 * die Portale — ist für beide derselbe.
 */
export default function LibraryPageFrame({
  backLabel, onBack, icon, name, nameLabel, namePlaceholder, onNameChange,
  draft, bar, sidebar, children,
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
          {draft?.dirty && <span className="text-stone-700 italic ml-1">{t('editor.unsaved')}</span>}
        </div>
        {draft && !sidebarOpen && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button tone="jade" small disabled={draft.busy} onClick={draft.onDone}>
              <Check size={12} />
              <span>{t('editor.done')}</span>
            </Button>
            <Button tone="neutral" compact small title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={draft.onCancel}>
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
        <SidebarColumn
          bar={draft
            ? <EditActionBar onDone={draft.onDone} onDelete={draft.onDelete} onCancel={draft.onCancel} busy={draft.busy} />
            : bar}
        >
          {sidebar}
        </SidebarColumn>
      </SidebarPortal>
    </div>
  );
}
