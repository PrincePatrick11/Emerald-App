import { useReducer } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useTranslation } from 'react-i18next';
import { useEditorsUpdate } from './useEditorsUpdate';

/** Words and characters of a document; a link chip counts with its label, a line break separates words. */
export function countText(doc: ProseMirrorNode): { words: number; characters: number } {
  const text = doc.textBetween(0, doc.content.size, '\n', (node) =>
    node.type.name === 'hardBreak' ? '\n' : (node.attrs.label as string | undefined) ?? '');
  return {
    words: text.match(/\S+/g)?.length ?? 0,
    characters: text.replace(/\n/g, '').length,
  };
}

/**
 * Words and characters across all editors of a host, as a quiet line under
 * them. It follows every change itself, so typing re-renders only this, and
 * counts at most once per frame however fast the keystrokes come.
 */
export default function WordCount({ getEditors }: { getEditors: () => Editor[] }) {
  const { t } = useTranslation();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const editors = getEditors();
  useEditorsUpdate(editors, rerender, { perFrame: true });

  const total = editors.reduce((sum, ed) => {
    const { words, characters } = countText(ed.state.doc);
    return { words: sum.words + words, characters: sum.characters + characters };
  }, { words: 0, characters: 0 });

  return (
    <div className="editor-word-count">
      {t('editor.count.words', { count: total.words })} · {t('editor.count.characters', { count: total.characters })}
    </div>
  );
}
