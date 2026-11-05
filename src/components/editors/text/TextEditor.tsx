import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { ResizableImage, pinPercentImageWidths } from './ResizableImageExtension';
import { TextColorMark } from './TextColorExtension';
import { SearchExtension } from './SearchExtension';
import { createHeadingFold } from './HeadingFoldExtension';
import { useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TEXT_ALIGN_TYPES } from './formatActions';
import { applyLinkHref, insertImageFiles } from './editorCommands';
import LinkHrefForm from './LinkHrefForm';
import { ToolbarBtn } from '../shared/toolbarParts';
import { FULL_TEXT_FEATURES, type TextFeatures } from './features';
import { TextEditorHostContext, editorHas } from './hostContext';
import SelectionMenus from './SelectionMenus';
import { createSlashCommands } from './slashCommands';
import i18n from '../../../i18n';
import { createInternalLinkExtension } from './InternalLinkExtension';
import type { SuggestionItem } from './SuggestionList';
import { useLinkItems } from '../../../hooks/useLinkItems';
import { linkItemKey, linkItemsByKey } from '../../../lib/linkItems';
import { isAcceptedImageFile } from '../../../lib/helpers';
import { useSettingsStore } from '../../../store/settingsStore';
import type { EditorSettings } from '../../../lib/vaultSettings';

interface LinkPopupState {
  href: string;
  rect: DOMRect;
}

interface TextEditorProps {
  /**
   * Only the INITIAL VALUE: the editor is uncontrolled afterwards. Its owner
   * remounts it via `key` when other content is loaded (another entry,
   * Cancel). The former sync effect, which compared `getHTML()` with the prop
   * on every render, amounted together with `onUpdate` to a
   * double serialisation of the entire document per keystroke.
   */
  initialContent: string;
  placeholder?: string;
  onChange: (content: string) => void;
  editable?: boolean;
  /** What this editor offers; all of it by default. Read at creation, like the settings below. */
  features?: TextFeatures;
  /**
   * The key under which the editor reports itself to the surrounding host
   * (`useTextEditorHost`), which then binds toolbar, link picker and drops to it.
   * Without a host or key the editor stands alone.
   */
  hostKey?: string;
}

/** `Link` without linking pasted addresses, for "Automatic links" off. */
const LinkWithoutPasteRule = Link.extend({ addPasteRules: () => [] });

/**
 * What the automatic-formatting settings change in the editor:
 *
 * | Setting           | off means                                                        |
 * |-------------------|------------------------------------------------------------------|
 * | markdownShortcuts | no input and paste rules, except those of the other two          |
 * | typography        | `Typography` is missing entirely                                 |
 * | autoLinks         | `Link` without `autolink`, `linkOnPaste` and paste rule          |
 */
function formattingOptions(format: EditorSettings, withLinks: boolean) {
  const autoLinks = withLinks && format.autoLinks;
  const ownInputRules = format.typography ? ['typography'] : [];
  const ownPasteRules = autoLinks ? ['link'] : [];
  return {
    link: withLinks
      ? [(autoLinks ? Link : LinkWithoutPasteRule).configure({
          openOnClick: false,
          HTMLAttributes: { class: 'external-link' },
          autolink: autoLinks,
          linkOnPaste: autoLinks,
        })]
      : [],
    typography: format.typography ? [Typography] : [],
    enableInputRules: format.markdownShortcuts || ownInputRules,
    enablePasteRules: format.markdownShortcuts || ownPasteRules,
  };
}

/**
 * The writing surface: one TipTap editor, saving HTML.
 *
 * Everything that may exist only ONCE per document is held by the host
 * (`useTextEditorHost`): toolbar, link picker, navigation via chip click,
 * drops (files from the explorer, entries from the left list) and the drag
 * tag. Hung on the `document` per editor, with several editors every request
 * would hit every one of them.
 *
 * What stays here is whatever hangs on exactly this editor: extensions and chip lookups,
 * the menus at a selection, the popup for external links and inserting via paste.
 */
