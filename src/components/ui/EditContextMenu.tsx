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
 * The app's edit context menu, and at the same time the place that suppresses
 * the WebView's native menu everywhere.
 *
 * In a desktop app the native menu is a foreign body: it offers "Reload",
 * "Back" and "Save image as", browser terms for an
 * app that has no pages. So the browser default is reversed here:
 * no context menu unless the app opens one itself. In a text field that is
 * now this one: Cut, Copy, Paste and Select all, with the same commands
 * the title bar's Edit menu uses.
 *
 * One exception remains: the editor. The spelling suggestions hang off the
 * native menu and cannot be rebuilt from JS; where running text is written,
 * that outweighs a uniform menu look. So there the right
 * click passes through untouched. Single-line fields carry names and
 * titles, not spelling; they get our menu.
 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/** Everything else (date, checkbox, colour, file) is not a text field, even if
 *  it is an <input>. The export filters have two date fields. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

interface EditMenuState {
  x: number;
  y: number;
  /** The text field the menu refers to; `null` for selected text
   *  outside a field, where there is only Copy. */
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
    // selectionStart is null for some types; then there is nothing to
    // copy either. TEXT_INPUT_TYPES already keeps those cases out anyway.
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

      // The editor keeps the native menu, because of the spelling suggestions
      // (see above). `isContentEditable` only matches the writable
      // editor; in read mode contenteditable is "false", and there the branch
      // for selected text further down applies.
      if (field?.isContentEditable) return;

      // Every context menu of the app calls preventDefault in its handler;
      // that is how this listener recognises that the spot is already
      // taken. A text field wins anyway: there nobody wants the
      // row's menu but Cut and Paste. Today
      // the two overlap nowhere, the ordering is precaution.
      if (!field && event.defaultPrevented) return;

      // From here on the native menu stays away in every case, even if we
      // have nothing to offer ourselves.
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
        // pasteFromClipboard sends its event to document.activeElement.
        // Normally the field is already focused (the right click
        // takes care of that), but without focus the pasted text would go nowhere.
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
