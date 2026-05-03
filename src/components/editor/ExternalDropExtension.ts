import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import { getDragItem, setDragItem } from '../../lib/dragState';

export const ExternalDropExtension = Extension.create({
  name: 'externalDrop',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragover(_view, event) {
              if (!getDragItem()) return false;
              event.preventDefault();
              return false;
            },

            drop(view, event) {
              const item = getDragItem();
              if (!item) return false;

              event.preventDefault();
              setDragItem(null);

              const nodeType = view.state.schema.nodes['internalLink'];
              if (!nodeType) return false;

              const coords = { left: event.clientX, top: event.clientY };
              const resolved = view.posAtCoords(coords);
              const insertAt = resolved?.pos ?? view.state.doc.content.size;

              const node = nodeType.create({
                id: item.id,
                entryType: item.entryType,
                label: item.label,
              });

              view.dispatch(view.state.tr.insert(insertAt, node));
              return true;
            },
          },
        },
      }),
    ];
  },
});
