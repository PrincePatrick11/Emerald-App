import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { saveImage } from '../../lib/images';
import { internalLinkBlockHtml, toInternalLinkChip } from '../../lib/internalLinkHtml';
import type { EntryLinkRequest } from '../../lib/links';
import type { SuggestionItem } from './SuggestionList';

/**
 * Befehle, die von außen in einen Editor schreiben: die Link-Bitten der
 * Seitenleiste (anhängen, entfernen, anspringen), ein Bild einfügen, einen
 * Link-Chip aus der Linkauswahl einsetzen. Sie lagen früher als private
 * Funktionen im RichEditor. Seit ein Eintrag mehrere Textblöcke haben kann,
 * entscheidet der `BlockStack`, WELCHER Editor eine Bitte bekommt, und ruft sie
 * von dort auf.
 */

/** Position des ERSTEN Link-Chips für `id`/`entryType` im Dokument, oder `null`.
 *  Ein zweifach verlinktes Ziel wird also immer an seiner ersten Stelle
 *  gefunden — für „ist das schon verlinkt?" und „zeig mir die Stelle" reicht
 *  das, ein zweiter Treffer bräuchte erst eine Bedienung dafür. */
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
 * Hängt einen internen Link ganz unten an den Eintrag an, jedes Mal als
 * vollständiger Block: Trennlinie, Kategorie des Ziels als Überschrift, dann
 * der Link. Bewusst ohne Zusammenfassen — zwei Links derselben Kategorie
 * bekommen zwei Blöcke.
 *
 * Wie der Block aussieht, sagt `internalLinkBlockHtml` — eine Definition für
 * das Einfügen hier und für die Migrationen v36/v37, die dieselben Blöcke ohne
 * Editor schreiben müssen.
 *
 * Ist der Eintrag noch leer, entfällt die Trennlinie und der leere Absatz wird
 * ersetzt: die Linie trennt den Text von den Links, und Text gibt es dann noch
 * keinen.
 *
 * Ein bereits verlinktes Ziel wird nicht ein zweites Mal angehängt. Danach
 * springt die Ansicht zum neuen Link und hebt ihn kurz hervor — dieselbe
 * Bewegung wie beim Klick auf einen Chip im Verlinkungs-Feld. Das Feld in der
 * Seitenleiste verliert dabei den Fokus, was gewollt ist: man sieht, wo der
 * Link gelandet ist, statt blind weiterzuklicken.
 *
 * Der Cursor landet dabei am Ende des Link-Absatzes statt auf dem Chip —
 * warum, steht bei `caretAtBlockEnd` an `revealEntryLink`.
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

  // Einen Frame später: der Absatz steht dann im DOM, und die React-NodeView
  // des Chips ist gerendert — `revealEntryLink` braucht beides, um zu scrollen
  // und die Markierung zu setzen.
  requestAnimationFrame(() => {
    if (!editor.isDestroyed) revealEntryLink(editor, item, { caretAtBlockEnd: true });
  });
}

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

/**
 * Entfernt einen Link aus dem Eintrag. Stand er in einem eigenen
 * Verlinkungs-Block — Trennlinie, Überschrift, Absatz nur mit diesem Chip, so
 * wie `appendEntryLink` ihn anlegt —, fällt der ganze Block weg. Steht er
 * mitten im Fließtext, verschwindet nur der Chip und der Satz bleibt stehen.
 *
 * Gibt `false` zurück, wenn der Link nicht im Inhalt steht (etwa bei einer
 * Verknüpfung aus den alten Spalten).
 */
export function removeEntryLink(editor: Editor, target: EntryLinkRequest): boolean {
  const { doc } = editor.state;
  const pos = findEntryLinkPos(doc, target);
  if (pos === null) return false;

  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  // Ein Verlinkungs-Block ist NUR, was `appendEntryLink` anlegt: ein Absatz
  // direkt im Dokument, der nichts als diesen Chip trägt, mit einer Trennlinie
  // davor und höchstens einer Überschrift dazwischen — oder, als allererster
  // Block eines zuvor leeren Eintrags, ohne Trennlinie. Alles andere — ein Chip
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
    } else if (
      // Der erste Block in einem zuvor leeren Eintrag: er beginnt mit der
      // Überschrift, ohne Trennlinie davor. Damit hier keine selbst getippte
      // Überschrift mitgeht, muss ihr Text genau die Kategorie des Ziels sein.
      prev?.type.name === 'heading' && index === 1 &&
      target.categoryLabel && prev.textContent === target.categoryLabel
    ) {
      from -= prev.nodeSize;
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
 *
 * `caretAtBlockEnd` setzt den Cursor ans Ende des Absatzes, in dem der Chip
 * steht, statt den Chip selbst auszuwählen — für das frische Einfügen, nach dem
 * man weiterschreibt: eine Knotenauswahl würde der erste Tastendruck durch das
 * Getippte ersetzen. Beim Nachschlagen eines vorhandenen Links bleibt sie, dort
 * ist „das hier ist gemeint" die Aussage.
 */
export function revealEntryLink(
  editor: Editor,
  target: { id: string; entryType: string },
  { caretAtBlockEnd = false }: { caretAtBlockEnd?: boolean } = {},
): boolean {
  const pos = findEntryLinkPos(editor.state.doc, target);
  if (pos === null) return false;

  // Im Edit-Modus zusätzlich echt selektieren, damit der Cursor dort steht;
  // im Lesemodus zeigt ProseMirror keine Selektion, dort trägt die Klasse.
  if (editor.isEditable) {
    const chain = editor.chain();
    // `internalLink` ist ein Inline-Knoten, sein Elternteil also immer ein
    // Textblock — `end()` ist damit das Ende des Absatzes: hinter dem Chip und
    // hinter dem Leerzeichen, das `internalLinkBlockHtml` anhängt.
    if (caretAtBlockEnd) chain.setTextSelection(editor.state.doc.resolve(pos).end());
    else chain.setNodeSelection(pos);
    chain.focus().run();
  }

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

/** Bild aus der Toolbar: erst in den Vault-Bildordner, dann als Knoten mit dem Dateinamen. */
export async function insertImageFromDataUrl(editor: Editor, dataUrl: string): Promise<void> {
  try {
    const src = await saveImage(dataUrl);
    editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
  } catch (e) {
    console.error('Failed to save image:', e);
  }
}

/** Link-Chip aus der Linkauswahl (Toolbar-Knopf, Strg/Cmd+K) an der Cursorstelle. */
export function insertInternalLinkChip(editor: Editor, item: SuggestionItem): void {
  editor.chain().focus()
    .insertContent({ type: 'internalLink', attrs: toInternalLinkChip(item) })
    .insertContent(' ')
    .run();
}
