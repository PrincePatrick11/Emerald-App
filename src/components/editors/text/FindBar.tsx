import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Replace, ReplaceAll, X } from 'lucide-react';
import { scrollIntoViewCentered } from '../../../lib/reveal';
import { ToolbarBtn } from './EditorToolbar';
import { editorHas } from './hostContext';
import { findMatches, setSearch, type SearchMatch } from './SearchExtension';

interface Hit {
  editor: Editor;
  /** Index among the hits of its editor. */
  local: number;
  match: SearchMatch;
}

/**
 * Find (and, while editing, replace) across all editors of a host, in their
 * order: the hits light up in every editor, the current one stronger, and it
 * is scrolled to. Enter goes to the next hit, Shift+Enter to the previous,
 * Escape closes. Opened with ⌘F / Ctrl+F (`useTextEditorHost`).
 */
export default function FindBar({ getEditors, isEditing, initialQuery, onClose }: {
  getEditors: () => Editor[];
  isEditing: boolean;
  initialQuery: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // A change in any editor finds the hits anew.
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const editors = getEditors().filter((ed) => editorHas(ed, 'textSearch'));
  const editorKey = editors.map((ed) => ed.instanceId).join(',');
  useEffect(() => {
    editors.forEach((ed) => ed.on('update', bump));
    return () => editors.forEach((ed) => ed.off('update', bump));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `editorKey` stands for the list of editors
  }, [editorKey]);

  const hits = useMemo<Hit[]>(() => editors.flatMap((editor) =>
    findMatches(editor.state.doc, query).map((match, local) => ({ editor, local, match }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the documents
  [editorKey, query, version]);

  const current = hits.length === 0 ? null : Math.min(index, hits.length - 1);

  // Mark the hits in every editor, the current one in its own.
  useEffect(() => {
    const hit = current === null ? null : hits[current];
    for (const editor of editors) setSearch(editor, query, hit?.editor === editor ? hit.local : null);
    const el = hit?.editor.view.dom.querySelector<HTMLElement>('.editor-search-match--current');
    if (el) scrollIntoViewCentered(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hits` already follows editors and query
  }, [hits, current]);

  // Closing takes the marks away again.
  useEffect(() => () => { for (const editor of getEditors()) setSearch(editor, '', null); }, [getEditors]);

  useEffect(() => { inputRef.current?.select(); }, []);

  const step = (by: number) => {
    if (hits.length === 0) return;
    setIndex(((current ?? 0) + by + hits.length) % hits.length);
  };

  const replaceCurrent = () => {
    const hit = current === null ? null : hits[current];
    if (!hit) return;
    const { from, to } = hit.match;
    hit.editor.view.dispatch(hit.editor.state.tr.insertText(replacement, from, to));
    // The next hit moves up into this index.
  };

  const replaceAll = () => {
    for (const editor of editors) {
      const matches = findMatches(editor.state.doc, query);
      if (matches.length === 0) continue;
      // From the back, so the positions in front stay valid; one undo step per editor.
      const tr = editor.state.tr;
      for (const { from, to } of [...matches].reverse()) tr.insertText(replacement, from, to);
      editor.view.dispatch(tr);
    }
  };

  const canReplace = isEditing && showReplace;

  return (
    <div className="editor-find-bar">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          placeholder={t('editor.find.placeholder')}
          className="editor-find-input"
        />
        <span className="text-[11px] text-subtle tabular-nums min-w-[64px] text-center">
          {query ? (hits.length ? t('editor.find.count', { current: (current ?? 0) + 1, total: hits.length }) : t('editor.find.none')) : ''}
        </span>
        <ToolbarBtn onClick={() => step(-1)} active={false} disabled={hits.length === 0} title={t('editor.find.previous')}>
          <ChevronUp size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => step(1)} active={false} disabled={hits.length === 0} title={t('editor.find.next')}>
          <ChevronDown size={14} />
        </ToolbarBtn>
        {isEditing && (
          <ToolbarBtn onClick={() => setShowReplace((v) => !v)} active={showReplace} title={t('editor.find.toggleReplace')}>
            <Replace size={14} />
          </ToolbarBtn>
        )}
        <ToolbarBtn onClick={onClose} active={false} title={t('editor.find.close')}>
          <X size={14} />
        </ToolbarBtn>
      </div>
      {canReplace && (
        <div className="flex items-center gap-1">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder={t('editor.find.replacePlaceholder')}
            className="editor-find-input"
          />
          <ToolbarBtn onClick={replaceCurrent} active={false} disabled={current === null} title={t('editor.find.replace')}>
            <Replace size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={replaceAll} active={false} disabled={hits.length === 0} title={t('editor.find.replaceAll')}>
            <ReplaceAll size={14} />
          </ToolbarBtn>
        </div>
      )}
    </div>
  );
}
