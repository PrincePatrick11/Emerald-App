import type { ReactNode } from 'react';
import BlockCheckbox from '../blocks/BlockCheckbox';

/**
 * The building blocks the export menu and the import window share: a titled
 * part, and a framed list to tick rows off.
 */

/** A titled part of the window, with an optional hint below it. */
export function Part({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="space-y-2">
      <p className="label-xs">{title}</p>
      {children}
      {hint && <p className="text-xs text-subtle leading-snug">{hint}</p>}
    </section>
  );
}

/** A framed list to tick rows off (Advanced). Unticked ones stay out. */
export function Checklist({ rows, excluded, onToggle }: {
  rows: readonly { id: string; label: string }[];
  excluded: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-edge max-h-44 overflow-y-auto px-3 py-2 space-y-1.5">
      {rows.map((row) => (
        <BlockCheckbox key={row.id} checked={!excluded.has(row.id)} onChange={() => onToggle(row.id)} label={row.label} />
      ))}
    </div>
  );
}
