import AppShell from './components/layout/AppShell';
import EditContextMenu from './components/ui/EditContextMenu';

export default function App() {
  // The settingsStore applies theme and fonts itself once a vault is loaded
  // (`applyAppearance`); until then the boot mirror from `main.tsx` applies.
  //
  // Next to AppShell rather than inside it: AppShell returns early for the
  // vault setup screen, and the edit menu belongs there too — in the name
  // field of the new vault.
  return (
    <>
      <AppShell />
      <EditContextMenu />
    </>
  );
}
