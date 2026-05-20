import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
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
          title="Bold"
        >
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          title="Highlight"
        >
          <Highlighter size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Inline code"
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
          title="Heading 1"
        >
          <Heading1 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          <Heading3 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive('taskList')}
          title="Task list"
        >
          <CheckSquare size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn onClick={handleLinkButtonClick} active={editor.isActive('link')} title="Link einfügen">
          <Link size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => fileInputRef.current?.click()} active={false} title="Bild einfügen">
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
          <button onClick={confirmExternalLink} className="p-1 text-jade-400 hover:text-jade-300" title="Link einfügen">
            <Check size={12} />
          </button>
          <button onClick={cancelLink} className="p-1 text-stone-500 hover:text-stone-300" title="Abbrechen">
            <X size={12} />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          title="Undo"
          disabled={!editor.can().undo()}
        >
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          title="Redo"
          disabled={!editor.can().redo()}
        >
          <Redo size={14} />
        </ToolbarBtn>
      </ToolbarGroup>
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
