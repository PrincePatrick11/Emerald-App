import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import type { ComponentType } from 'react';

/** What a suggestion list exposes to the popup: keys while it is open. */
export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
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
