import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import {
  CheckSquare, Heading1, Heading2, Heading3, ImagePlus, Link, List, ListOrdered, Minus, Pilcrow, Quote, Table,
  type LucideIcon,
} from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, readFileAsDataUrl } from '../../../lib/helpers';
import { insertImageFromDataUrl } from './editorCommands';
import { editorHas } from './hostContext';
import { NEW_TABLE } from './EditorToolbar';
import CommandList from './CommandList';
import { suggestionPopup } from './suggestionPopup';

/** One entry of the `/` menu. */
export interface SlashCommand {
  id: string;
  /** i18n key of the label. */
  labelKey: string;
  icon: LucideIcon;
  /** Further words it is found by, in English, besides its label. */
  keywords: string[];
  /** Whether the editor has what the command needs. */
  available: (editor: Editor) => boolean;
  run: (editor: Editor, range: Range) => void;
}

/** Choose image files and insert them one after another at the cursor. */
function pickImages(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_IMAGE_MIME;
  input.multiple = true;
  input.onchange = async () => {
    for (const file of Array.from(input.files ?? []).filter(isAcceptedImageFile)) {
      if (editor.isDestroyed) return;
      await insertImageFromDataUrl(editor, await readFileAsDataUrl(file));
    }
  };
  input.click();
}

/** The commands in menu order; each removes the typed `/…` first. */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'paragraph', labelKey: 'editor.menu.paragraph', icon: Pilcrow, keywords: ['text', 'paragraph'],
    available: () => true,
    run: (ed, range) => ed.chain().focus().deleteRange(range).setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level): SlashCommand => ({
    id: `heading${level}`, labelKey: `editor.toolbar.heading${level}`, icon: [Heading1, Heading2, Heading3][level - 1],
    keywords: ['heading', 'title', `h${level}`],
    available: (ed) => editorHas(ed, 'heading'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).setHeading({ level }).run(),
  })),
  {
    id: 'bulletList', labelKey: 'editor.toolbar.bulletList', icon: List, keywords: ['list', 'bullet', 'ul'],
    available: (ed) => editorHas(ed, 'bulletList'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'orderedList', labelKey: 'editor.toolbar.numberedList', icon: ListOrdered, keywords: ['list', 'numbered', 'ol'],
    available: (ed) => editorHas(ed, 'orderedList'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'taskList', labelKey: 'editor.toolbar.taskList', icon: CheckSquare, keywords: ['todo', 'task', 'check'],
    available: (ed) => editorHas(ed, 'taskList'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'blockquote', labelKey: 'editor.toolbar.blockquote', icon: Quote, keywords: ['quote'],
    available: (ed) => editorHas(ed, 'blockquote'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'horizontalRule', labelKey: 'editor.toolbar.horizontalRule', icon: Minus, keywords: ['divider', 'line', 'hr'],
    available: (ed) => editorHas(ed, 'horizontalRule'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'image', labelKey: 'editor.toolbar.insertImage', icon: ImagePlus, keywords: ['image', 'picture', 'photo'],
    available: (ed) => editorHas(ed, 'image'),
    run: (ed, range) => {
      ed.chain().focus().deleteRange(range).run();
      pickImages(ed);
    },
  },
  {
    id: 'table', labelKey: 'editor.toolbar.insertTable', icon: Table, keywords: ['table', 'grid'],
    available: (ed) => editorHas(ed, 'table'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).insertTable(NEW_TABLE).run(),
  },
  {
    // Typing `[[` opens the link suggestion in place.
    id: 'entryLink', labelKey: 'editor.toolbar.insertLink', icon: Link, keywords: ['link', 'entry'],
    available: (ed) => editorHas(ed, 'internalLink'),
    run: (ed, range) => ed.chain().focus().deleteRange(range).insertContent('[[').run(),
  },
];

/** The commands for a query, matched against the translated label and the keywords. */
export function matchCommands(editor: Editor, query: string, translate: (key: string) => string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.available(editor)).filter((cmd) =>
    !q || translate(cmd.labelKey).toLowerCase().includes(q) || cmd.keywords.some((k) => k.startsWith(q)));
}

/**
 * `/` at the start of a line or after a space opens the command menu; the
 * typed text after it filters. Items are built with the label translated, so
 * the extension takes the translate function.
 */
export function createSlashCommands(translate: (key: string) => string) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommands'),
          char: '/',
          items: ({ editor, query }) => matchCommands(editor, query, translate),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionPopup(CommandList),
        }),
      ];
    },
  });
}
