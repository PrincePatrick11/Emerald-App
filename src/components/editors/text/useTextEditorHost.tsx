import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import EditorToolbar from './EditorToolbar';
import LinkPickerModal from './LinkPickerModal';
import DragGhost from './DragGhost';
import FindBar from './FindBar';
import WordCount from './WordCount';
import { useEditorFileDrop } from './useEditorFileDrop';
import { useEditorPointerDrops } from './useEditorPointerDrops';
import { useInternalLinkNavigation } from './useInternalLinkNavigation';
import { useTextEditorRegistry } from './useTextEditorRegistry';
import { insertInternalLinkChip } from './editorCommands';
import { type TextEditorHostContextValue } from './hostContext';
import DropIndicator from './DropIndicator';
import type { DropSpot } from './dropSpot';
import { createDragChannel } from '../../../lib/dragChannel';
import { isMacOS } from '../../../lib/platform';

interface TextEditorHostOptions {
  isEditing: boolean;
  /** The keys of the host's editors in document order (see `useTextEditorRegistry`). */
  getOrder: () => string[];
  /** The area in which a pointer drop counts, also between the editors. */
  getContainer: () => HTMLElement | null;
}

/**
 * Everything that may exist only ONCE for a set of text editors shown
 * together, such as the text blocks of an entry: the one toolbar, bound to the
 * focused editor; the link picker; chip-click navigation in read mode; file
 * drops from the explorer, pointer drops from the entry list and images moved
 * by dragging, with the indicator of where they land; the drag tag; the find
 * bar (⌘F / Ctrl+F) across all its editors.
 *
 * The host provides `context` through `TextEditorHostContext`; each
 * `TextEditor` inside with a `hostKey` then reports itself. `toolbar`,
 * `wordCount` and `overlays` are rendered wherever the host wants them, `dropActive` says
 * whether a drop could land right now (for highlighting).
 *
 * Requests that depend on the host's content, such as the sidebar's link
 * requests in an entry, stay with the host; `orderedEditors` and
 * `targetEditor` tell it where they go.
 */
export function useTextEditorHost({ isEditing, getOrder, getContainer }: TextEditorHostOptions) {
  const { registerTextEditor, orderedEditors, targetEditor, toolbarEditor, focusOnMount } =
    useTextEditorRegistry(getOrder);

  useInternalLinkNavigation(!isEditing);
  // Both drops only reach editors that have the feature (image, link chip).
  const [spots] = useState(() => createDragChannel<DropSpot>());
  const fileDrop = useEditorFileDrop({
    enabled: isEditing,
    getEditors: orderedEditors,
    getContainer,
    getFallback: targetEditor,
    onSpot: spots.set,
  });
  const pointerDropActive = useEditorPointerDrops({
    enabled: isEditing,
    getEditors: orderedEditors,
    getContainer,
    onSpot: spots.set,
  });

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  // ⌘F / Ctrl+F while this host is on screen, in reading as in editing; the
  // selected text, if any, is what is searched for first.
  const [find, setFind] = useState<{ query: string; key: number } | null>(null);
  const openFind = useCallback(() => {
    const focused = toolbarEditor ?? targetEditor();
    const selected = focused && !focused.state.selection.empty
      ? focused.state.doc.textBetween(focused.state.selection.from, focused.state.selection.to, ' ')
      : '';
    setFind((prev) => ({ query: selected || prev?.query || '', key: (prev?.key ?? 0) + 1 }));
  }, [toolbarEditor, targetEditor]);
  const closeFind = () => { setFind(null); toolbarEditor?.commands.focus(); };
  const getContainerRef = useRef(getContainer);
  getContainerRef.current = getContainer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘ on the Mac: there Ctrl+F is the system's "one character forward".
      const modifier = isMacOS ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (e.key.toLowerCase() !== 'f' || !modifier || e.shiftKey || e.altKey) return;
      const container = getContainerRef.current();
      if (!container || container.getClientRects().length === 0) return;
      e.preventDefault();
      openFind();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFind]);

  const context = useMemo<TextEditorHostContextValue>(() => ({ register: registerTextEditor }), [registerTextEditor]);

  // Find bar and toolbar share the one sticky strip at the top of the host.
  const showToolbar = isEditing && !!toolbarEditor;
  const toolbar: ReactNode = find || showToolbar ? (
    <div className="block-stack-toolbar">
      {find && (
        <FindBar
          key={find.key}
          getEditors={orderedEditors}
          isEditing={isEditing}
          initialQuery={find.query}
          onClose={closeFind}
        />
      )}
      {showToolbar && (
        <HostToolbar
          editor={toolbarEditor}
          onOpenLinkPicker={() => setLinkPickerOpen(true)}
          findOpen={!!find}
          onToggleFind={() => (find ? closeFind() : openFind())}
        />
      )}
    </div>
  ) : null;

  const overlays: ReactNode = (
    <>
      {isEditing && linkPickerOpen && toolbarEditor && (
        <LinkPickerModal
          onSelect={(item) => insertInternalLinkChip(toolbarEditor, item)}
          onClose={() => setLinkPickerOpen(false)}
        />
      )}
      <DragGhost />
      <DropIndicator spots={spots} />
    </>
  );

  /** Words and characters of all editors, while editing. */
  const wordCount: ReactNode = isEditing ? <WordCount getEditors={orderedEditors} /> : null;

  return {
    context,
    toolbar,
    overlays,
    wordCount,
    dropActive: fileDrop.fileDragOver || pointerDropActive,
    orderedEditors,
    targetEditor,
    focusOnMount,
  };
}

/** The host's one toolbar, bound to the focused editor. It
 *  sits outside the editor component and therefore does not re-render by itself
 *  with every transaction; the listener here makes up for that. */
function HostToolbar(props: ComponentProps<typeof EditorToolbar>) {
  const { editor } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', rerender);
    return () => { editor.off('transaction', rerender); };
  }, [editor]);
  if (editor.isDestroyed) return null;
  return (
    <EditorToolbar {...props} />
  );
}
