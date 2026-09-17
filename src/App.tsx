import AppShell from './components/layout/AppShell';
import EditContextMenu from './components/ui/EditContextMenu';

export default function App() {
  // Theme und Schriften setzt der settingsStore selbst, sobald ein Vault
  // geladen ist (`applyAppearance`); vorher gilt der Boot-Spiegel aus `main.tsx`.
  //
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
