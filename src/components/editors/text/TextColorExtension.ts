import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * The colours text can take. Stored by name only (`data-color`), never as a
 * value: each theme sets the shade (`--editor-color-<name>`), so coloured text
 * stays readable on a dark and on a light sheet alike.
 */
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

function isTextColor(value: unknown): value is TextColor {
  return (TEXT_COLORS as readonly unknown[]).includes(value);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      /** Colours the selection; `null` takes the colour away. */
      setTextColor: (color: TextColor | null) => ReturnType;
    };
  }
}

export const TextColorMark = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => {
          const value = el.getAttribute('data-color');
          return isTextColor(value) ? value : null;
        },
        renderHTML: (attrs) => (attrs.color ? { 'data-color': attrs.color } : {}),
      },
    };
  },

  parseHTML() {
    // Only a name it knows: anything else is not a colour of this editor.
    return [{ tag: 'span[data-color]', getAttrs: (el) => (isTextColor(el.getAttribute('data-color')) ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          color ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name),
    };
  },
});
