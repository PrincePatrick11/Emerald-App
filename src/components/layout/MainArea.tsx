import { Suspense } from 'react';
import { useUIStore } from '../../store/uiStore';
import { VIEW_COMPONENTS } from './moduleViews';

export default function MainArea() {
  const activeView = useUIStore((s) => s.activeView);
  // Fall back to "All entries" instead of crashing, should an unknown type ever slip through —
  // normalizeSavedTab filters persisted tabs, but this is the last line of defence.
  const View = VIEW_COMPONENTS[activeView.type] ?? VIEW_COMPONENTS.dashboard;

  // Fallback null: the chunks are local and load in single-digit
  // milliseconds — a spinner would only flicker.
  return <Suspense fallback={null}><View /></Suspense>;
}
