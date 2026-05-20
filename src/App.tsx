import { useEffect } from 'react';
import { useUIStore } from './store/uiStore';
import AppShell from './components/layout/AppShell';
import { applyEditorFont, applyTheme, applyUIFont } from './themes/theme';

export default function App() {
  const theme = useUIStore((s) => s.theme);
  const uiFontId = useUIStore((s) => s.uiFontId);
  const editorFontId = useUIStore((s) => s.editorFontId);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyUIFont(uiFontId);
  }, [uiFontId]);

  useEffect(() => {
    applyEditorFont(editorFontId);
  }, [editorFontId]);

  return <AppShell />;
}
