import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useTranslation } from 'react-i18next';
import {
  BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Globe, Grid2x2X,
  PanelTop, Palette, TableColumnsSplit, TableRowsSplit, Trash2, Unlink, X,
} from 'lucide-react';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from './toolbarParts';
import { editorHas } from './hostContext';
import { ALIGN_ACTIONS, applyAlign, markActionsOf } from './formatActions';
import { applyLinkHref } from './editorCommands';
import LinkHrefForm from './LinkHrefForm';
import { TEXT_COLORS, type TextColor } from '../../../lib/textColors';

/**
 * The widths the image menu offers, in percent of the editor's width. Stored
 * like a resize: in pixels at the width of the moment, full width as `100%`.
 */
const IMAGE_WIDTHS = [25, 50, 100] as const;

function presetWidth(editor: Editor, percent: number): string {
  if (percent === 100) return '100%';
  return `${Math.round((editor.view.dom.getBoundingClientRect().width * percent) / 100)}px`;
}

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
  const marks = markActionsOf(editor);
  // The editor does not re-render its component per transaction; the menu
  // subscribes to exactly what its buttons show.
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      active: Object.fromEntries(marks.map(({ key }) => [key, ed.isActive(key)])) as Record<string, boolean>,
      link: ed.isActive('link'),
      color: (ed.getAttributes('textColor').color as TextColor | undefined) ?? null,
    }),
  });
  // Typing a web address replaces the buttons until confirmed or cancelled.
  const [typingLink, setTypingLink] = useState(false);
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


  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textSelectionMenu"
      shouldShow={({ editor: ed, state: s }) =>
        ed.isEditable && !s.selection.empty && !(s.selection instanceof NodeSelection)
        && !(s.selection instanceof CellSelection) && !ed.isActive('codeBlock')}
      options={{ placement: 'top', offset: 8 }}
      className="editor-selection-menu"
      onMouseDown={(e) => { if (!typingLink) e.preventDefault(); }}
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
      ) : typingLink ? (
        <LinkHrefForm
          initial=""
          onConfirm={(href) => { applyLinkHref(editor, href); setTypingLink(false); }}
          onCancel={() => { setTypingLink(false); editor.commands.focus(); }}
        />
      ) : (
        <>
          <ToolbarGroup>
            {marks.map(({ key, labelKey, icon: Icon, toggle }) => (
              <ToolbarBtn key={key} onClick={() => toggle(editor)} active={!!state?.active[key]} title={t(labelKey)}>
                <Icon size={14} />
              </ToolbarBtn>
            ))}
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
                <ToolbarBtn onClick={() => setTypingLink(true)} active={false} title={t('editor.menu.webLink')}>
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
      return { align: attrs.align as string | undefined, width: attrs.width as string | undefined };
    },
  });

  const setWidth = (percent: number) => editor.chain().focus().updateAttributes('image', { width: presetWidth(editor, percent) }).run();
  // A preset counts as set while the stored width matches it at the current width, to the pixel.
  const isWidth = (percent: number) => {
    const preset = presetWidth(editor, percent);
    if (!state?.width || !preset.endsWith('px') || !state.width.endsWith('px')) return state?.width === preset;
    return Math.abs(parseFloat(state.width) - parseFloat(preset)) <= 1;
  };

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
        {ALIGN_ACTIONS.map(({ align, labelKey, icon: Icon }) => (
          <ToolbarBtn key={align} onClick={() => applyAlign(editor, align)} active={state?.align === align} title={t(labelKey)}>
            <Icon size={14} />
          </ToolbarBtn>
        ))}
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        {IMAGE_WIDTHS.map((w) => (
          <ToolbarBtn key={w} onClick={() => setWidth(w)} active={isWidth(w)} title={t('editor.menu.width', { value: w })}>
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
