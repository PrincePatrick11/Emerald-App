import { useTranslation } from 'react-i18next';
import Dropdown from './Dropdown';
import { useTemplateStore } from '../../store/templateStore';
import { templateLabel } from '../../lib/blocks/blockAttrs';

/**
 * A template picker built on `Dropdown`, like `CategorySelect`: "none"
 * (`noneLabel`, `null`) and every active template. A template in the trash
 * or gone shows as none — the same rule `resolveStartTemplate` applies, so
 * the picker shows what a new entry would really start with.
 */
export default function TemplateSelect({ label, noneLabel, value, onChange, portal = false }: {
  label: string;
  noneLabel: string;
  value: string | null;
  onChange: (id: string | null) => void;
  portal?: boolean;
}) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const options = [
    { value: '', label: noneLabel },
    ...templates.map((tpl) => ({ value: tpl.id, label: templateLabel(t, tpl) })),
  ];
  const shown = value && templates.some((tpl) => tpl.id === value) ? value : '';
  return <Dropdown label={label} value={shown} options={options} onChange={(id) => onChange(id || null)} portal={portal} />;
}
