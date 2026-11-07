import { useContext } from 'react';
import { TextEditor } from '../editors/text';
import { BlockStackContext } from './blockStackContext';
import type { BlockViewProps } from './blockViews';

/** The text block: a text editor for read and edit mode alike. */
export default function TextBlock({ block, isEditing, onHtmlChange }: BlockViewProps) {
  const stack = useContext(BlockStackContext);
  return (
    <TextEditor
      initialContent={block.html}
      placeholder={stack?.placeholderFor(block.id) ?? ''}
      onChange={onHtmlChange}
      editable={isEditing}
      hostKey={block.id}
    />
  );
}
