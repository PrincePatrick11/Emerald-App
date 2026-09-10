import { useContext } from 'react';
import RichEditor from '../editor/RichEditor';
import { BlockStackContext } from './blockStackContext';
import type { BlockViewProps } from './blockViews';

/** Der Textblock: ein TipTap-Editor für Lese- und Bearbeitungsmodus zugleich. */
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
