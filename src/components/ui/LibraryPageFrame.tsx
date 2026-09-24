import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { EditActionBar, SidebarActionBar } from './SidebarColumn';
import { ENTRY_TITLE_INPUT_CLASSES, EntryHeaderRow, EntryStatus } from './EntryDetailFrame';
import { useUIStore } from '../../store/uiStore';

/**
 * Die Ausstattung einer Seite, die erst mit „Fertig" speichert: der Status
 * „Ungespeichert" neben dem Titel, Fertig/Löschen/Abbrechen in der
 * Seitenleiste und — bei geschlossener Seitenleiste — Fertig und Abbrechen
 * in einer schmalen Leiste über dem Titel. Die drei gehören zusammen und
 * setzen `useDraftPage` voraus; eine Seite ohne Entwurf lässt sie weg und
 * bringt ihre eigenen Aktionen mit (`actions`).
 */
export interface LibraryPageDraft {
  dirty: boolean;
  busy: boolean;
  onDone: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

interface Props {
  /** Der Weg zurück zur Liste (lässt einen Entwurf liegen) — vorn in der Leiste der Seitenleiste. */
  backLabel: string;
  onBack: () => void;
  name: string;
  nameLabel: string;
  namePlaceholder: string;
  onNameChange: (name: string) => void;
  /** Der Entwurfs-Betrieb — oder `actions` statt seiner, siehe `LibraryPageDraft`. */
  draft?: LibraryPageDraft;
  /** Die Aktionen neben dem Zurück-Pfeil, wenn die Seite keinen Entwurf hat. */
  actions?: ReactNode;
  /** Der Körper der Seitenleiste unter der Leiste. */
  sidebar: ReactNode;
  /** Der scrollende Körper der Seite. */
  children: ReactNode;
}

/**
 * Der Rahmen der Bibliotheksseiten — ein eigener Block, eine Vorlage, eine
 * Sprache des Lexikons. Gebaut wie `EntryDetailFrame` im Bearbeiten: der Name
 * als Titel (rechts daneben „Ungespeichert"), darunter der scrollende Körper,
 * und in der Seitenleiste oben die Leiste — Zurück-Pfeil und Aktionen — über
 * dem Eigenschaften-Körper.
 *
 * Welche Aktionen dort stehen, ist Sache der Seite: Entwurfsseiten reichen
 * `draft` herein und bekommen Fertig/Löschen/Abbrechen samt „Ungespeichert";
 * eine Seite, die sofort speichert, reicht ihre eigenen `actions` und hat
 * nichts zurückzunehmen. Der Rahmen selbst — Zurück-Pfeil, Titelfeld,
 * Scrollen, die Portale — ist für beide derselbe.
 */
export default function LibraryPageFrame({
  backLabel, onBack, name, nameLabel, namePlaceholder, onNameChange,
  draft, actions, sidebar, children,
}: Props) {
  const { t } = useTranslation();
  const sidebarOpen = useUIStore((s) => s.rightSidebarOpen);

  return (
    <div className="h-full flex flex-col">
      <EntryHeaderRow
        back={{ label: backLabel, onClick: onBack }}
        meta={draft?.dirty && <EntryStatus tone="warning">{t('editor.unsaved')}</EntryStatus>}
      />

      {/* Nur bei geschlossener Seitenleiste: sonst gäbe es keinen Weg, den
          Entwurf zu speichern oder zu verwerfen. */}
      {draft && !sidebarOpen && (
        <div className="flex items-center px-6 pt-4 flex-shrink-0">
          <div className="ml-auto flex items-center gap-1.5">
            <Button tone="jade" small disabled={draft.busy} onClick={draft.onDone}>
              <Check size={12} />
              <span>{t('editor.done')}</span>
            </Button>
            <Button tone="neutral" compact small title={t('editor.cancel')} aria-label={t('editor.cancel')} onClick={draft.onCancel}>
              <X size={12} />
            </Button>
          </div>
        </div>
      )}

      <div className="px-8 pt-4 pb-4 flex-shrink-0">
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
            : <SidebarActionBar>{actions}</SidebarActionBar>}
        >
          {sidebar}
        </SidebarColumn>
      </SidebarPortal>
    </div>
  );
}
