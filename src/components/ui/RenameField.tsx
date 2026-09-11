/**
 * Das Feld fürs Umbenennen an Ort und Stelle: Enter und Verlassen speichern,
 * Escape bricht ab. Der Inhalt eines `DashboardItem` mit `editing` — die
 * Schrift bringt der Aufrufer mit, damit das Feld aussieht wie der Titel,
 * den es ersetzt.
 */
export default function RenameField({ value, onChange, onCommit, onCancel, className }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit();
        if (event.key === 'Escape') onCancel();
      }}
      className={className}
    />
  );
}
