import { createContext } from 'react';
import type { Editor } from '@tiptap/react';

/** What a `TextEditor` with a `hostKey` finds around it: where it reports its instance. */
export interface TextEditorHostContextValue {
  register: (key: string, editor: Editor | null) => void;
}

export const TextEditorHostContext = createContext<TextEditorHostContextValue | null>(null);

/**
 * Does the editor have this node, mark or extension (`textAlign` is only an
 * extension)? Features switched off are missing from it.
 */
export function editorHas(editor: Editor, name: string): boolean {
  return !!editor.schema.nodes[name] || !!editor.schema.marks[name]
    || editor.extensionManager.extensions.some((ext) => ext.name === name);
}
