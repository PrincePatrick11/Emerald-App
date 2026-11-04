import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare, Heading1, Heading2, Heading3, ImagePlus, Link, List, ListOrdered, Minus, Quote, Redo, Table, Undo,
} from 'lucide-react';
import { editorHas } from './hostContext';
import { ALIGN_ACTIONS, applyAlign, canAlign, isAlignActive, markActionsOf } from './formatActions';
import { NEW_TABLE, pickImageFiles } from './editorCommands';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from './toolbarParts';

/**
 * The formatting bar of a text editor. It shows only what the editor's schema
 * has, so an editor with fewer features (see `features.ts`) gets a shorter bar.
 * Marks and alignment come from `formatActions.ts`, shared with the selection menu.
 */
export default function EditorToolbar({ editor, onOpenLinkPicker }: {
  editor: Editor;
  onOpenLinkPicker: () => void;
}) {
  const { t } = useTranslation();
  const has = (name: string) => editorHas(editor, name);

  // The button picks an entry; on an external link it removes that link instead.
  const handleLinkButtonClick = () => {
    if (editor.isActive('link')) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else onOpenLinkPicker();
  };

  const alignDisabled = !canAlign(editor);

  return (
    <div className="editor-toolbar">
      <ToolbarGroup>
        {markActionsOf(editor).map(({ key, labelKey, icon: Icon, toggle }) => (
          <ToolbarBtn key={key} onClick={() => toggle(editor)} active={editor.isActive(key)} title={t(labelKey)}>
            <Icon size={14} />
          </ToolbarBtn>
        ))}
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
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
            title={t('editor.toolbar.blockquote')}
          >
            <Quote size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            active={false}
            title={t('editor.toolbar.horizontalRule')}
          >
            <Minus size={14} />
          </ToolbarBtn>
        </ToolbarGroup>
      </>)}

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

      {(has('bulletList') || has('taskList')) && (<>
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
        </ToolbarGroup>
      </>)}

      {(has('internalLink') || has('image') || has('table')) && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {has('internalLink') && (
            <ToolbarBtn onClick={handleLinkButtonClick} active={editor.isActive('link')} title={t('editor.toolbar.insertLink')}>
              <Link size={14} />
            </ToolbarBtn>
          )}
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
        </ToolbarGroup>
      </>)}

      <ToolbarDivider />
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
    </div>
  );
}
