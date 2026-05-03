import { useEffect } from 'react';
import { useUIStore } from './store/uiStore';
import AppShell from './components/layout/AppShell';

export default function App() {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  return <AppShell />;
}
