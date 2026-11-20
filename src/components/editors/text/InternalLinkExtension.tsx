import Mention from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewRendererProps } from '@tiptap/react';
import SuggestionList, { type SuggestionItem } from './SuggestionList';
import { defaultLinkIcon } from '../../../lib/entryIcon';
import { suggestionPopup } from './suggestionPopup';
import { linkTargetKindOf } from '../../../lib/internalLinkHtml';
import { isImageIcon } from '../../../lib/helpers';
import { iconSrc } from '../../../lib/icons';

interface InternalLinkOptions {
  getIcon?: (id: string, targetKind: string) => string | null;
  getLabel?: (id: string, targetKind: string) => string | null;
}

function InternalLinkNodeView({ node, editor, extension }: NodeViewRendererProps) {
  const { id, targetKind, label } = node.attrs;

  // Look up icon and label live from the store via extension callbacks,
  // so both always reflect the latest state without re-parsing stored HTML.
  const { getIcon, getLabel } = (extension as unknown as { options: InternalLinkOptions }).options;
  const icon = getIcon?.(id, targetKind) ?? defaultLinkIcon(targetKind);
  const displayLabel = getLabel?.(id, targetKind) ?? label;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Use editor.isEditable directly (live value) rather than the isEditable React state,
    // which may lag behind if the transaction event hasn't fired yet.
    if (!editor.isEditable) {
      // Navigation via CustomEvent; no direct store access possible from a NodeView
      document.dispatchEvent(new CustomEvent('internal-link-navigate', {
        detail: { id, targetKind },
        bubbles: true,
      }));
    }
  };

  // Middle click opens the target in a new tab, in read and edit mode alike
  // (the current entry stays). preventDefault on mousedown suppresses Chromium's autoscroll.
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('internal-link-navigate', {
      detail: { id, targetKind, newTab: true },
      bubbles: true,
    }));
  };

  return (
    <NodeViewWrapper
      as="span"
      className="internal-link-chip"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      data-drag-handle
    >
      <span className="internal-link-icon">
        {isImageIcon(icon) ? <img src={iconSrc(icon)} alt="" /> : icon}
      </span>
      <span className="internal-link-label">{displayLabel}</span>
    </NodeViewWrapper>
  );
}

export function createInternalLinkExtension(
  getItems: (query: string) => SuggestionItem[],
  getIcon: (id: string, targetKind: string) => string | null,
  getLabel: (id: string, targetKind: string) => string | null
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
        targetKind: {
          default: 'entry',
          parseHTML: (el) => linkTargetKindOf(el.getAttribute('data-target-kind')),
          renderHTML: (attrs) => ({ 'data-target-kind': attrs.targetKind }),
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
              targetKind: item.targetKind,
              label: item.label,
              icon: item.icon ?? null,
              entry_number: item.entry_number ?? null,
            },
          })
          .insertContent(' ')
          .run();
      },

      render: suggestionPopup<SuggestionItem>(SuggestionList as never),
    },
  });
}
