import type { ReactNode } from 'react';

/**
 * One labelled row inside a block — label and value side by side, or (`wide`)
 * the label above a value that needs the full width (a text). Shared by the
 * fields block and the parts of other blocks that show values (a sigil's
 * charge), so every block lays out its rows alike (`.block-field`).
 */
export default function BlockFieldRow({ label, wide = false, children }: { label: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'block-field block-field--wide' : 'block-field'}>
      <div className="block-field-label">{label}</div>
      <div className="block-field-value">{children}</div>
    </div>
  );
}
