import type { Editor } from '@tiptap/react';
import { createDragChannel } from '../../../lib/dragChannel';

/**
 * An image being moved by dragging: from which editor, and where it stands
 * now (`getPos` of its node view, read at the drop, since the document may
 * have changed in between). Pointer based like every drag in the app, see
 * `useEditorPointerDrops`; the host's listener clears it on `pointerup`.
 */
export interface ImageDrag {
  editor: Editor;
  getPos: () => number | undefined;
}

const channel = createDragChannel<ImageDrag>();

export const setImageDrag = channel.set;
export const getImageDrag = channel.get;
export const subscribeImageDrag = channel.subscribe;
