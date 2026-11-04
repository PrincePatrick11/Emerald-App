import type { Editor } from '@tiptap/react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code, Highlighter, Italic, Strikethrough, type LucideIcon,
} from 'lucide-react';
import { editorHas } from './hostContext';
import type { Alignment } from './ResizableImageExtension';

/** A button that toggles a mark, shared by the toolbar and the selection menu. */
export interface MarkAction {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  /** The mark it needs in the schema; without it the button is left out. */
  mark: string;
  toggle: (editor: Editor) => void;
}

export const MARK_ACTIONS: MarkAction[] = [
  { key: 'bold', labelKey: 'editor.toolbar.bold', icon: Bold, mark: 'bold', toggle: (ed) => ed.chain().focus().toggleBold().run() },
  { key: 'italic', labelKey: 'editor.toolbar.italic', icon: Italic, mark: 'italic', toggle: (ed) => ed.chain().focus().toggleItalic().run() },
  { key: 'strike', labelKey: 'editor.toolbar.strikethrough', icon: Strikethrough, mark: 'strike', toggle: (ed) => ed.chain().focus().toggleStrike().run() },
  { key: 'highlight', labelKey: 'editor.toolbar.highlight', icon: Highlighter, mark: 'highlight', toggle: (ed) => ed.chain().focus().toggleHighlight().run() },
  { key: 'code', labelKey: 'editor.toolbar.inlineCode', icon: Code, mark: 'code', toggle: (ed) => ed.chain().focus().toggleCode().run() },
];

/** The mark actions this editor has. */
export function markActionsOf(editor: Editor): MarkAction[] {
  return MARK_ACTIONS.filter((action) => editorHas(editor, action.mark));
}

/**
 * The node types for which `TextAlign` is configured in `TextEditor`. Listed
 * here so that the alignment buttons can be disabled where alignment
 * would have no effect, in a code block for instance.
 */
export const TEXT_ALIGN_TYPES = ['heading', 'paragraph'] as const;

/** Everything except left: only these values appear as an attribute in the document. */
const EXPLICIT_ALIGNMENTS = ['center', 'right', 'justify'] as const;

export const ALIGN_ACTIONS: { align: Alignment; labelKey: string; icon: LucideIcon }[] = [
  { align: 'left', labelKey: 'editor.toolbar.alignLeft', icon: AlignLeft },
  { align: 'center', labelKey: 'editor.toolbar.alignCenter', icon: AlignCenter },
  { align: 'right', labelKey: 'editor.toolbar.alignRight', icon: AlignRight },
];

/**
 * The same three buttons serve two targets: a selected image is a block node
 * of its own with its own width, which the paragraph's `text-align` does not
 * reach. How the two sides store left alignment is described at `alignMargins`.
 */
export function canAlign(editor: Editor): boolean {
  return editor.isActive('image') || TEXT_ALIGN_TYPES.some((type) => editor.isActive(type));
}

export function applyAlign(editor: Editor, align: Alignment): void {
  if (editor.isActive('image')) editor.chain().focus().setImageAlign(align).run();
  else if (align === 'left') editor.chain().focus().unsetTextAlign().run();
  else editor.chain().focus().setTextAlign(align).run();
}

export function isAlignActive(editor: Editor, align: Alignment): boolean {
  if (editor.isActive('image')) return editor.getAttributes('image').align === align;
  if (!canAlign(editor)) return false;
  // A paragraph without the attribute is left-aligned, and older content may
  // carry an explicit `left`. Both must light up the button.
  if (align === 'left') return !EXPLICIT_ALIGNMENTS.some((a) => editor.isActive({ textAlign: a }));
  return editor.isActive({ textAlign: align });
}
