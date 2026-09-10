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
import { useEffect, useRef, useState, useCallback } from 'react';
import { saveImage } from '../../lib/images';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Pencil, Trash2, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TEXT_ALIGN_TYPES } from './EditorToolbar';
import Button from '../ui/Button';
import { createInternalLinkExtension } from './InternalLinkExtension';
import { ExternalDropExtension } from './ExternalDropExtension';
import { DEFAULT_ENTRY_EMOJI, type SuggestionItem } from './SuggestionList';
import { useLinkItems } from '../../hooks/useLinkItems';
import { useCategoryStore } from '../../store/categoryStore';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';

interface LinkPopupState {
  href: string;
  rect: DOMRect;
}

interface RichEditorProps {
  /**
   * Nur der INITIALWERT — der Editor ist danach unkontrolliert. Der Stapel
   * mountet ihn per `key` neu, wenn ein anderer Eintrag geladen oder Cancel
   * gedrueckt wird. Der fruehere Sync-Effekt, der bei jedem Render
   * `getHTML()` mit dem Prop verglich, war zusammen mit `onUpdate` eine
   * doppelte Serialisierung des gesamten Dokuments pro Tastendruck.
   */
  initialContent: string;
  placeholder?: string;
  onChange: (content: string) => void;
  editable?: boolean;
  /** Meldet die Editor-Instanz, sobald sie steht, und `null` beim Abbau. */
  onEditorReady?: (editor: Editor | null) => void;
}

/**
 * Die Schreibfläche eines Textblocks.
 *
 * Alles, was es pro geöffnetem Eintrag nur EINMAL geben darf, hält der
 * `BlockStack`: Toolbar, Linkauswahl, die Link-Bitten der Seitenleiste, die
 * Navigation per Chip-Klick, Drops (Dateien aus dem Explorer, Einträge aus der
 * linken Liste, Routinen) und das Drag-Schild. Das hing früher hier und damit
 * pro Editor am `document` — mit mehreren Textblöcken hätte jede Bitte jeden
 * Block getroffen.
 *
 * Hier bleibt, was an genau diesem Editor hängt: Extensions und Chip-Lookups,
 * das Popup für externe Links und Einfügen per Paste.
 */
export default function RichEditor({
  initialContent,
  // Kein englischer Default: der Stapel übergibt den lokalisierten Placeholder.
  placeholder = '',
  onChange,
  editable = true,
  onEditorReady,
}: RichEditorProps) {
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const categories = useCategoryStore((s) => s.categories);
  const operations = useOperationStore((s) => s.operations);
  const tasks = useTaskStore((s) => s.tasks);
  const altars = useAltarStore((s) => s.altars);
  const { t } = useTranslation();

  // Link popup state (edit mode only)
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [editingHref, setEditingHref] = useState<string | null>(null);
  const linkPopupRef = useRef<HTMLDivElement>(null);

  // Always-fresh icon lookup ref — returns the current icon for any entry from the store.
  // Backed by a ref so the extension closure never goes stale after initial mount.
  const storeRef = useRef({ entries, articles, categories, operations, tasks, altars });
  storeRef.current = { entries, articles, categories, operations, tasks, altars };
  const getIconRef = useRef((id: string, entryType: string): string | null => {
    const { entries, articles, categories, operations, tasks, altars } = storeRef.current;
    if (entryType === 'journal') {
      const e = entries.find((e) => e.id === id);
      return e ? (MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? DEFAULT_ENTRY_EMOJI.journal) : null;
    }
    if (entryType === 'wiki') {
      const a = articles.find((a) => a.id === id);
      if (!a) return null;
      const catEmoji = categories.find((c) => c.id === a.category_id)?.emoji ?? DEFAULT_ENTRY_EMOJI.wiki;
      return a.icon || catEmoji;
    }
    if (entryType === 'operation') {
      const o = operations.find((o) => o.id === id);
      if (!o) return null;
      return o.icon || categories.find((c) => c.id === o.category_id)?.emoji || DEFAULT_ENTRY_EMOJI.operation;
    }
    if (entryType === 'task') {
      const task = tasks.find((task) => task.id === id);
      if (!task) return null;
      return categories.find((c) => c.id === task.category_id)?.emoji || DEFAULT_ENTRY_EMOJI.task;
    }
    if (entryType === 'altar') {
      const altar = altars.find((a) => a.id === id);
      if (!altar) return null;
      // icon_data ist eine data-URL und bleibt bewusst nur hier im Live-Lookup —
      // in die Node-Attrs (und damit ins gespeicherte HTML) gehört sie nicht.
      return altar.icon_data || DEFAULT_ENTRY_EMOJI.altar;
    }
    return null;
  });

  const getLabelRef = useRef((id: string, entryType: string): string | null => {
    const { entries, articles, operations, tasks, altars } = storeRef.current;
    if (entryType === 'journal') return entries.find((e) => e.id === id)?.title ?? null;
    if (entryType === 'wiki') return articles.find((a) => a.id === id)?.title ?? null;
    if (entryType === 'operation') return operations.find((o) => o.id === id)?.title ?? null;
    if (entryType === 'task') return tasks.find((task) => task.id === id)?.title ?? null;
    if (entryType === 'altar') return altars.find((a) => a.id === id)?.title ?? null;
    return null;
  });

  // Always-fresh items ref so the extension closure never goes stale.
  const linkItems = useLinkItems();
  const itemsRef = useRef<SuggestionItem[]>([]);
  itemsRef.current = linkItems;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'external-link' },
      }),
      Placeholder.configure({ placeholder }),
      Typography,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Bilder bleiben aussen vor: sie richten sich ueber ihr eigenes
      // `align`-Attribut aus (Blocknode mit eigener Breite), siehe
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
    content: initialContent || '',
    editable,
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
            const src = await saveImage(await readFileAsDataUrl(file));
            const nodeType = view.state.schema.nodes['image'];
            if (!nodeType) return;
            view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create({ src })));
          } catch (e) {
            console.error('Failed to save pasted image:', e);
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

  useEffect(() => {
    editor?.setEditable(editable);
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