export default function TextEditor({
  initialContent,
  // No English default: the stack passes in the localised placeholder.
  placeholder = '',
  onChange,
  editable = true,
  features: featuresProp = FULL_TEXT_FEATURES,
  hostKey,
}: TextEditorProps) {
  const { t } = useTranslation();

  // Link popup state (edit mode only)
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  const linkPopupRef = useRef<HTMLDivElement>(null);

  // Always-fresh items ref so the extension closure never goes stale.
  const linkItems = useLinkItems();
  const itemsRef = useRef<SuggestionItem[]>([]);
  itemsRef.current = linkItems;

  // Icon and title of a chip, looked up live from the same list as
  // picker and sidebar (`buildLinkItems`), so that all three show the same
  // thing. `displayIcon` can also be an image, which must not go into the node attrs.
  const byKey = useMemo(() => linkItemsByKey(linkItems), [linkItems]);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const getIconRef = useRef((id: string, entryType: string): string | null => {
    const item = byKeyRef.current.get(linkItemKey({ id, entryType }));
    return item ? (item.displayIcon ?? item.icon ?? null) : null;
  });
  const getLabelRef = useRef((id: string, entryType: string): string | null =>
    byKeyRef.current.get(linkItemKey({ id, entryType }))?.label ?? null);

  // What the editor formats by itself while typing and pasting
  // (Settings → Entries). Read at creation: an open editor
  // keeps what it opened with; a new one would otherwise get different rules mid-typing.
  // The features too: the schema cannot change on an open editor.
  const [features] = useState(featuresProp);
  const [format] = useState(() => formattingOptions(useSettingsStore.getState().settings.editor, features.links));

  // For the paste handler, which is configured before the editor exists.
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Since TipTap 3 part of the kit. `Link` is configured below by
        // feature and settings; underline is not part of the schema; the
        // trailing node would add a paragraph on loading, which counts as a change.
        link: false,
        underline: false,
        trailingNode: false,
        heading: features.structure ? undefined : false,
        blockquote: features.structure ? undefined : false,
        horizontalRule: features.structure ? undefined : false,
        bulletList: features.lists ? undefined : false,
        orderedList: features.lists ? undefined : false,
        listItem: features.lists ? undefined : false,
      }),
      ...format.link,
      // Nested nodes get the class too (`includeChildren`), so that an empty
      // section heading can show its own; the stylesheet shows the editor's
      // placeholder only for an empty editor, as before.
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => (node.type.name === 'detailsSummary' ? i18n.t('editor.details.summaryPlaceholder') : placeholder),
      }),
      SearchExtension,
      ...format.typography,
      ...(features.structure && features.folding
        ? [createHeadingFold(() => ({ expand: i18n.t('editor.fold.expand'), collapse: i18n.t('editor.fold.collapse') }))]
        : []),
      ...(features.highlight ? [Highlight.configure({ multicolor: false })] : []),
      ...(features.colors ? [TextColorMark] : []),
      ...(features.tasks ? [TaskList, TaskItem.configure({ nested: true })] : []),
      // Images are left out: they align via their own
      // `align` attribute (block node with its own width), see
      // `alignMargins` in ResizableImageExtension.
      ...(features.align ? [TextAlign.configure({ types: [...TEXT_ALIGN_TYPES] })] : []),
      ...(features.entryLinks
        ? [
            createInternalLinkExtension(
              (query) => {
                const q = query.toLowerCase();
                return itemsRef.current.filter((item) =>
                  item.label.toLowerCase().includes(q)
                );
              },
              (id, entryType) => getIconRef.current(id, entryType),
              (id, entryType) => getLabelRef.current(id, entryType)
            ),
          ]
        : []),
      ...(features.images ? [ResizableImage] : []),
      ...(features.tables ? [TableKit.configure({ table: { resizable: true } })] : []),
      // The open state is not stored: it would be a change of the content
      // while reading. Every section opens closed.
      ...(features.details
        ? [
            Details.configure({
              persist: false,
              renderToggleButton: ({ element, isOpen }) => {
                element.setAttribute('aria-label', i18n.t(isOpen ? 'editor.details.collapse' : 'editor.details.expand'));
              },
            }),
            DetailsSummary,
            DetailsContent,
          ]
        : []),
      // The labels in the language of the moment, not of the editor's creation.
      ...(features.commands ? [createSlashCommands((key) => i18n.t(key))] : []),
    ],
    enableInputRules: format.enableInputRules,
    enablePasteRules: format.enablePasteRules,
    content: initialContent || '',
    editable,
    // Otherwise @tiptap/react re-renders this component on every transaction
    // (every keystroke, every cursor movement). Nothing here reads editor
    // state during render: the link popup listens to `selectionUpdate`, the
    // toolbar in BlockStack itself to `transaction`.
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      handlePaste(view, event) {
        if (!view.state.schema.nodes['image']) return false;
        // Every image of the clipboard, in its order; anything else pastes as usual.
        const files = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file && isAcceptedImageFile(file));
        const current = editorRef.current;
        if (files.length === 0 || !current) return false;
        event.preventDefault();
        void insertImageFiles(current, files);
        return true;
      },
    },
  });

  editorRef.current = editor;

  const host = useContext(TextEditorHostContext);
  useEffect(() => {
    if (!editor || !host || hostKey === undefined) return;
    host.register(hostKey, editor);
    return () => host.register(hostKey, null);
  }, [editor, host, hostKey]);

  // Track cursor position to show link popup in edit mode
  const updateLinkPopup = useCallback(() => {
    if (!editor || !editable || !editorHas(editor, 'link')) return;
    const { state } = editor;
    const { from } = state.selection;
    const marks = state.doc.resolve(from).marks();
    const linkMark = marks.find((m) => m.type.name === 'link');
    if (!linkMark) {
      setLinkPopup(null);
      return;
    }
    // Find the DOM node for the link at cursor
    const domPos = editor.view.domAtPos(from);
    let node: Node | null = domPos.node;
    // Walk up to find the <a> element
    while (node && (node as HTMLElement).tagName !== 'A') {
      node = node.parentElement;
    }
    if (node) {
      const rect = (node as HTMLElement).getBoundingClientRect();
      setLinkPopup({ href: linkMark.attrs.href as string, rect });
    } else {
      setLinkPopup(null);
    }
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || !editable) return;
    const onBlur = () => {
      // Delay so popup click events can fire before hiding
      setTimeout(() => {
        if (!linkPopupRef.current?.contains(document.activeElement)) {
          setLinkPopup(null);
          setEditingLink(false);
        }
      }, 150);
    };
    editor.on('selectionUpdate', updateLinkPopup);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', updateLinkPopup);
      editor.off('blur', onBlur);
    };
  }, [editor, editable, updateLinkPopup]);

  // Without an `update` event: toggling changes no content, and an
  // event here would reach the block stack as a supposed change.
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  // Old percentage widths become pixels once editing starts (see
  // `pinPercentImageWidths`); they are saved with the first real change.
  useEffect(() => {
    if (editor && editable && features.images) pinPercentImageWidths(editor);
  }, [editable, editor, features.images]);

  // Open external links in browser (read mode only)
  useEffect(() => {
    if (editable || !editor) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a.external-link') as HTMLAnchorElement | null;
      if (!anchor) return;
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        openUrl(href).catch((err: unknown) => console.error('[link] open failed:', err));
      }
    };
    const el = editor.view.dom;
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [editable, editor]);

  const closeLinkPopup = () => {
    setEditingLink(false);
    setLinkPopup(null);
  };

  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {/* Only while editing: each menu is a plugin of its own and follows every transaction. */}
      {editor && editable && <SelectionMenus editor={editor} />}

      {/* Link popup — shown in edit mode when cursor is inside an external link */}
      {editable && linkPopup && (
        <div
          ref={linkPopupRef}
          // The same surface as the selection menus.
          className="editor-selection-menu fixed"
          style={{
            left: linkPopup.rect.left,
            top: linkPopup.rect.bottom + 6,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {editingLink ? (
            <LinkHrefForm
              initial={linkPopup.href}
              onConfirm={(href) => { if (editor) applyLinkHref(editor, href); closeLinkPopup(); }}
              onCancel={() => { setEditingLink(false); editor?.commands.focus(); }}
            />
          ) : (
            <>
              <ExternalLink size={12} className="text-subtle shrink-0 ml-1" />
              <span className="text-xs text-muted max-w-[220px] truncate">{linkPopup.href}</span>
              <ToolbarBtn onClick={() => setEditingLink(true)} active={false} title={t('editor.editLink')}>
                <Pencil size={14} />
              </ToolbarBtn>
              <ToolbarBtn
                onClick={() => { if (editor) applyLinkHref(editor, ''); closeLinkPopup(); }}
                active={false}
                title={t('editor.removeLink')}
              >
                <Unlink size={14} />
              </ToolbarBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}
