import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { saveImage } from '../../../lib/images';
import { prepareImageDataUrl } from '../../../lib/imageLimits';
import { reportImageError } from '../../../store/imageNoticeStore';
import { flashReveal, scrollIntoViewCentered } from '../../../lib/reveal';
import { internalLinkBlockHtml, toInternalLinkChip } from '../../../lib/internalLinkHtml';
import type { EntryLinkRequest } from '../../../lib/links';
import type { SuggestionItem } from './SuggestionList';

/**
 * Commands that write into an editor from outside: the sidebar's link
 * requests (append, remove, jump to), inserting an image, inserting a
 * link chip from the link picker. Since a document can have several
 * editors, their host decides WHICH editor receives a request, and calls them
 * from there.
 */

/** Position of the FIRST link chip for `id`/`entryType` in the document, or `null`.
 *  A target linked twice is thus always found at its first spot;
 *  for "is this already linked?" and "show me the spot" that is enough,
 *  a second hit would first need a way to operate it. */
export function findEntryLinkPos(doc: ProseMirrorNode, target: { id: string; entryType: string }): number | null {
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
 * Appends an internal link at the very bottom of the entry, each time as a
 * complete block: divider, the target's category as a heading, then
 * the link. Deliberately without merging: two links of the same category
 * get two blocks.
 *
 * What the block looks like is defined by `internalLinkBlockHtml`, one definition for
 * the insertion here and for the v36/v37 migrations, which have to write the same blocks without an
 * editor.
 *
 * If the entry is still empty, the divider is omitted and the empty paragraph is
 * replaced: the line separates the text from the links, and there is no text
 * yet.
 *
 * A target that is already linked is not appended a second time. Afterwards
 * the view jumps to the new link and briefly highlights it, the same
 * movement as when clicking a chip in the links field. The field in the
 * sidebar loses focus in the process, which is intended: you see where the
 * link landed instead of blindly clicking on.
 *
 * The cursor lands at the end of the link paragraph instead of on the chip;
 * why is explained at `caretAtBlockEnd` on `revealEntryLink`.
 */
export function appendEntryLink(editor: Editor, item: EntryLinkRequest): void {
  const { doc } = editor.state;
  if (findEntryLinkPos(doc, item) !== null) return;

  const empty = editor.isEmpty;
  const html = internalLinkBlockHtml(toInternalLinkChip(item), item.categoryLabel ?? '', { separator: !empty });

  editor
    .chain()
    .insertContentAt(empty ? { from: 0, to: doc.content.size } : doc.content.size, html)
    .focus()
    .run();

  // One frame later: the paragraph is then in the DOM and the chip's React
  // NodeView is rendered; `revealEntryLink` needs both to scroll
  // and set the highlight.
  requestAnimationFrame(() => {
    if (!editor.isDestroyed) revealEntryLink(editor, item, { caretAtBlockEnd: true });
  });
}

/** Does the paragraph carry only this one chip (plus whitespace)? */
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

/**
 * Removes a link from the entry. If it stood in a link block of its
 * own (divider, heading, paragraph with only this chip, as
 * `appendEntryLink` creates it), the whole block goes away. If it sits
 * in the middle of running text, only the chip disappears and the sentence stays.
 *
 * Returns `false` if the link is not in the content (for instance with a
 * link from the old columns).
 */
export function removeEntryLink(editor: Editor, target: EntryLinkRequest): boolean {
  const { doc } = editor.state;
  const pos = findEntryLinkPos(doc, target);
  if (pos === null) return false;

  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  // A link block is ONLY what `appendEntryLink` creates: a paragraph
  // directly in the document that carries nothing but this chip, with a divider
  // before it and at most one heading in between, or, as the very first
  // block of a previously empty entry, without a divider. Everything else (a chip
  // in a list, in a quote, under a self-typed heading)
  // is running text, and there only the chip is removed. Without these narrow
  // limits, deleting would take foreign blocks with it.
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
    } else if (
      // The first block in a previously empty entry: it begins with the
      // heading, with no divider before it. So that no self-typed
      // heading goes along here, its text must be exactly the target's category.
      prev?.type.name === 'heading' && index === 1 &&
      target.categoryLabel && prev.textContent === target.categoryLabel
    ) {
      from -= prev.nodeSize;
    } else {
      from = -1; // no opening divider, so not a block of ours
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
/** Must match the duration of `internal-link-reveal` in index.css. */
const REVEAL_MS = 1600;

/**
 * Jumps to the link chip in the content and briefly highlights it. Returns `false`
 * if the entry does not contain it, in which case the caller can choose to
 * navigate to the target instead.
 *
 * Scrolling and flashing are handled by `lib/reveal.ts`: only one chip is
 * highlighted at a time, and a second click on the same one flashes again.
 *
 * `caretAtBlockEnd` puts the cursor at the end of the paragraph the chip
 * sits in instead of selecting the chip itself, for a fresh insertion after which
 * you keep writing: with a node selection the first keystroke would replace the chip with
 * the typed text. When looking up an existing link the selection stays, since there
 * the statement is "this one is meant".
 */
export function revealEntryLink(
  editor: Editor,
  target: { id: string; entryType: string },
  { caretAtBlockEnd = false }: { caretAtBlockEnd?: boolean } = {},
): boolean {
  const pos = findEntryLinkPos(editor.state.doc, target);
  if (pos === null) return false;

  // In edit mode also select for real so that the cursor is there;
  // in read mode ProseMirror shows no selection, and there the class does the job.
  if (editor.isEditable) {
    const chain = editor.chain();
    // `internalLink` is an inline node, so its parent is always a
    // text block; `end()` is thus the end of the paragraph: after the chip and
    // after the space that `internalLinkBlockHtml` appends.
    if (caretAtBlockEnd) chain.setTextSelection(editor.state.doc.resolve(pos).end());
    else chain.setNodeSelection(pos);
    chain.focus().run();
  }

  const dom = editor.view.nodeDOM(pos);
  const el = dom instanceof HTMLElement
    ? (dom.querySelector<HTMLElement>('.internal-link-chip') ?? dom)
    : null;
  if (!el) return true;

  scrollIntoViewCentered(el);
  flashReveal(el, REVEAL_CLASS, REVEAL_MS);
  return true;
}

/** Image from the toolbar: first into the vault image folder, then as a node with the file name. */
export async function insertImageFromDataUrl(editor: Editor, dataUrl: string): Promise<void> {
  try {
    const src = await saveImage(await prepareImageDataUrl(dataUrl));
    editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
  } catch (e) {
    reportImageError(e, 'toolbar');
  }
}

/** Link chip from the link picker (toolbar button) at the cursor position. */
export function insertInternalLinkChip(editor: Editor, item: SuggestionItem): void {
  editor.chain().focus()
    .insertContent({ type: 'internalLink', attrs: toInternalLinkChip(item) })
    .insertContent(' ')
    .run();
}
