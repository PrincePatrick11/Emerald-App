import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, CornerDownRight, Replace, Search, X } from 'lucide-react';
import { scrollIntoViewCentered } from '../../../lib/reveal';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from './toolbarParts';
import { editorHas } from './hostContext';
import { findMatches, setSearch, type SearchMatch } from './SearchExtension';
import { revealPosition } from './editorCommands';
import { useEditorsUpdate } from './useEditorsUpdate';

interface Hit {
  editor: Editor;
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
  useEditorsUpdate(editors, bump);
  const editorKey = editors.map((ed) => ed.instanceId).join(',');

  const hits = useMemo<Hit[]>(() => editors.flatMap((editor) =>
    findMatches(editor.state.doc, query).map((match) => ({ editor, match }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `editorKey` and `version` stand for editors and documents
  [editorKey, query, version]);

  // After a replace, the next hit is the first behind the replaced text — not
  // the same spot again when the replacement still matches ("cat" → "cats").
  const [after, setAfter] = useState<{ editor: Editor; pos: number } | null>(null);
  useEffect(() => {
    if (!after) return;
    setAfter(null);
    const order = editors.indexOf(after.editor);
    const next = hits.findIndex((h) => {
      const e = editors.indexOf(h.editor);
      return e > order || (e === order && h.match.from >= after.pos);
    });
    setIndex(next >= 0 ? next : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per replace, on the hits after it
  }, [hits]);

  const current = hits.length === 0 ? null : Math.min(index, hits.length - 1);

  // Mark the hits in every editor, the current one in its own.
  useEffect(() => {
    const hit = current === null ? null : hits[current];
    // A hit in a folded or closed section opens it, or there would be nothing
    // to see; opening a section moves the focus, which goes back to the field.
    if (hit) {
      const focused = document.activeElement;
      revealPosition(hit.editor, hit.match.from);
      if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus();
    }
    for (const editor of editors) setSearch(editor, query, hit?.editor === editor ? hit.match.from : null);
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
    setAfter({ editor: hit.editor, pos: from + replacement.length });
    hit.editor.view.dispatch(hit.editor.state.tr.insertText(replacement, from, to));
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

  const countText = query
    ? (hits.length ? t('editor.find.count', { current: (current ?? 0) + 1, total: hits.length }) : t('editor.find.none'))
    : '';

  // One surface like the toolbar under it: the field with its count inside,
  // the arrows, the switch for replacing and the close; replacing adds a
  // second row of the same shape.
  return (
    <div className="editor-find-bar">
      <div className="editor-find-row">
        <label className="editor-find-field">
          <Search size={13} className="text-subtle flex-shrink-0" />
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
          />
          <span className={`editor-find-count${query && hits.length === 0 ? ' editor-find-count--none' : ''}`}>{countText}</span>
        </label>
        <ToolbarGroup>
          <ToolbarBtn onClick={() => step(-1)} active={false} disabled={hits.length === 0} title={t('editor.find.previous')}>
            <ChevronUp size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => step(1)} active={false} disabled={hits.length === 0} title={t('editor.find.next')}>
            <ChevronDown size={14} />
          </ToolbarBtn>
        </ToolbarGroup>
        <ToolbarDivider />
        <ToolbarGroup>
          {isEditing && (
            <ToolbarBtn onClick={() => setShowReplace((v) => !v)} active={showReplace} title={t('editor.find.toggleReplace')}>
              <Replace size={14} />
            </ToolbarBtn>
          )}
          <ToolbarBtn onClick={onClose} active={false} title={t('editor.find.close')}>
            <X size={14} />
          </ToolbarBtn>
        </ToolbarGroup>
      </div>
      {canReplace && (
        <div className="editor-find-row">
          <label className="editor-find-field">
            <CornerDownRight size={13} className="text-subtle flex-shrink-0" />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
                if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              }}
              placeholder={t('editor.find.replacePlaceholder')}
            />
          </label>
          <ToolbarGroup>
            <ToolbarBtn onClick={replaceCurrent} active={false} disabled={current === null} title={t('editor.find.replace')}>
              <span className="editor-toolbar-btn-label">{t('editor.find.replaceShort')}</span>
            </ToolbarBtn>
            <ToolbarBtn onClick={replaceAll} active={false} disabled={hits.length === 0} title={t('editor.find.replaceAll')}>
              <span className="editor-toolbar-btn-label">{t('editor.find.replaceAll')}</span>
            </ToolbarBtn>
          </ToolbarGroup>
        </div>
      )}
    </div>
  );
}
