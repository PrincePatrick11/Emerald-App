import { Suspense } from 'react';
import { useUIStore } from '../../store/uiStore';
import { VIEW_COMPONENTS } from './moduleViews';

export default function MainArea() {
  const activeView = useUIStore((s) => s.activeView);
  // Fallback Home statt Absturz, falls je ein unbekannter Typ durchrutscht —
  // normalizeSavedTab filtert persistierte Tabs, aber das hier ist die letzte Instanz.
  const View = VIEW_COMPONENTS[activeView.type] ?? VIEW_COMPONENTS.home;

  // Fallback null: die Chunks sind lokal und laden in einstelligen
  // Millisekunden — ein Spinner wuerde nur flackern.
  return <Suspense fallback={null}><View /></Suspense>;
}
