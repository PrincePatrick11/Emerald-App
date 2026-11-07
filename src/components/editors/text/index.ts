/**
 * The text editor, for embedding anywhere. A single `TextEditor` stands alone (no toolbar);
 * several shown together share one host (`useTextEditorHost`), which owns
 * toolbar, link picker and drops. See Documentation/architecture/editors.md.
 */
export { default as TextEditor } from './TextEditor';
export { useTextEditorHost } from './useTextEditorHost';
export { TextEditorHostContext, editorHas } from './hostContext';
export { FULL_TEXT_FEATURES, type TextFeatures } from './features';
export { default as LinkPickerModal } from './LinkPickerModal';
export { appendEntryLink, findEntryLinkPos, removeEntryLink, revealEntryLink } from './editorCommands';
