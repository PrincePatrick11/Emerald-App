import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** A hit in the document, as ProseMirror positions. */
export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchState {
  query: string;
  /** Index into the matches of this editor, or `null` when the current hit is elsewhere. */
  current: number | null;
  decorations: DecorationSet;
}

const searchKey = new PluginKey<SearchState>('textSearch');

/**
 * Every place `query` occurs, case-insensitively, per textblock: a hit may
 * run across marks (bold in the middle of a word), not across paragraphs.
 * A link chip or another inline node counts as one character that matches nothing.
 */
export function findMatches(doc: ProseMirrorNode, query: string): SearchMatch[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const starts: number[] = [];
    node.forEach((child, offset) => {
      const piece = child.isText ? child.text ?? '' : '￼';
      for (let i = 0; i < piece.length; i++) starts.push(pos + 1 + offset + i);
      text += piece;
    });
    const haystack = text.toLocaleLowerCase();
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ from: starts[at], to: starts[at + needle.length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

function decorate(doc: ProseMirrorNode, query: string, current: number | null): DecorationSet {
  const matches = findMatches(doc, query);
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'editor-search-match editor-search-match--current' : 'editor-search-match' })));
}

/** Show the hits of `query` in this editor, `current` of them as the current one. */
export function setSearch(editor: Editor, query: string, current: number | null): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, current }).setMeta('addToHistory', false));
}

/**
 * The hits of the find bar (`FindBar`) as decorations. The query and the
 * current hit come from outside through `setSearch`; on every change of the
 * document the hits are found again.
 */
export const SearchExtension = Extension.create({
  name: 'textSearch',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', current: null, decorations: DecorationSet.empty }),
          apply(tr: Transaction, prev, _old, state) {
            const meta = tr.getMeta(searchKey) as { query: string; current: number | null } | undefined;
            if (meta) return { ...meta, decorations: decorate(state.doc, meta.query, meta.current) };
            if (!tr.docChanged || !prev.query) return prev;
            return { ...prev, decorations: decorate(state.doc, prev.query, prev.current) };
          },
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
