import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../lib/helpers';
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code,
  Highlighter,
  Undo,
  Redo,
  Link,
  ImagePlus,
  Check,
  X,
} from 'lucide-react';

interface Props {
  editor: Editor;
  onInsertImage: (src: string) => void;
  onOpenLinkPicker: () => void;
}

export default function EditorToolbar({ editor, onInsertImage, onOpenLinkPicker }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const handleLinkButtonClick = () => {
    if (editor.isActive('link')) {
      // If cursor is already on an external link, unset it
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    // Open the link picker modal for selecting internal links
    onOpenLinkPicker();
  };

  const confirmExternalLink = () => {
    const href = linkHref.trim();
    if (href) {
      const url = href.startsWith('http://') || href.startsWith('https://') ? href : `https://${href}`;
      editor.chain().focus().setLink({ href: url }).run();
    }
    setLinkInputOpen(false);
    setLinkHref('');
  };

  const cancelLink = () => {
    setLinkInputOpen(false);
    setLinkHref('');
    editor.chain().focus().run();
  };


  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      setImageError(t('common.unsupportedImageFormat'));
      window.setTimeout(() => setImageError(null), 2500);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onInsertImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-0.5 px-4 py-2 border-b border-stone-700/60 flex-wrap">
      <ToolbarGroup>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title={t('editor.toolbar.bold')}
        >
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title={t('editor.toolbar.italic')}
        >
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title={t('editor.toolbar.strikethrough')}
        >
          <Strikethrough size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          title={t('editor.toolbar.highlight')}
        >
          <Highlighter size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title={t('editor.toolbar.inlineCode')}
        >
          <Code size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          active={editor.isActive('heading', { level: 1 })}
          title={t('editor.toolbar.heading1')}
        >
          <Heading1 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive('heading', { level: 2 })}
          title={t('editor.toolbar.heading2')}
        >
          <Heading2 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive('heading', { level: 3 })}
          title={t('editor.toolbar.heading3')}
        >
          <Heading3 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title={t('editor.toolbar.blockquote')}
        >
          <Quote size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
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
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive('taskList')}
          title={t('editor.toolbar.taskList')}
        >
          <CheckSquare size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn onClick={handleLinkButtonClick} active={editor.isActive('link')} title={t('editor.toolbar.insertLink')}>
          <Link size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => fileInputRef.current?.click()} active={false} title={t('editor.toolbar.insertImage')}>
          <ImagePlus size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Inline external-link input — appears via link popup's edit button */}
      {linkInputOpen && (
        <div className="flex items-center gap-1 ml-1">
          <input
            ref={linkInputRef}
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmExternalLink();
              if (e.key === 'Escape') cancelLink();
            }}
            placeholder="https://..."
            className="bg-stone-900 border border-stone-600 rounded px-2 py-0.5 text-xs text-stone-200 w-52 outline-none focus:border-jade-600"
          />
          <button onClick={confirmExternalLink} className="p-1 text-jade-400 hover:text-jade-300" title={t('editor.toolbar.insertLink')}>
            <Check size={12} />
          </button>
          <button onClick={cancelLink} className="p-1 text-stone-500 hover:text-stone-300" title={t('editor.cancel')}>
            <X size={12} />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        className="hidden"
        onChange={handleImageFile}
      />

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

      {imageError && (
        <span className="ml-auto text-[10px] text-red-400">{imageError}</span>
      )}
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="w-px h-4 bg-stone-700/60 mx-1" />;
}

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`editor-toolbar-btn p-1.5 rounded-md transition-colors duration-100 ${
        active
          ? 'editor-toolbar-btn-active bg-stone-700 text-stone-100'
          : disabled
          ? 'editor-toolbar-btn-disabled text-stone-700 cursor-not-allowed'
          : 'editor-toolbar-btn-idle text-stone-500 hover:text-stone-300 hover:bg-stone-700/60'
      }`}
    >
      {children}
    </button>
  );
}
