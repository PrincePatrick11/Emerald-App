import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';
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
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import type { Alignment } from './ResizableImageExtension';

/**
 * The node types for which `TextAlign` is configured in `RichEditor`. Listed
 * here so that the toolbar can disable the buttons where alignment
 * would have no effect, in a code block for instance.
 */
export const TEXT_ALIGN_TYPES = ['heading', 'paragraph'] as const;

/** Everything except left: only these values appear as an attribute in the document. */
const EXPLICIT_ALIGNMENTS = ['center', 'right', 'justify'] as const;

interface Props {
  editor: Editor;
  onInsertImage: (src: string) => void;
  onOpenLinkPicker: () => void;
}

export default function EditorToolbar({ editor, onInsertImage, onOpenLinkPicker }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleLinkButtonClick = () => {
    if (editor.isActive('link')) {
      // If cursor is already on an external link, unset it
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    // Open the link picker modal for selecting internal links
    onOpenLinkPicker();
  };

  // The same three buttons serve two targets: a selected image is a
  // block node of its own with its own width, which the paragraph's `text-align` does
  // not reach. How the two sides store left alignment is described at `alignMargins`.
  const imageSelected = editor.isActive('image');
  const textAlignable = TEXT_ALIGN_TYPES.some((type) => editor.isActive(type));
  const alignDisabled = !imageSelected && !textAlignable;

  const applyAlign = (align: Alignment) => {
    if (imageSelected) {
      editor.chain().focus().setImageAlign(align).run();
      return;
    }
    if (align === 'left') {
      editor.chain().focus().unsetTextAlign().run();
      return;
    }
    editor.chain().focus().setTextAlign(align).run();
  };

  const isAlignActive = (align: Alignment) => {
    if (imageSelected) return editor.getAttributes('image').align === align;
    if (alignDisabled) return false;
    // A paragraph without the attribute is left-aligned, and older content may
    // carry an explicit `left`. Both must light up the button.
    if (align === 'left') {
      return !EXPLICIT_ALIGNMENTS.some((a) => editor.isActive({ textAlign: a }));
    }
    return editor.isActive({ textAlign: align });
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      setImageError(t('common.unsupportedImageFormat'));
      window.setTimeout(() => setImageError(null), 2500);
      return;
    }
    try {
      onInsertImage(await readFileAsDataUrl(file));
    } catch (err) {
      console.error('Failed to read image:', err);
    }
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
        <ToolbarBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          active={false}
          title={t('editor.toolbar.horizontalRule')}
        >
          <Minus size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarBtn
          onClick={() => applyAlign('left')}
          active={isAlignActive('left')}
          disabled={alignDisabled}
          title={t('editor.toolbar.alignLeft')}
        >
          <AlignLeft size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => applyAlign('center')}
          active={isAlignActive('center')}
          disabled={alignDisabled}
          title={t('editor.toolbar.alignCenter')}
        >
          <AlignCenter size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => applyAlign('right')}
          active={isAlignActive('right')}
          disabled={alignDisabled}
          title={t('editor.toolbar.alignRight')}
        >
          <AlignRight size={14} />
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

// The narrow margin is deliberate: the bar wraps when the editor area
// gets tight, and every pixel saved pushes that wrap further out.
function ToolbarDivider() {
  return <div className="w-px h-4 bg-stone-700/60 mx-0.5" />;
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
  // `p-1` instead of the otherwise usual 26px: the bar now carries 18
  // buttons and would otherwise already wrap with the right column open.
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`editor-toolbar-btn p-1 rounded-md transition-colors duration-100 ${
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
