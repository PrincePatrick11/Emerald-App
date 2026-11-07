import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare, ChevronsDownUp, Globe, Heading1, Heading2, Heading3, ImagePlus, Link, List, ListOrdered, Minus, Quote, Redo,
  Search, Table, Undo, Unlink,
} from 'lucide-react';
import { editorHas } from './hostContext';
import { ALIGN_ACTIONS, applyAlign, canAlign, isAlignActive, markActionsOf } from './formatActions';
import {
  applyLinkHref, applyTextColor, currentTextColor, NEW_TABLE, pickImageFiles, removeLink, toggleDetails,
} from './editorCommands';
import LinkHrefForm from './LinkHrefForm';
import TextColorSwatches, { TextColorIcon } from './TextColorSwatches';
import PopoverButton from '../shared/PopoverButton';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from '../shared/toolbarParts';

/**
 * The formatting bar of a text editor. It shows only what the editor's schema
 * has, so an editor with fewer features (see `features.ts`) gets a shorter bar.
 * Marks and alignment come from `formatActions.ts`, shared with the selection menu.
 *
 * In the order of writing: undo, what a line is (headings), how text looks
 * (marks and colour), how it sits (alignment), the block shapes (lists,
 * checklist, quote, collapsible section), what is put in (links, image, table, divider), and
 * finding at the far end.
 */
export default function EditorToolbar({ editor, onOpenLinkPicker, findOpen, onToggleFind }: {
  editor: Editor;
  onOpenLinkPicker: () => void;
  findOpen: boolean;
  onToggleFind: () => void;
}) {
  const { t } = useTranslation();
  const has = (name: string) => editorHas(editor, name);
  const alignDisabled = !canAlign(editor);

  return (
    <div className="editor-toolbar">
      <ToolbarGroup>
        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          title={t('editor.toolbar.undo')}
          disabled={!editor.can().undo()}
        >
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          title={t('editor.toolbar.redo')}
          disabled={!editor.can().redo()}
        >
          <Redo size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      {has('heading') && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {([1, 2, 3] as const).map((level) => {
            const Icon = [Heading1, Heading2, Heading3][level - 1];
            return (
              <ToolbarBtn
                key={level}
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                active={editor.isActive('heading', { level })}
                title={t(`editor.toolbar.heading${level}`)}
              >
                <Icon size={14} />
              </ToolbarBtn>
            );
          })}
        </ToolbarGroup>
      </>)}

      <ToolbarDivider />
      <ToolbarGroup>
        {markActionsOf(editor).map(({ key, labelKey, icon: Icon, toggle }) => (
          <ToolbarBtn key={key} onClick={() => toggle(editor)} active={editor.isActive(key)} title={t(labelKey)}>
            <Icon size={14} />
          </ToolbarBtn>
        ))}
        {has('textColor') && <TextColorButton editor={editor} />}
      </ToolbarGroup>

      {has('textAlign') && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {ALIGN_ACTIONS.map(({ align, labelKey, icon: Icon }) => (
            <ToolbarBtn
              key={align}
              onClick={() => applyAlign(editor, align)}
              active={isAlignActive(editor, align)}
              disabled={alignDisabled}
              title={t(labelKey)}
            >
              <Icon size={14} />
            </ToolbarBtn>
          ))}
        </ToolbarGroup>
      </>)}

      {(has('bulletList') || has('taskList') || has('blockquote') || has('details')) && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {has('bulletList') && (<>
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive('bulletList')}
              title={t('editor.toolbar.bulletList')}
            >
              <List size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive('orderedList')}
              title={t('editor.toolbar.numberedList')}
            >
              <ListOrdered size={14} />
            </ToolbarBtn>
          </>)}
          {has('taskList') && (
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              active={editor.isActive('taskList')}
              title={t('editor.toolbar.taskList')}
            >
              <CheckSquare size={14} />
            </ToolbarBtn>
          )}
          {has('blockquote') && (
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              active={editor.isActive('blockquote')}
              title={t('editor.toolbar.blockquote')}
            >
              <Quote size={14} />
            </ToolbarBtn>
          )}
          {has('details') && (
            <ToolbarBtn
              onClick={() => toggleDetails(editor)}
              active={editor.isActive('details')}
              title={t('editor.details.insert')}
            >
              <ChevronsDownUp size={14} />
            </ToolbarBtn>
          )}
        </ToolbarGroup>
      </>)}

      {(has('internalLink') || has('link') || has('image') || has('table') || has('horizontalRule')) && (<>
      <ToolbarDivider />
      <ToolbarGroup>
        {has('internalLink') && (
          <ToolbarBtn onClick={onOpenLinkPicker} active={false} title={t('editor.toolbar.insertLink')}>
            <Link size={14} />
          </ToolbarBtn>
        )}
        {has('link') && <WebLinkButton editor={editor} />}
        {has('image') && (
          <ToolbarBtn onClick={() => pickImageFiles(editor)} active={false} title={t('editor.toolbar.insertImage')}>
            <ImagePlus size={14} />
          </ToolbarBtn>
        )}
        {has('table') && (
          <ToolbarBtn
            onClick={() => editor.chain().focus().insertTable(NEW_TABLE).run()}
            active={editor.isActive('table')}
            disabled={!editor.can().insertTable(NEW_TABLE)}
            title={t('editor.toolbar.insertTable')}
          >
            <Table size={14} />
          </ToolbarBtn>
        )}
        {has('horizontalRule') && (
          <ToolbarBtn
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            active={false}
            title={t('editor.toolbar.horizontalRule')}
          >
            <Minus size={14} />
          </ToolbarBtn>
        )}
      </ToolbarGroup>
      </>)}

      {has('textSearch') && (
        <div className="editor-toolbar-end">
          <ToolbarBtn onClick={onToggleFind} active={findOpen} title={t('editor.toolbar.find')}>
            <Search size={14} />
          </ToolbarBtn>
        </div>
      )}
    </div>
  );
}

/**
 * A web link from the bar: the address typed in a small form under the
 * button, for the selection, for the link at the cursor (to change it), or,
 * with nothing selected, as new text.
 */
function WebLinkButton({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const active = editor.isActive('link');
  return (
    <PopoverButton
      icon={<Globe size={14} />}
      title={t('editor.menu.webLink')}
      active={active}
      onDismiss={() => editor.commands.focus()}
    >
      {(close) => (<>
        <LinkHrefForm
          initial={active ? (editor.getAttributes('link').href as string) ?? '' : ''}
          onConfirm={(href) => { applyLinkHref(editor, href); close(); }}
          onCancel={() => { close(); editor.commands.focus(); }}
        />
        {active && (
          <ToolbarBtn
            onClick={() => { removeLink(editor); close(); }}
            active={false}
            title={t('editor.removeLink')}
          >
            <Unlink size={14} />
          </ToolbarBtn>
        )}
      </>)}
    </PopoverButton>
  );
}

/**
 * The text colour from the bar, for the selection or, with nothing selected,
 * for what is typed next. The icon takes the colour at the cursor.
 */
function TextColorButton({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const color = currentTextColor(editor);
  return (
    <PopoverButton
      icon={<TextColorIcon color={color} />}
      title={t('editor.menu.textColor')}
      active={!!color}
      onDismiss={() => editor.commands.focus()}
    >
      {(close) => (
        <TextColorSwatches
          current={color}
          onPick={(picked) => { applyTextColor(editor, picked); close(); }}
        />
      )}
    </PopoverButton>
  );
}
