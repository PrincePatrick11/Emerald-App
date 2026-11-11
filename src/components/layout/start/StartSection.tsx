import type { ReactNode, Ref } from 'react';

/**
 * A section of the start page's sheet, headed as Home heads its sections: a
 * small uppercase label with its icon, what acts on the section to the right
 * (`aside`). The content sits on the sheet itself, not in a box of its own.
 */
export default function StartSection({ id, icon, label, aside, headingRef, children }: {
  id: string;
  icon: ReactNode;
  label: string;
  aside?: ReactNode;
  /** For a part that puts the focus on the heading. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <section className="start-section" aria-labelledby={id}>
      <div className="start-section-head">
        <h2 id={id} ref={headingRef} tabIndex={-1} className="start-section-label">
          {icon}
          {label}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
