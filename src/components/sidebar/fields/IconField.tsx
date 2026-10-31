import { useTranslation } from 'react-i18next';
import Favicon from './Favicon';

/**
 * The icon field of a language's page: the heading "Icon" above
 * `Favicon`, and a Remove that falls back to the module's default icon
 * instead of to nothing, since a language always carries one. Custom
 * blocks and templates show their icon as `MediaPropertyRow`.
 */
export default function IconField({ value, onChange, fallback }: {
  value: string;
  onChange: (icon: string) => void;
  /** The icon that "Remove" resets to. */
  fallback: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="label-xs mb-2">{t('properties.icon')}</p>
      <Favicon value={value} onChange={onChange} onRemove={() => onChange(fallback)} />
    </div>
  );
}
