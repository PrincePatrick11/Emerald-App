import { Mark, mergeAttributes } from '@tiptap/core';
import { isTextColor, type TextColor } from '../../../lib/textColors';

/* The names and their shades: `lib/textColors.ts`. */

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
