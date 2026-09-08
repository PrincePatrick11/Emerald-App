import { useEffect } from 'react';
import { useUIStore } from './store/uiStore';
import AppShell from './components/layout/AppShell';
import { applyEditorFont, applyTheme, applyUIFont } from './themes/theme';
import EditContextMenu from './components/ui/EditContextMenu';

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

  // Neben AppShell statt darin: AppShell steigt fuer den Vault-Einrichtungs-
  // Bildschirm frueh aus, und auch dort — im Namensfeld des neuen Vaults —
  // gehoert das Bearbeiten-Menue hin.
  return (
    <>
      <AppShell />
      <EditContextMenu />
    </>
  );
}
