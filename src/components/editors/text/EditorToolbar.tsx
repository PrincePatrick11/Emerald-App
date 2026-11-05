import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare, Globe, Heading1, Heading2, Heading3, ImagePlus, Link, List, ListOrdered, Minus, Quote, Redo, Search, Table,
  Undo, Unlink,
} from 'lucide-react';
import { editorHas } from './hostContext';
import { ALIGN_ACTIONS, applyAlign, canAlign, isAlignActive, markActionsOf } from './formatActions';
import { applyLinkHref, NEW_TABLE, pickImageFiles } from './editorCommands';
import LinkHrefForm from './LinkHrefForm';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from './toolbarParts';

/**
 * The formatting bar of a text editor. It shows only what the editor's schema
 * has, so an editor with fewer features (see `features.ts`) gets a shorter bar.
 * Marks and alignment come from `formatActions.ts`, shared with the selection menu.
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

      {(has('internalLink') || has('link') || has('image') || has('table')) && (<>
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
        </ToolbarGroup>
      </>)}

      <ToolbarDivider />
      <ToolbarGroup>
        {has('textSearch') && (
          <ToolbarBtn onClick={onToggleFind} active={findOpen} title={t('editor.toolbar.find')}>
            <Search size={14} />
          </ToolbarBtn>
        )}
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

/**
 * A web link from the bar: the address typed in a small form under the
 * button, for the selection, for the link at the cursor (to change it), or,
 * with nothing selected, as new text. A click elsewhere closes it.
 */
function WebLinkButton({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = editor.isActive('link');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <ToolbarBtn onClick={() => setOpen((v) => !v)} active={active || open} title={t('editor.menu.webLink')}>
        <Globe size={14} />
      </ToolbarBtn>
      {open && (
        <div className="editor-selection-menu editor-toolbar-popover">
          <LinkHrefForm
            initial={active ? (editor.getAttributes('link').href as string) ?? '' : ''}
            onConfirm={(href) => { applyLinkHref(editor, href); setOpen(false); }}
            onCancel={() => { setOpen(false); editor.commands.focus(); }}
          />
          {active && (
            <ToolbarBtn
              onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setOpen(false); }}
              active={false}
              title={t('editor.removeLink')}
            >
              <Unlink size={14} />
            </ToolbarBtn>
          )}
        </div>
      )}
    </div>
  );
}
