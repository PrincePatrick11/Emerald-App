/**
 * The field for renaming in place: Enter and leaving save,
 * Escape cancels. The content of a `DashboardItem` with `editing`; the
 * caller supplies the font so that the field looks like the title
 * it replaces.
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
