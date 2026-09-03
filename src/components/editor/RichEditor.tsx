import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
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
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { saveImage, copyImageFile } from '../../lib/images';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Pencil, Trash2, Check, X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import EditorToolbar, { TEXT_ALIGN_TYPES } from './EditorToolbar';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import LinkPickerModal from './LinkPickerModal';
import { createInternalLinkExtension } from './InternalLinkExtension';
import { ExternalDropExtension } from './ExternalDropExtension';
import { DEFAULT_ENTRY_EMOJI, type SuggestionItem } from './SuggestionList';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getDragItem, setDragItem, subscribeDrag } from '../../lib/dragState';
import { viewTypeForEntryType } from '../../lib/modules';
import {
  APPEND_ENTRY_LINK_EVENT, REMOVE_ENTRY_LINK_EVENT, REVEAL_ENTRY_LINK_EVENT,
  isValidLinkTarget, subscribeEntryLinkRequest, type EntryLinkRequest,
} from '../../lib/links';
import { internalLinkBlockHtml } from '../../lib/internalLinkHtml';
import { useLinkItems } from '../../hooks/useLinkItems';
import type { ContentType } from '../../types';
import { getRoutineDragItem, setRoutineDragItem, subscribeRoutineDrag, type RoutineDragItem } from '../../lib/routineDragState';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { isAcceptedImageFile } from '../../lib/helpers';

interface LinkPopupState {
  href: string;
  rect: DOMRect;
}

/** Position des ERSTEN Link-Chips für `id`/`entryType` im Dokument, oder `null`.
 *  Ein zweifach verlinktes Ziel wird also immer an seiner ersten Stelle
 *  gefunden — für „ist das schon verlinkt?" und „zeig mir die Stelle" reicht
 *  das, ein zweiter Treffer bräuchte erst eine Bedienung dafür. */
function findEntryLinkPos(doc: ProseMirrorNode, target: { id: string; entryType: string }): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'internalLink' && node.attrs.id === target.id && node.attrs.entryType === target.entryType) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Hängt einen internen Link ganz unten an den Eintrag an, jedes Mal als
 * vollständiger Block: Trennlinie, Kategorie des Ziels als Überschrift, dann
 * der Link. Bewusst ohne Zusammenfassen — zwei Links derselben Kategorie
 * bekommen zwei Blöcke.
 *
 * Wie der Block aussieht, sagt `internalLinkBlockHtml` — eine Definition für
 * das Einfügen hier und für die Migration v36, die dieselben Blöcke ohne
 * Editor schreiben muss.
 *
 * Ein bereits verlinktes Ziel wird nicht ein zweites Mal angehängt. Der Cursor
 * springt anschließend hinter den neuen Link: das Feld in der Seitenleiste
 * verliert dabei den Fokus, was gewollt ist — man sieht, wo der Link gelandet
 * ist, statt blind weiterzuklicken.
 */
function appendEntryLink(editor: Editor, item: EntryLinkRequest): void {
  const { doc } = editor.state;
  if (findEntryLinkPos(doc, item) !== null) return;

  const html = internalLinkBlockHtml(
    {
      id: item.id,
      entryType: item.entryType,
      label: item.label,
      icon: item.icon ?? null,
      entry_number: item.entry_number ?? null,
    },
    item.categoryLabel ?? '',
  );

  // insertContentAt setzt die Selektion ans Ende des Eingefügten; focus() holt
  // sie in den Editor, scrollIntoView bringt den neuen Block ins Bild.
  editor.chain().insertContentAt(doc.content.size, html).focus().scrollIntoView().run();
}

/**
 * Entfernt einen Link aus dem Eintrag. Stand er in einem eigenen
 * Verlinkungs-Block — Trennlinie, Überschrift, Absatz nur mit diesem Chip, so
 * wie `appendEntryLink` ihn anlegt —, fällt der ganze Block weg. Steht er
 * mitten im Fließtext, verschwindet nur der Chip und der Satz bleibt stehen.
 *
 * Gibt `false` zurück, wenn der Link nicht im Inhalt steht (etwa bei einer
 * Verknüpfung aus den alten Spalten).
 */
/** Trägt der Absatz nur diesen einen Chip (plus Leerraum)? */
function holdsOnlyLink(paragraph: ProseMirrorNode, target: { id: string; entryType: string }): boolean {
  let only = true;
  paragraph.forEach((child) => {
    if (child.type.name === 'internalLink') {
      if (child.attrs.id !== target.id || child.attrs.entryType !== target.entryType) only = false;
      return;
    }
    if (child.isText && !(child.text ?? '').trim()) return;
    only = false;
  });
  return only;
}

