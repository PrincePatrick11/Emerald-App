import { useContext } from 'react';
import RichEditor from '../editor/RichEditor';
import { BlockStackContext } from './blockStackContext';
import type { BlockViewProps } from './blockViews';

/** The text block: a TipTap editor for read and edit mode alike. */
export default function TextBlock({ block, isEditing, onHtmlChange }: BlockViewProps) {
  const stack = useContext(BlockStackContext);
  return (
    <RichEditor
      initialContent={block.html}
      placeholder={stack?.placeholderFor(block.id) ?? ''}
      onChange={onHtmlChange}
      editable={isEditing}
      onEditorReady={(editor) => stack?.registerTextEditor(block.id, editor)}
    />
  );
}
