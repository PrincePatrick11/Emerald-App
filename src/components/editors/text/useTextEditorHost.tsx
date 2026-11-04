import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import EditorToolbar from './EditorToolbar';
import LinkPickerModal from './LinkPickerModal';
import DragGhost from './DragGhost';
import { useEditorFileDrop } from './useEditorFileDrop';
import { useEditorPointerDrops } from './useEditorPointerDrops';
import { useInternalLinkNavigation } from './useInternalLinkNavigation';
import { useTextEditorRegistry } from './useTextEditorRegistry';
import { insertImageFromDataUrl, insertInternalLinkChip } from './editorCommands';
import { type TextEditorHostContextValue } from './hostContext';
import DropIndicator from './DropIndicator';
import type { DropSpot } from './dropSpot';
import { createDragChannel } from '../../../lib/dragChannel';

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
 * by dragging, with the indicator of where they land; the drag tag.
 *
 * The host provides `context` through `TextEditorHostContext`; each
 * `TextEditor` inside with a `hostKey` then reports itself. `toolbar` and
 * `overlays` are rendered wherever the host wants them, `dropActive` says
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

  const context = useMemo<TextEditorHostContextValue>(() => ({ register: registerTextEditor }), [registerTextEditor]);

  const toolbar: ReactNode = isEditing && toolbarEditor
    ? <HostToolbar editor={toolbarEditor} onOpenLinkPicker={() => setLinkPickerOpen(true)} />
    : null;

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

  return {
    context,
    toolbar,
    overlays,
    dropActive: fileDrop.fileDragOver || pointerDropActive,
    orderedEditors,
    targetEditor,
    focusOnMount,
  };
}

/** The host's one toolbar, bound to the focused editor. It
 *  sits outside the editor component and therefore does not re-render by itself
 *  with every transaction; the listener here makes up for that. */
function HostToolbar({ editor, onOpenLinkPicker }: { editor: Editor; onOpenLinkPicker: () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', rerender);
    return () => { editor.off('transaction', rerender); };
  }, [editor]);
  if (editor.isDestroyed) return null;
  return (
    <div className="block-stack-toolbar">
      <EditorToolbar
        editor={editor}
        onInsertImage={(dataUrl) => insertImageFromDataUrl(editor, dataUrl)}
        onOpenLinkPicker={onOpenLinkPicker}
      />
    </div>
  );
}