function removeEntryLink(editor: Editor, target: { id: string; entryType: string }): boolean {
  const { doc } = editor.state;
  const pos = findEntryLinkPos(doc, target);
  if (pos === null) return false;

  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  // Ein Verlinkungs-Block ist NUR, was `appendEntryLink` anlegt: ein Absatz
  // direkt im Dokument, der nichts als diesen Chip trägt, mit einer Trennlinie
  // davor und höchstens einer Überschrift dazwischen. Alles andere — ein Chip
  // in einer Liste, in einem Zitat, unter einer selbst getippten Überschrift —
  // ist Fließtext, und dort wird nur der Chip entfernt. Ohne diese engen
  // Grenzen risse das Löschen fremde Blöcke mit.
  if ($pos.depth === 1 && parent.type.name === 'paragraph' && holdsOnlyLink(parent, target)) {
    const paragraphPos = $pos.before(1);
    const index = $pos.index(0);
    const prev = index >= 1 ? doc.child(index - 1) : null;
    const prevPrev = index >= 2 ? doc.child(index - 2) : null;

    let from = paragraphPos;
    if (prev?.type.name === 'horizontalRule') {
      from -= prev.nodeSize;
    } else if (prev?.type.name === 'heading' && prevPrev?.type.name === 'horizontalRule') {
      from -= prev.nodeSize + prevPrev.nodeSize;
    } else {
      from = -1; // keine eröffnende Trennlinie — also kein Block von uns
    }

    if (from >= 0) {
      editor.chain().deleteRange({ from, to: paragraphPos + parent.nodeSize }).run();
      return true;
    }
  }

  editor.chain().deleteRange({ from: pos, to: pos + doc.nodeAt(pos)!.nodeSize }).run();
  return true;
}

const REVEAL_CLASS = 'is-revealed';
/** Muss zur Dauer von `internal-link-reveal` in index.css passen. */
const REVEAL_MS = 1600;
let revealTimer: number | undefined;
let revealedEl: HTMLElement | undefined;

/**
 * Springt zum Link-Chip im Inhalt und hebt ihn kurz hervor. Gibt `false`
 * zurück, wenn der Eintrag ihn nicht enthält — dann hat der Aufrufer die Wahl,
 * stattdessen zum Ziel zu navigieren.
 *
 * Timer und markiertes Element liegen modulweit, damit ein zweiter Klick auf
 * denselben Chip wieder aufblitzt (Klasse ab, Reflow, Klasse an) statt am noch
 * laufenden ersten Durchlauf hängenzubleiben. Nur ein Chip ist je markiert.
 */
function revealEntryLink(editor: Editor, target: { id: string; entryType: string }): boolean {
  const pos = findEntryLinkPos(editor.state.doc, target);
  if (pos === null) return false;

  // Im Edit-Modus zusätzlich echt selektieren, damit der Cursor dort steht;
  // im Lesemodus zeigt ProseMirror keine Selektion, dort trägt die Klasse.
  if (editor.isEditable) editor.chain().setNodeSelection(pos).focus().run();

  const dom = editor.view.nodeDOM(pos);
  const el = dom instanceof HTMLElement
    ? (dom.querySelector<HTMLElement>('.internal-link-chip') ?? dom)
    : null;
  if (!el) return true;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

  if (revealTimer !== undefined) window.clearTimeout(revealTimer);
  revealedEl?.classList.remove(REVEAL_CLASS);
  el.classList.remove(REVEAL_CLASS);
  void el.offsetWidth; // Reflow erzwingen, sonst startet die Animation nicht neu.
  el.classList.add(REVEAL_CLASS);
  revealedEl = el;
  revealTimer = window.setTimeout(() => {
    el.classList.remove(REVEAL_CLASS);
    revealTimer = undefined;
    revealedEl = undefined;
  }, REVEAL_MS);
  return true;
}

interface RichEditorProps {
  /**
   * Nur der INITIALWERT — der Editor ist danach unkontrolliert. Die Views
   * mounten ihn per `key` neu, wenn ein anderer Eintrag geladen oder Cancel
   * gedrueckt wird. Der fruehere Sync-Effekt, der bei jedem Render
   * `getHTML()` mit dem Prop verglich, war zusammen mit `onUpdate` eine
   * doppelte Serialisierung des gesamten Dokuments pro Tastendruck.
   */
  initialContent: string;
  placeholder?: string;
  onChange: (content: string) => void;
  editable?: boolean;
}

