import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ResizableImage } from './ResizableImageExtension';
import { useEffect, useRef, useState, useCallback } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Pencil, Trash2, Check, X } from 'lucide-react';

async function persistImage(dataUrl: string): Promise<string> {
  return invoke<string>('save_image', { dataUrl });
}
import EditorToolbar from './EditorToolbar';
import LinkPickerModal from './LinkPickerModal';
import { createInternalLinkExtension } from './InternalLinkExtension';
import { ExternalDropExtension } from './ExternalDropExtension';
import type { SuggestionItem } from './SuggestionList';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getDragItem, setDragItem, subscribeDrag } from '../../lib/dragState';
import { getRoutineDragItem, setRoutineDragItem, subscribeRoutineDrag, type RoutineDragItem } from '../../lib/routineDragState';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUIStore } from '../../store/uiStore';

interface LinkPopupState {
  href: string;
  rect: DOMRect;
}

interface RichEditorProps {
  content: string;
  placeholder?: string;
  onChange: (content: string) => void;
  editable?: boolean;
}

export default function RichEditor({
  content,
  placeholder = 'Begin writing...',
  onChange,
  editable = true,
}: RichEditorProps) {
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const operations = useOperationStore((s) => s.operations);
  const categories = useOperationStore((s) => s.categories);
  const setActiveView = useUIStore((s) => s.setActiveView);

  // Link popup state (edit mode only)
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [editingHref, setEditingHref] = useState<string | null>(null);
  const linkPopupRef = useRef<HTMLDivElement>(null);

  // Link picker modal state
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  // Always-fresh icon lookup ref — returns the current icon for any entry from the store.
  // Backed by a ref so the extension closure never goes stale after initial mount.
  const storeRef = useRef({ entries, articles, wikiCategories, operations, categories });
  storeRef.current = { entries, articles, wikiCategories, operations, categories };
  const getIconRef = useRef((id: string, entryType: string): string | null => {
    const { entries, articles, wikiCategories, operations, categories } = storeRef.current;
    if (entryType === 'journal') {
      const e = entries.find((e) => e.id === id);
      return e ? (MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓') : null;
    }
    if (entryType === 'wiki') {
      const a = articles.find((a) => a.id === id);
      if (!a) return null;
      const catEmoji = wikiCategories.find((c) => c.id === a.category)?.emoji ?? getCategoryEmoji(a.category as any);
      return a.icon || catEmoji;
    }
    if (entryType === 'operation') {
      const o = operations.find((o) => o.id === id);
      if (!o) return null;
      return o.icon || categories.find((c) => c.id === o.category_id)?.emoji || '⚡';
    }
    return null;
  });

  const getLabelRef = useRef((id: string, entryType: string): string | null => {
    const { entries, articles, operations } = storeRef.current;
    if (entryType === 'journal') return entries.find((e) => e.id === id)?.title ?? null;
    if (entryType === 'wiki') return articles.find((a) => a.id === id)?.title ?? null;
    if (entryType === 'operation') return operations.find((o) => o.id === id)?.title ?? null;
    return null;
  });

  // Always-fresh items ref so the extension closure never goes stale.
  // icon priority: journal → moon phase emoji; wiki → custom icon or category emoji;
  // operation → category emoji (stored on the category row, not the operation itself).
  const itemsRef = useRef<SuggestionItem[]>([]);
  itemsRef.current = [
    ...entries.map((e) => ({
      id: e.id,
      entryType: 'journal' as const,
      label: e.title,
      icon: MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓',
      entry_number: e.entry_number,
    })),
    ...articles.map((a) => ({
      id: a.id,
      entryType: 'wiki' as const,
      label: a.title,
      category: a.category,
      icon: a.icon || (wikiCategories.find((c) => c.id === a.category)?.emoji ?? getCategoryEmoji(a.category as any)),
      entry_number: a.entry_number,
    })),
    ...operations.map((o) => ({
      id: o.id,
      entryType: 'operation' as const,
      label: o.title,
      category: categories.find((c) => c.id === o.category_id)?.emoji,
      icon: o.icon || categories.find((c) => c.id === o.category_id)?.emoji || '⚡',
      entry_number: o.entry_number,
    })),
  ];

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
    content: content || '',
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
        if (!file) return false;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const src = await persistImage(reader.result as string);
            const nodeType = view.state.schema.nodes['image'];
            if (!nodeType) return;
            view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create({ src })));
          } catch (e) {
            console.error('Failed to save pasted image:', e);
          }
        };
        reader.readAsDataURL(file);
        return true;
      },
    },
  });

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
    editor.on('selectionUpdate', updateLinkPopup);
    editor.on('blur', () => {
      // Delay so popup click events can fire before hiding
      setTimeout(() => {
        if (!linkPopupRef.current?.contains(document.activeElement)) {
          setLinkPopup(null);
          setEditingHref(null);
        }
      }, 150);
    });
    return () => {
      editor.off('selectionUpdate', updateLinkPopup);
    };
  }, [editor, editable, updateLinkPopup]);

  // Wiki/Ops sidebar → editor drop via pointer events
  const [wikiDragItem, setWikiDragItem] = useState<SuggestionItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => subscribeDrag(setWikiDragItem), []);

  // Routine sidebar → editor drop
  const [routineDragItem, setRoutineDragItemState] = useState<RoutineDragItem | null>(null);
  useEffect(() => subscribeRoutineDrag(setRoutineDragItemState), []);

  useEffect(() => {
    if (!routineDragItem) return;

    const handlePointerMove = (e: PointerEvent) => {
      setGhostPos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dragItem = getRoutineDragItem();
      setRoutineDragItem(null);
      if (!dragItem || !editor || !editable) return;

      const editorEl = editor.view.dom;
      const rect = editorEl.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;

      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) return;

      // Parse markdown, sanitize, and insert as formatted HTML
      const rawHtml = (marked.parse(dragItem.content || '') as string) || '<p></p>';
      const html = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });

      editor.chain().focus().insertContentAt(pos.pos, html).run();

      // Fire event so the active view can merge the routine's tags + operation_ids + wiki_ids
      if (dragItem.tags.length > 0 || dragItem.operation_ids.length > 0 || dragItem.wiki_ids.length > 0) {
        document.dispatchEvent(new CustomEvent('routine-drop', { detail: { tags: dragItem.tags, operation_ids: dragItem.operation_ids, wiki_ids: dragItem.wiki_ids } }));
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [routineDragItem, editor, editable]);

  useEffect(() => {
    if (!wikiDragItem) {
      setGhostPos(null);
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      setGhostPos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dragItem = getDragItem();
      setDragItem(null);
      if (!dragItem || !editor || !editable) return;

      // Check if pointer landed inside the editor
      const editorEl = editor.view.dom;
      const rect = editorEl.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;

      // Resolve ProseMirror position from coordinates
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) return;

      editor.chain()
        .focus()
        .insertContentAt(pos.pos, {
          type: 'internalLink',
          attrs: { id: dragItem.id, entryType: dragItem.entryType, label: dragItem.label, icon: dragItem.icon ?? null },
        })
        .run();
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [wikiDragItem, editor, editable]);

  // Sync content when switching entries (key-based remount handles this,
  // but keep as fallback for edge cases)
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content || '', false);
    }
  }, [content]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // File drag & drop from Finder via Tauri's native drag-drop API
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [fileDragOver, setFileDragOver] = useState(false);
  useEffect(() => {
    if (!editable) return;
    const unlistenRef = { fn: undefined as (() => void) | undefined };

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const { type } = event.payload;

        if (type === 'enter' || type === 'over') { setFileDragOver(true); return; }
        if (type === 'leave') { setFileDragOver(false); return; }

        if (type === 'drop') {
          setFileDragOver(false);
          const { paths } = event.payload;
          const imagePaths = paths.filter((p) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p));
          if (!imagePaths.length) return;

          const ed = editorRef.current;
          if (!ed) return;

          for (const path of imagePaths) {
            try {
              const src = await invoke<string>('copy_image_file', { source: path });
              ed.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
            } catch (e) {
              console.error('[DnD] failed:', path, e);
            }
          }
        }
      })
      .then((fn) => { unlistenRef.fn = fn; })
      .catch((e) => console.error('[DnD] setup failed:', e));

    return () => { unlistenRef.fn?.(); };
  }, [editable]);

  // Navigate to internal link via CustomEvent (fired by InternalLinkNodeView).
  // Only active in read mode — edit mode ignores clicks so the cursor can be placed.
  // 'operation' maps to view type 'operations' (plural) to match uiStore's naming.
  useEffect(() => {
    if (editable) return;
    const handler = (e: Event) => {
      const { id, entryType: rawEntryType } = (e as CustomEvent<{ id: string; entryType: string }>).detail;
      const entryType = rawEntryType?.trim();
      // Validate inputs before navigating — guards against synthetic events from XSS in editor content
      const VALID_TYPES = ['journal', 'wiki', 'operation'] as const;
      // Accept standard UUIDs and merge-prefixed IDs (8-char base36 prefix prepended during merge import)
      const UUID_RE = /^([0-9a-z]{8}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!VALID_TYPES.includes(entryType as any) || !UUID_RE.test(id)) return;
      setActiveView({ type: entryType === 'operation' ? 'operations' : entryType as any, id, mode: 'view' });
    };
    document.addEventListener('internal-link-navigate', handler);
    return () => document.removeEventListener('internal-link-navigate', handler);
  }, [editable, setActiveView]);

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
    <div className="flex flex-col h-full">
      {editable && editor && (
        <EditorToolbar
          editor={editor}
          onInsertImage={async (dataUrl) => {
            try {
              const src = await persistImage(dataUrl);
              editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
            } catch (e) {
              console.error('Failed to save image:', e);
            }
          }}
          onOpenLinkPicker={() => setLinkPickerOpen(true)}
        />
      )}
      <div
        className={`flex-1 overflow-y-auto relative ${((wikiDragItem || routineDragItem) && editable) || fileDragOver ? 'ring-1 ring-inset ring-jade-700/50' : ''}`}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>

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
              <button onClick={handleLinkEditConfirm} className="p-1 text-jade-400 hover:text-jade-300" title="Bestätigen">
                <Check size={12} />
              </button>
              <button onClick={() => setEditingHref(null)} className="p-1 text-stone-500 hover:text-stone-300" title="Abbrechen">
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
                title="Link bearbeiten"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={handleLinkRemove}
                className="p-1 text-stone-500 hover:text-red-400"
                title="Link entfernen"
              >
                <Trash2 size={11} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Link picker modal — opened via toolbar link button */}
      {editable && linkPickerOpen && editor && (
        <LinkPickerModal
          onSelect={(item) => {
            editor.chain().focus().insertContent({
              type: 'internalLink',
              attrs: {
                id: item.id,
                entryType: item.entryType,
                label: item.label,
                icon: item.icon ?? null,
                entry_number: item.entry_number ?? null,
              },
            }).insertContent(' ').run();
          }}
          onClose={() => setLinkPickerOpen(false)}
        />
      )}

      {/* Floating ghost following cursor during drag */}
      {(wikiDragItem || routineDragItem) && ghostPos && (
        <div
          className="fixed pointer-events-none z-50 flex items-center gap-1.5 px-2 py-1
                     bg-stone-800 border border-stone-600 rounded shadow-lg opacity-90"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 12 }}
        >
          {routineDragItem ? (
            <>
              <span className="text-sm">{routineDragItem.emoji}</span>
              <span className="text-xs text-jade-400">{routineDragItem.name}</span>
            </>
          ) : wikiDragItem ? (
            <>
              {wikiDragItem.entryType === 'operation' && wikiDragItem.category ? (
                <span className="text-sm">{wikiDragItem.category}</span>
              ) : wikiDragItem.category ? (
                <span className="text-sm">{getCategoryEmoji(wikiDragItem.category as any)}</span>
              ) : null}
              <span className="text-xs text-jade-400">{wikiDragItem.label}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
