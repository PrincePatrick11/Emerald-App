import type { ReactNode } from 'react';
import { AlertTriangle, Check, CloudOff } from 'lucide-react';

/**
 * The heading of a settings section. It used to be written out in every
 * section separately — five times the same class chain, each time with an icon
 * size that is not a step on the app's scale. `.label-xs` carries the
 * font rules that the sidebars use too.
 *
 * `description` says in one sentence what the setting does.
 */
export default function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className={`label-xs flex items-center gap-2 ${description ? 'mb-1' : 'mb-3'}`}>
        {icon}
        {title}
      </div>
      {description && <SettingsDescription className="mb-3">{description}</SettingsDescription>}
      {children}
    </section>
  );
}

/**
 * The feedback for an action: a symbol and a sentence. It used to be written
 * out on every page of the window separately — ten times the same chain, sometimes with
 * `items-center gap-1`, sometimes with `items-start gap-1.5`.
 *
 * `success` green, `error` red, `muted` quiet: an outcome that is not a defect
 * (nobody answered, there is nothing to do). Each tone brings its own
 * symbol; `icon` overrides it where an error corresponds to a calm situation.
 */
export function SettingsStatus({ tone, icon, children, className }: {
  tone: 'success' | 'error' | 'muted';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-xs flex items-start gap-1.5 ${STATUS_TONE_CLASS[tone]}${className ? ` ${className}` : ''}`}>
      <span className="shrink-0 mt-0.5">{icon ?? STATUS_ICON[tone]}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

const STATUS_TONE_CLASS = {
  success: 'text-accent',
  error: 'text-danger',
  muted: 'text-muted',
} as const;

const STATUS_ICON = {
  success: <Check size={12} />,
  error: <AlertTriangle size={12} />,
  muted: <CloudOff size={12} />,
} as const;

/**
 * A packing list: the heading and below it checkboxes in two columns — what
 * comes along, not which setting applies. The caller brings the checkboxes.
 */
export function SettingsCheckboxGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="label-xs mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>
    </div>
  );
}

/** The explanatory sentence under a setting — under a section or a row within it. */
export function SettingsDescription({ children, className = 'mb-2' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      {children}
    </p>
  );
}