export default function RichEditor({
  initialContent,
  // Kein englischer Default: alle Views übergeben ihren lokalisierten Placeholder.
  placeholder = '',
  onChange,
  editable = true,
}: RichEditorProps) {
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const operations = useOperationStore((s) => s.operations);
  const categories = useOperationStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const taskCategories = useTaskStore((s) => s.categories);
  const altars = useAltarStore((s) => s.altars);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const { t } = useTranslation();

  // Link popup state (edit mode only)
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [editingHref, setEditingHref] = useState<string | null>(null);
  const linkPopupRef = useRef<HTMLDivElement>(null);

  // Link picker modal state
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  // Always-fresh icon lookup ref — returns the current icon for any entry from the store.
  // Backed by a ref so the extension closure never goes stale after initial mount.
  const storeRef = useRef({ entries, articles, wikiCategories, operations, categories, tasks, taskCategories, altars });
  storeRef.current = { entries, articles, wikiCategories, operations, categories, tasks, taskCategories, altars };
  const getIconRef = useRef((id: string, entryType: string): string | null => {
    const { entries, articles, wikiCategories, operations, categories, tasks, taskCategories, altars } = storeRef.current;
    if (entryType === 'journal') {
      const e = entries.find((e) => e.id === id);
      return e ? (MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? DEFAULT_ENTRY_EMOJI.journal) : null;
    }
    if (entryType === 'wiki') {
      const a = articles.find((a) => a.id === id);
      if (!a) return null;
      const catEmoji = wikiCategories.find((c) => c.id === a.category_id)?.emoji ?? getCategoryEmoji(a.category_id as any);
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
      return taskCategories.find((c) => c.id === task.category_id)?.emoji || DEFAULT_ENTRY_EMOJI.task;
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
      // Bilder richten sich ueber ihr eigenes `align`-Attribut aus (Blocknode mit
      // eigener Breite) — `text-align` auf dem Absatz erreicht sie nicht.
      // Bilder bleiben aussen vor: sie richten sich ueber ihr eigenes
      // `align`-Attribut aus, siehe `alignMargins` in ResizableImageExtension.
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
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const src = await saveImage(reader.result as string);
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

      // Die Operationen und Wiki-Artikel der Routine landen als Link-Chips
      // unten im Eintrag — dort, wo das Verlinkungs-Feld der Seitenleiste sie
      // auch wieder findet. (Früher: eigene Spalten am Journal-Eintrag.)
      for (const link of [
        ...dragItem.operation_ids.map((id) => ({ id, entryType: 'operation' as const })),
        ...dragItem.wiki_ids.map((id) => ({ id, entryType: 'wiki' as const })),
      ]) {
        const item = itemsRef.current.find((i) => i.entryType === link.entryType && i.id === link.id);
        if (item) appendEntryLink(editor, item);
      }

      // Tags bleiben Sache der View — sie besitzt den lokalen Tag-State.
      if (dragItem.tags.length > 0) {
        document.dispatchEvent(new CustomEvent('routine-drop', { detail: { tags: dragItem.tags } }));
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

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // Anhängen und Entfernen aus dem Verlinkungs-Feld — nur im Edit-Modus.
  // Bleibt die Quittung aus (kein editierbarer Editor, weil der Eintrag noch
  // nicht geladen ist), weiß das Feld, dass sein Klick ins Leere ging.
  useEffect(() => {
    if (!editor || !editable) return;
    const off = [
      subscribeEntryLinkRequest(APPEND_ENTRY_LINK_EVENT, (item) => {
        appendEntryLink(editor, item);
        return true;
      }),
      subscribeEntryLinkRequest(REMOVE_ENTRY_LINK_EVENT, (target) => removeEntryLink(editor, target)),
    ];
    return () => off.forEach((fn) => fn());
  }, [editor, editable]);

  // Klick auf einen Chip im Verlinkungs-Feld → zur Stelle im Eintrag springen.
  // Anders als die beiden oben auch im Lesemodus: dort ist es der Normalfall.
  useEffect(() => {
    if (!editor) return;
    return subscribeEntryLinkRequest(
      REVEAL_ENTRY_LINK_EVENT,
      (target) => revealEntryLink(editor, target),
    );
  }, [editor]);

  // File drag & drop from Finder via Tauri's native drag-drop API
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [fileDragOver, setFileDragOver] = useState(false);
  const [dragFormatError, setDragFormatError] = useState(false);
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
          if (!imagePaths.length) { setDragFormatError(true); return; }

          const ed = editorRef.current;
          if (!ed) return;

          for (const path of imagePaths) {
            try {
              const src = await copyImageFile(path);
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
  useEffect(() => {
    if (editable) return;
    const handler = (e: Event) => {
      const { id, entryType: rawEntryType } = (e as CustomEvent<{ id: string; entryType: string }>).detail;
      const entryType = rawEntryType?.trim();
      // Prüfen, bevor navigiert wird — schützt gegen synthetische Events aus
      // XSS im Editor-Inhalt. Dieselbe Prüfung wie beim Anhängen und Anzeigen.
      if (!isValidLinkTarget({ id, entryType })) return;
      setActiveView({ type: viewTypeForEntryType(entryType as ContentType), id, mode: 'view' });
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
              const src = await saveImage(dataUrl);
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

      {/* Drag-drop format error modal */}
      {dragFormatError && (
        <Modal
          title={t('common.unsupportedImageFormat')}
          onClose={() => setDragFormatError(false)}
          widthClassName="w-72"
          bodyClassName="px-4 py-3"
        >
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <AlertCircle size={14} />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>PNG, JPEG, GIF, WebP, SVG</p>
          </div>
          <Button onClick={() => setDragFormatError(false)} variant="secondary" className="w-full">
            {t('common.ok')}
          </Button>
        </Modal>
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
              {/* Bei Operationen und Aufgaben trägt category bereits das Emoji;
                  nur beim Wiki ist es die Kategorie-id für den Lookup. */}
              {(wikiDragItem.entryType === 'operation' || wikiDragItem.entryType === 'task') && wikiDragItem.category ? (
                <span className="text-sm">{wikiDragItem.category}</span>
              ) : wikiDragItem.entryType === 'wiki' && wikiDragItem.category ? (
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
