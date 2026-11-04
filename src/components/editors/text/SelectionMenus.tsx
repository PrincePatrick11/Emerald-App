import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter, AlignLeft, AlignRight, BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd,
  BetweenVerticalStart, Bold, Check, Code, Globe, Grid2x2X, Highlighter, Italic, PanelTop, Strikethrough,
  Palette, TableColumnsSplit, TableRowsSplit, Trash2, Unlink, X,
} from 'lucide-react';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from './EditorToolbar';
import { editorHas } from './hostContext';
import type { Alignment } from './ResizableImageExtension';
import { TEXT_COLORS, type TextColor } from './TextColorExtension';

/** The widths the image menu offers, in percent of the editor's width. */
const IMAGE_WIDTHS = [25, 50, 100] as const;

/**
 * The small menus at a selection, beside the toolbar: one over selected text
 * (marks and a web link), one over a selected image (alignment, width,
 * removing), one over a table the cursor is in (rows, columns, header).
 * Each shows only what the editor's schema has, like the toolbar, and only
 * while editing.
 */
export default function SelectionMenus({ editor }: { editor: Editor }) {
  return (
    <>
      <TextMenu editor={editor} />
      {editorHas(editor, 'image') && <ImageMenu editor={editor} />}
      {editorHas(editor, 'table') && <TableMenu editor={editor} />}
    </>
  );
}

/** The table element around the selection, for anchoring its menu. */
function selectedTable(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'table') continue;
    const dom = editor.view.nodeDOM($from.before(depth));
    if (!(dom instanceof HTMLElement)) return null;
    return dom.querySelector('table') ?? dom;
  }
  return null;
}

function TableMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    command(editor.chain().focus()).run();
  const actions = [
    { key: 'addRowBefore', icon: BetweenHorizontalStart, run: () => run((c) => c.addRowBefore()) },
    { key: 'addRowAfter', icon: BetweenHorizontalEnd, run: () => run((c) => c.addRowAfter()) },
    { key: 'deleteRow', icon: TableRowsSplit, run: () => run((c) => c.deleteRow()) },
    null,
    { key: 'addColumnBefore', icon: BetweenVerticalStart, run: () => run((c) => c.addColumnBefore()) },
    { key: 'addColumnAfter', icon: BetweenVerticalEnd, run: () => run((c) => c.addColumnAfter()) },
    { key: 'deleteColumn', icon: TableColumnsSplit, run: () => run((c) => c.deleteColumn()) },
    null,
    { key: 'toggleHeaderRow', icon: PanelTop, run: () => run((c) => c.toggleHeaderRow()) },
    { key: 'deleteTable', icon: Grid2x2X, run: () => run((c) => c.deleteTable()) },
  ];
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      // A selected text in a cell gets its own menu above the text.
      shouldShow={({ editor: ed, state: s }) =>
        ed.isEditable && ed.isActive('table') && (s.selection.empty || s.selection instanceof CellSelection)}
      getReferencedVirtualElement={() => {
        const table = selectedTable(editor);
        return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
      }}
      options={{ placement: 'top-start', offset: 6 }}
      className="editor-selection-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      {actions.map((action, i) => action
        ? (
          <ToolbarBtn key={action.key} onClick={action.run} active={false} title={t(`editor.table.${action.key}`)}>
            <action.icon size={14} />
          </ToolbarBtn>
        )
        : <ToolbarDivider key={`divider-${i}`} />)}
    </BubbleMenu>
  );
}

function TextMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const has = (name: string) => editorHas(editor, name);
  // The editor does not re-render its component per transaction; the menu
  // subscribes to exactly what its buttons show.
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      strike: ed.isActive('strike'),
      highlight: ed.isActive('highlight'),
      code: ed.isActive('code'),
      link: ed.isActive('link'),
      color: (ed.getAttributes('textColor').color as TextColor | undefined) ?? null,
    }),
  });
  // Typing a web address replaces the buttons until confirmed or cancelled.
  const [href, setHref] = useState<string | null>(null);
  // Choosing a colour replaces them too, until one is picked.
  const [choosingColor, setChoosingColor] = useState(false);
  // Another selection starts with the buttons again.
  useEffect(() => {
    const reset = () => setChoosingColor(false);
    editor.on('selectionUpdate', reset);
    return () => { editor.off('selectionUpdate', reset); };
  }, [editor]);

  const pickColor = (color: TextColor | null) => {
    editor.chain().focus().setTextColor(color).run();
    setChoosingColor(false);
  };

  const confirmLink = () => {
    const value = href?.trim();
    if (value) editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    setHref(null);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textSelectionMenu"
      shouldShow={({ editor: ed, state: s }) =>
        ed.isEditable && !s.selection.empty && !(s.selection instanceof NodeSelection)
        && !(s.selection instanceof CellSelection) && !ed.isActive('codeBlock')}
      options={{ placement: 'top', offset: 8 }}
      className="editor-selection-menu"
      onMouseDown={(e) => { if (href === null) e.preventDefault(); }}
    >
      {choosingColor ? (
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            className={`editor-color-swatch editor-color-swatch--none${state?.color === null ? ' editor-color-swatch--active' : ''}`}
            title={t('editor.menu.defaultColor')}
            onClick={() => pickColor(null)}
          />
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`editor-color-swatch${state?.color === color ? ' editor-color-swatch--active' : ''}`}
              style={{ background: `var(--editor-color-${color})` }}
              title={t(`editor.colors.${color}`)}
              onClick={() => pickColor(color)}
            />
          ))}
          <ToolbarBtn onClick={() => setChoosingColor(false)} active={false} title={t('editor.cancel')}><X size={14} /></ToolbarBtn>
        </div>
      ) : href !== null ? (
        <div className="flex items-center gap-1 px-1">
          <input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirmLink(); }
              if (e.key === 'Escape') { e.preventDefault(); setHref(null); editor.commands.focus(); }
            }}
            className="bg-well-page border border-edge-strong rounded-md px-2 py-0.5 text-xs text-secondary w-56 outline-none focus:border-accent-edge"
            placeholder="https://"
          />
          <ToolbarBtn onClick={confirmLink} active={false} title={t('editor.confirm')}><Check size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => { setHref(null); editor.commands.focus(); }} active={false} title={t('editor.cancel')}>
            <X size={14} />
          </ToolbarBtn>
        </div>
      ) : (
        <>
          <ToolbarGroup>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={!!state?.bold} title={t('editor.toolbar.bold')}>
              <Bold size={14} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={!!state?.italic} title={t('editor.toolbar.italic')}>
              <Italic size={14} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={!!state?.strike} title={t('editor.toolbar.strikethrough')}>
              <Strikethrough size={14} />
            </ToolbarBtn>
            {has('highlight') && (
              <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={!!state?.highlight} title={t('editor.toolbar.highlight')}>
                <Highlighter size={14} />
              </ToolbarBtn>
            )}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={!!state?.code} title={t('editor.toolbar.inlineCode')}>
              <Code size={14} />
            </ToolbarBtn>
            {has('textColor') && (
              <ToolbarBtn onClick={() => setChoosingColor(true)} active={!!state?.color} title={t('editor.menu.textColor')}>
                <Palette size={14} style={state?.color ? { color: `var(--editor-color-${state.color})` } : undefined} />
              </ToolbarBtn>
            )}
          </ToolbarGroup>
          {has('link') && (
            <>
              <ToolbarDivider />
              {state?.link ? (
                <ToolbarBtn onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()} active title={t('editor.removeLink')}>
                  <Unlink size={14} />
                </ToolbarBtn>
              ) : (
                <ToolbarBtn onClick={() => setHref('')} active={false} title={t('editor.menu.webLink')}>
                  <Globe size={14} />
                </ToolbarBtn>
              )}
            </>
          )}
        </>
      )}
    </BubbleMenu>
  );
}

function ImageMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const attrs = ed.getAttributes('image');
      return { align: attrs.align as Alignment | undefined, width: attrs.width as string | undefined };
    },
  });

  const setAlign = (align: Alignment) => editor.chain().focus().setImageAlign(align).run();
  const setWidth = (percent: number) => editor.chain().focus().updateAttributes('image', { width: `${percent}%` }).run();

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="imageSelectionMenu"
      shouldShow={({ editor: ed, state: s }) =>
        ed.isEditable && s.selection instanceof NodeSelection && s.selection.node.type.name === 'image'}
      // At the picture itself: the node's own element spans the editor's
      // width, whatever the image's width and alignment.
      getReferencedVirtualElement={() => {
        const dom = editor.view.nodeDOM(editor.state.selection.from);
        const img = dom instanceof HTMLElement ? dom.querySelector('img') : null;
        return img ? { getBoundingClientRect: () => img.getBoundingClientRect() } : null;
      }}
      options={{ placement: 'top', offset: 8 }}
      className="editor-selection-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarGroup>
        <ToolbarBtn onClick={() => setAlign('left')} active={state?.align === 'left'} title={t('editor.toolbar.alignLeft')}>
          <AlignLeft size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => setAlign('center')} active={state?.align === 'center'} title={t('editor.toolbar.alignCenter')}>
          <AlignCenter size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => setAlign('right')} active={state?.align === 'right'} title={t('editor.toolbar.alignRight')}>
          <AlignRight size={14} />
        </ToolbarBtn>
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        {IMAGE_WIDTHS.map((w) => (
          <ToolbarBtn key={w} onClick={() => setWidth(w)} active={state?.width === `${w}%`} title={t('editor.menu.width', { value: w })}>
            <span className="text-[11px] tabular-nums px-0.5">{w}%</span>
          </ToolbarBtn>
        ))}
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarBtn onClick={() => editor.chain().focus().deleteSelection().run()} active={false} title={t('editor.menu.removeImage')}>
        <Trash2 size={14} />
      </ToolbarBtn>
    </BubbleMenu>
  );
}
