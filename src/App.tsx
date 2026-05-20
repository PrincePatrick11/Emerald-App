import { useEffect } from 'react';
import { useUIStore } from './store/uiStore';
import AppShell from './components/layout/AppShell';
import { applyTheme } from './themes/theme';

export default function App() {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <AppShell />;
}
