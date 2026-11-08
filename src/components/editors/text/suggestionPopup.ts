import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import type { ComponentType } from 'react';

/** What a suggestion list exposes to the popup: keys while it is open. */
export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * The keys of a suggestion list: arrows move the current row (round the ends),
 * Enter and Tab choose it. Starts at the top whenever the items change; an
 * empty list leaves the keys to the editor.
 */
export function useListKeys<I>(ref: Ref<SuggestionListHandle>, items: I[], choose: (item: I) => void) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selectedIndex];
        if (item) choose(item);
        return true;
      }
      return false;
    },
  }));
  return { selectedIndex, setSelectedIndex };
}

/**
 * The `render` of a suggestion (`[[` for links, `/` for commands): the list
 * component in a popup at the caret. The suggestion plugin mounts and places
 * it (`props.mount`, Floating UI underneath), keeps it at the caret while
 * scrolling, and closes it on Escape and on a click outside.
 */
export function suggestionPopup<I>(
  List: ComponentType<SuggestionProps<I>>,
): NonNullable<SuggestionOptions<I>['render']> {
  return () => {
    let component: ReactRenderer<SuggestionListHandle, SuggestionProps<I>> | null = null;
    let unmount: (() => void) | undefined;
    return {
      onStart: (props) => {
        component = new ReactRenderer(List as never, { props, editor: props.editor });
        const element = component.element as HTMLElement;
        element.classList.add('editor-suggestion-popup');
        unmount = props.mount(element);
      },
      onUpdate: (props) => component?.updateProps(props),
      onKeyDown: ({ event }) => component?.ref?.onKeyDown(event) ?? false,
      onExit: () => {
        unmount?.();
        component?.destroy();
        component = null;
      },
    };
  };
}
