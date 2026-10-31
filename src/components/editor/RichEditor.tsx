import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TextAlign from '@tiptap/extension-text-align';
import { ResizableImage } from './ResizableImageExtension';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { saveImage } from '../../lib/images';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Pencil, Trash2, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TEXT_ALIGN_TYPES } from './EditorToolbar';
import Button from '../ui/Button';
import { createInternalLinkExtension } from './InternalLinkExtension';
import { ExternalDropExtension } from './ExternalDropExtension';
import type { SuggestionItem } from './SuggestionList';
import { useLinkItems } from '../../hooks/useLinkItems';
import { linkItemKey, linkItemsByKey } from '../../lib/linkItems';
import { isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';
import { prepareImageDataUrl } from '../../lib/imageLimits';
import { reportImageError } from '../../store/imageNoticeStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { EditorSettings } from '../../lib/vaultSettings';

interface LinkPopupState {
  href: string;
  rect: DOMRect;
}

interface RichEditorProps {
  /**
   * Only the INITIAL VALUE: the editor is uncontrolled afterwards. The stack
   * remounts it via `key` when another entry is loaded or Cancel is
   * pressed. The former sync effect, which compared `getHTML()` with the prop
   * on every render, amounted together with `onUpdate` to a
   * double serialisation of the entire document per keystroke.
   */
  initialContent: string;
  placeholder?: string;
  onChange: (content: string) => void;
  editable?: boolean;
  /** Reports the editor instance once it exists, and `null` on teardown. */
  onEditorReady?: (editor: Editor | null) => void;
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
function formattingOptions(format: EditorSettings) {
  const ownInputRules = format.typography ? ['typography'] : [];
  const ownPasteRules = format.autoLinks ? ['link'] : [];
  return {
    link: (format.autoLinks ? Link : LinkWithoutPasteRule).configure({
      openOnClick: false,
      HTMLAttributes: { class: 'external-link' },
      autolink: format.autoLinks,
      linkOnPaste: format.autoLinks,
    }),
    typography: format.typography ? [Typography] : [],
    enableInputRules: format.markdownShortcuts || ownInputRules,
    enablePasteRules: format.markdownShortcuts || ownPasteRules,
  };
}

/**
 * The writing surface of a text block.
 *
 * Everything that may exist only ONCE per opened entry is held by the
 * `BlockStack`: toolbar, link picker, the sidebar's link requests,
 * navigation via chip click, drops (files from the explorer, entries from the
 * left list) and the drag tag. That used to hang here, and thus
 * on the `document` per editor; with several text blocks every request would have
 * hit every block.
 *
 * What stays here is whatever hangs on exactly this editor: extensions and chip lookups,
 * the popup for external links and inserting via paste.
 */
export default function RichEditor({
  initialContent,
  // No English default: the stack passes in the localised placeholder.
  placeholder = '',
  onChange,
  editable = true,
  onEditorReady,
}: RichEditorProps) {
  const { t } = useTranslation();

  // Link popup state (edit mode only)
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [editingHref, setEditingHref] = useState<string | null>(null);
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
  const [format] = useState(() => formattingOptions(useSettingsStore.getState().settings.editor));

  const editor = useEditor({
    extensions: [
      StarterKit,
      format.link,
      Placeholder.configure({ placeholder }),
      ...format.typography,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Images are left out: they align via their own
      // `align` attribute (block node with its own width), see
      // `alignMargins` in ResizableImageExtension.
      TextAlign.configure({ types: [...TEXT_ALIGN_TYPES] }),
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
      ExternalDropExtension,
      ResizableImage,
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
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));
        if (!imageItem) return false;
        event.preventDefault();
        const file = imageItem.getAsFile();
        if (!file || !isAcceptedImageFile(file)) return false;
        void (async () => {
          try {
            const src = await saveImage(await prepareImageDataUrl(await readFileAsDataUrl(file)));
            const nodeType = view.state.schema.nodes['image'];
            if (!nodeType) return;
            view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create({ src })));
          } catch (e) {
            reportImageError(e, 'paste');
          }
        })();
        return true;
      },
    },
  });

  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  useEffect(() => {
    if (!editor) return;
    onEditorReadyRef.current?.(editor);
    return () => onEditorReadyRef.current?.(null);
  }, [editor]);

  // Track cursor position to show link popup in edit mode
  const updateLinkPopup = useCallback(() => {
    if (!editor || !editable) return;
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
          setEditingHref(null);
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

  const handleLinkEditConfirm = () => {
    if (!editor || editingHref === null) return;
    const href = editingHref.trim();
    if (href) {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setEditingHref(null);
    setLinkPopup(null);
  };

  const handleLinkRemove = () => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkPopup(null);
    setEditingHref(null);
  };

  return (
    <div className="relative">
      <EditorContent editor={editor} />

      {/* Link popup — shown in edit mode when cursor is inside an external link */}
      {editable && linkPopup && (
        <div
          ref={linkPopupRef}
          className="fixed z-50 flex items-center gap-1 px-2 py-1.5 bg-stone-800 border border-stone-600 rounded-lg shadow-xl text-xs"
          style={{
            left: linkPopup.rect.left,
            top: linkPopup.rect.bottom + 6,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {editingHref !== null ? (
            <>
              <input
                autoFocus
                value={editingHref}
                onChange={(e) => setEditingHref(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkEditConfirm();
                  if (e.key === 'Escape') { setEditingHref(null); }
                }}
                className="bg-stone-900 border border-stone-600 rounded px-2 py-0.5 text-stone-200 w-64 outline-none focus:border-jade-600"
                placeholder="https://"
              />
              <button onClick={handleLinkEditConfirm} className="p-1 text-jade-400 hover:text-jade-300" title={t('editor.confirm')}>
                <Check size={12} />
              </button>
              <button onClick={() => setEditingHref(null)} className="p-1 text-stone-500 hover:text-stone-300" title={t('editor.cancel')}>
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              <ExternalLink size={11} className="text-stone-500 shrink-0" />
              <span className="text-stone-400 max-w-[220px] truncate">{linkPopup.href}</span>
              <button
                onClick={() => setEditingHref(linkPopup.href)}
                className="p-1 text-stone-500 hover:text-stone-300 ml-1"
                title={t('editor.editLink')}
              >
                <Pencil size={11} />
              </button>
              <Button
                onClick={handleLinkRemove}
                variant="danger"
                className="p-1"
                title={t('editor.removeLink')}
              >
                <Trash2 size={11} />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
