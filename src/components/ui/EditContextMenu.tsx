import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from './ContextMenu';
import {
  copySelection,
  cutSelection,
  pasteFromClipboard,
  selectAll,
} from '../layout/titlebar/editCommands';

/**
 * Das Bearbeiten-Kontextmenue der App — und zugleich die Stelle, die das native
 * Menue der WebView ueberall unterdrueckt.
 *
 * Das native Menue ist in einer Desktop-App ein Fremdkoerper: es bietet "Neu
 * laden", "Zurueck" und "Bild speichern unter" an, Browser-Begriffe fuer eine
 * App, die keine Seiten hat. Hier gilt deshalb die Umkehrung der
 * Browser-Voreinstellung: kein Kontextmenue, ausser die App macht selbst eines
 * auf. In einem Textfeld ist das ab jetzt dieses hier — Ausschneiden, Kopieren,
 * Einfuegen und Alles auswaehlen, mit denselben Befehlen, die auch das
 * Bearbeiten-Menue der Titelleiste benutzt.
 *
 * Eine Ausnahme bleibt: der Editor. Die Rechtschreibvorschlaege haengen am
 * nativen Menue und sind aus JS nicht nachzubauen — wo Fliesstext entsteht,
 * wiegt das schwerer als eine einheitliche Menue-Optik. Dort laeuft der
 * Rechtsklick deshalb unangetastet durch. Einzeilige Felder tragen Namen und
 * Titel, keine Rechtschreibung; sie bekommen unser Menue.
 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/** Alles andere — Datum, Checkbox, Farbe, Datei — ist kein Textfeld, auch wenn
 *  es ein <input> ist. Die Export-Filter haben zwei Datumsfelder. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

interface EditMenuState {
  x: number;
  y: number;
  /** Das Textfeld, auf das sich das Menue bezieht — `null` bei markiertem Text
   *  ausserhalb eines Feldes, wo es nur Kopieren gibt. */
  field: HTMLElement | null;
  hasSelection: boolean;
  canWrite: boolean;
}

function isTextField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return true;
}

function canWrite(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  return el.isContentEditable;
}

function documentHasSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
}

function fieldHasSelection(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // selectionStart ist bei manchen Typen null; dann gibt es auch nichts zu
    // kopieren. TEXT_INPUT_TYPES haelt die Faelle ohnehin schon draussen.
    const { selectionStart, selectionEnd } = el;
    return selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd;
  }
  return documentHasSelection();
}

export default function EditContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<EditMenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
      const field = editable && isTextField(editable) ? editable : null;

      // Der Editor behaelt das native Menue, wegen der Rechtschreibvorschlaege
      // (siehe oben). `isContentEditable` trifft nur den beschreibbaren
      // Editor; im Lesemodus steht contenteditable auf "false", dort greift
      // weiter unten der Zweig fuer markierten Text.
      if (field?.isContentEditable) return;

      // Jedes eigene Kontextmenue der App ruft in seinem Handler
      // preventDefault — daran erkennt dieser Listener, dass die Stelle schon
      // vergeben ist. Ein Textfeld gewinnt trotzdem: dort will niemand das
      // Menue der Zeile, sondern Ausschneiden und Einfuegen. Heute
      // ueberschneidet sich beides nirgends, die Reihenfolge ist Vorsorge.
      if (!field && event.defaultPrevented) return;

      // Ab hier bleibt das native Menue in jedem Fall weg, auch wenn wir
      // selbst nichts anzubieten haben.
      event.preventDefault();

      if (field) {
        setMenu({
          x: event.clientX,
          y: event.clientY,
          field,
          hasSelection: fieldHasSelection(field),
          canWrite: canWrite(field),
        });
        return;
      }

      setMenu(
        documentHasSelection()
          ? { x: event.clientX, y: event.clientY, field: null, hasSelection: true, canWrite: false }
          : null,
      );
    };

    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  if (!menu) return null;

  const actions: ContextMenuAction[] = [];

  if (menu.canWrite) {
    actions.push({
      label: t('menu.cut'),
      icon: <Scissors size={12} />,
      onClick: cutSelection,
      disabled: !menu.hasSelection,
    });
  }

  actions.push({
    label: t('menu.copy'),
    icon: <Copy size={12} />,
    onClick: copySelection,
    disabled: !menu.hasSelection,
  });

  if (menu.canWrite) {
    actions.push({
      label: t('menu.paste'),
      icon: <ClipboardPaste size={12} />,
      onClick: () => {
        // pasteFromClipboard schickt sein Ereignis an document.activeElement.
        // Normalerweise ist das Feld schon fokussiert — der Rechtsklick
        // erledigt das —, aber ohne Fokus ginge das Eingefuegte ins Leere.
        const { field } = menu;
        if (field && !field.contains(document.activeElement)) field.focus();
        void pasteFromClipboard();
      },
    });
  }

  if (menu.field) {
    actions.push({
      label: t('menu.selectAll'),
      icon: <TextSelect size={12} />,
      onClick: selectAll,
    });
  }

  return <ContextMenu x={menu.x} y={menu.y} actions={actions} onClose={() => setMenu(null)} />;
}
