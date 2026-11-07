import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Which headings are folded: their positions, kept up to date through every change. */
interface FoldState {
  folded: number[];
  decorations: DecorationSet;
}

type FoldMeta = { toggle: number } | { reveal: number };

const foldKey = new PluginKey<FoldState>('headingFold');

/** A top-level heading and the top-level nodes that belong to it. */
interface Section {
  pos: number;
  /** From the end of the heading to the start of the next heading of the same or a higher level. */
  from: number;
  to: number;
}

/**
 * The sections of the document: each top-level heading with everything after
 * it up to the next heading whose level is the same or higher (a smaller
 * number). An H1 therefore takes its H2s along; an H2 stops at the next H2 or H1.
 */
function sections(doc: ProseMirrorNode): Section[] {
  const headings: { pos: number; end: number; level: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') headings.push({ pos: offset, end: offset + node.nodeSize, level: node.attrs.level as number });
  });
  return headings.map((h, i) => {
    const next = headings.slice(i + 1).find((other) => other.level <= h.level);
    return { pos: h.pos, from: h.end, to: next ? next.pos : doc.content.size };
  });
}

function foldToggle(pos: number, folded: boolean, label: string): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'editor-fold-toggle';
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('aria-label', label);
  button.dataset.foldPos = String(pos);
  return button;
}

function decorate(doc: ProseMirrorNode, all: Section[], folded: number[], labels: FoldLabels): DecorationSet {
  const decorations: Decoration[] = [];
  for (const section of all) {
    // A heading with nothing under it has nothing to fold.
    if (section.from >= section.to) continue;
    const isFolded = folded.includes(section.pos);
    decorations.push(Decoration.widget(section.pos + 1, () => foldToggle(section.pos, isFolded, isFolded ? labels.expand : labels.collapse), {
      side: -1,
      ignoreSelection: true,
      key: `fold-${section.pos}-${isFolded}`,
    }));
    if (!isFolded) continue;
    const heading = doc.nodeAt(section.pos);
    if (heading) decorations.push(Decoration.node(section.pos, section.pos + heading.nodeSize, { class: 'editor-heading--folded' }));
    doc.nodesBetween(section.from, section.to, (node, pos) => {
      if (pos >= section.from && pos + node.nodeSize <= section.to) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'editor-folded' }));
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** Unfold whatever hides `pos`, for instance a hit of the find bar. */
export function revealFolded(editor: Editor, pos: number): void {
  if (editor.isDestroyed || !foldKey.getState(editor.state)?.folded.length) return;
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, { reveal: pos } satisfies FoldMeta).setMeta('addToHistory', false));
}

interface FoldLabels {
  expand: string;
  collapse: string;
}

/**
 * Folding by headings: a chevron at a heading folds away its section (see
 * `sections`). Only decorations, the content stays untouched, so it works while
 * reading too; and it is not stored, every heading opens unfolded. A
 * selection that lands in a folded section (arrow keys, a jump) unfolds it.
 */
export function createHeadingFold(labels: () => FoldLabels) {
  return Extension.create({
    name: 'headingFold',

    addProseMirrorPlugins() {
      return [
        new Plugin<FoldState>({
          key: foldKey,
          state: {
            init: (_config, state) => ({ folded: [], decorations: decorate(state.doc, sections(state.doc), [], labels()) }),
            apply(tr, prev, _old, state) {
              const meta = tr.getMeta(foldKey) as FoldMeta | undefined;
              let folded = prev.folded
                .map((pos) => tr.mapping.mapResult(pos))
                .filter((r) => !r.deleted)
                .map((r) => r.pos)
                .filter((pos) => state.doc.nodeAt(pos)?.type.name === 'heading');
              if (meta && 'toggle' in meta) {
                folded = folded.includes(meta.toggle) ? folded.filter((p) => p !== meta.toggle) : [...folded, meta.toggle];
              }
              // Once per change, for unfolding and drawing alike; nothing to do while nothing is folded.
              const all = folded.length || tr.docChanged || meta ? sections(state.doc) : [];
              const hidden = (pos: number) => all.filter((s) => folded.includes(s.pos) && pos >= s.from && pos < s.to);
              const revealAt = meta && 'reveal' in meta ? meta.reveal : tr.selectionSet ? state.selection.from : null;
              if (revealAt !== null) {
                const hiding = hidden(revealAt).map((s) => s.pos);
                if (hiding.length) folded = folded.filter((p) => !hiding.includes(p));
              }
              const same = folded.length === prev.folded.length && folded.every((p, i) => p === prev.folded[i]);
              if (same && !tr.docChanged) return prev;
              return { folded, decorations: decorate(state.doc, all, folded, labels()) };
            },
          },
          props: {
            decorations: (state) => foldKey.getState(state)?.decorations,
            handleDOMEvents: {
              // On press, not click: the editor would otherwise move the caret first.
              mousedown: (view, event) => {
                const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.editor-fold-toggle');
                if (!target || !view.dom.contains(target)) return false;
                event.preventDefault();
                view.dispatch(view.state.tr.setMeta(foldKey, { toggle: Number(target.dataset.foldPos) } satisfies FoldMeta).setMeta('addToHistory', false));
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}
