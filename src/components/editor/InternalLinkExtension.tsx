import Mention from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/core';
import { ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewRendererProps } from '@tiptap/react';
import tippy, { type Instance } from 'tippy.js';
import SuggestionList, {
  type SuggestionItem,
  type SuggestionListRef,
} from './SuggestionList';

function getDefaultIcon(entryType: string): string {
  if (entryType === 'journal') return '📓';
  if (entryType === 'wiki') return '📚';
  return '⚡';
}

interface InternalLinkOptions {
  getIcon?: (id: string, entryType: string) => string | null;
  getLabel?: (id: string, entryType: string) => string | null;
}

function InternalLinkNodeView({ node, editor, extension }: NodeViewRendererProps) {
  const { id, entryType, label } = node.attrs;

  // Look up icon and label live from the store via extension callbacks,
  // so both always reflect the latest state without re-parsing stored HTML.
  const { getIcon, getLabel } = (extension as unknown as { options: InternalLinkOptions }).options;
  const icon = getIcon?.(id, entryType) ?? getDefaultIcon(entryType);
  const displayLabel = getLabel?.(id, entryType) ?? label;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Use editor.isEditable directly (live value) rather than the isEditable React state,
    // which may lag behind if the transaction event hasn't fired yet.
    if (!editor.isEditable) {
      // Navigation via CustomEvent — kein direkter Store-Zugriff aus NodeView möglich
      document.dispatchEvent(new CustomEvent('internal-link-navigate', {
        detail: { id, entryType },
        bubbles: true,
      }));
    }
  };

  return (
    <NodeViewWrapper as="span" className="internal-link-chip" onClick={handleClick} data-drag-handle>
      <span className="internal-link-icon">
        {icon?.startsWith('data:') ? <img src={icon} alt="" /> : icon}
      </span>
      <span className="internal-link-label">{displayLabel}</span>
    </NodeViewWrapper>
  );
}

export function createInternalLinkExtension(
  getItems: (query: string) => SuggestionItem[],
  getIcon: (id: string, entryType: string) => string | null,
  getLabel: (id: string, entryType: string) => string | null
) {
  return Mention.extend({
    name: 'internalLink',

    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-id'),
          renderHTML: (attrs) => ({ 'data-id': attrs.id }),
        },
        entryType: {
          default: 'wiki',
          parseHTML: (el) => el.getAttribute('data-entry-type'),
          renderHTML: (attrs) => ({ 'data-entry-type': attrs.entryType }),
        },
        label: {
          default: '',
          parseHTML: (el) => el.getAttribute('data-label'),
          renderHTML: (attrs) => ({ 'data-label': attrs.label }),
        },
        icon: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-icon'),
          renderHTML: (attrs) => ({ 'data-icon': attrs.icon }),
        },
        entry_number: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-entry-number'),
          renderHTML: (attrs) => ({ 'data-entry-number': attrs.entry_number }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="internalLink"]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        'span',
        mergeAttributes(
          { 'data-type': 'internalLink' },
          this.options.HTMLAttributes,
          HTMLAttributes
        ),
        node.attrs.label || node.attrs.id,
      ];
    },

    renderText({ node }) {
      return `[[${node.attrs.label || node.attrs.id}]]`;
    },

    addNodeView() {
      return ReactNodeViewRenderer(InternalLinkNodeView);
    },

    addKeyboardShortcuts() {
      return {
        // TipTap treats internalLink as an atom node — Backspace would normally
        // select it rather than delete it. This override deletes it in one keystroke.
        Backspace: () =>
          this.editor.commands.command(({ tr, state }) => {
            let isLink = false;
            const { selection } = state;
            const { empty, anchor } = selection;
            if (!empty) return false;
            state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
              if (node.type.name === this.name) {
                isLink = true;
                tr.insertText('', pos, pos + node.nodeSize);
                return false;
              }
            });
            return isLink;
          }),
      };
    },
  }).configure({
    HTMLAttributes: { class: 'internal-link' },
    // @ts-expect-error: custom extension options not in MentionOptions type
    getIcon,
    getLabel,

    suggestion: {
      char: '[[',
      allowSpaces: true,
      allowedPrefixes: null,

      items: ({ query }) => getItems(query).slice(0, 8),

      command: ({ editor, range, props }) => {
        const item = props as SuggestionItem;
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'internalLink',
            attrs: {
              id: item.id,
              entryType: item.entryType,
              label: item.label,
              icon: item.icon ?? null,
              entry_number: item.entry_number ?? null,
            },
          })
          .insertContent(' ')
          .run();
      },

      render: () => {
        let component: ReactRenderer<SuggestionListRef>;
        let popup: Instance[];

        return {
          onStart: (props) => {
            component = new ReactRenderer(SuggestionList, {
              props,
              editor: props.editor,
            });

            if (!props.clientRect) return;

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            });
          },

          onUpdate: (props) => {
            component.updateProps(props);
            if (!props.clientRect) return;
            popup[0]?.setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          },

          onKeyDown: (props) => {
            if (props.event.key === 'Escape') {
              popup[0]?.hide();
              return true;
            }
            return component.ref?.onKeyDown(props.event) ?? false;
          },

          onExit: () => {
            popup[0]?.destroy();
            component.destroy();
          },
        };
      },
    },
  });
}
