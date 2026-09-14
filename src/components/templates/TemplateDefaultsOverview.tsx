import { useTranslation } from 'react-i18next';
import { GroupDivider } from '../ui/Dashboard';
import FieldDropdown from '../ui/FieldDropdown';
import type { DropdownOption } from '../ui/Dropdown';
import { useCategoryStore } from '../../store/categoryStore';
import { useTemplateStore } from '../../store/templateStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { isImageIcon } from '../../lib/helpers';
import {
  ALL_CATEGORIES, assignmentKey, defaultTemplateAt, TEMPLATE_ENTRY_TYPES, type TemplateEntryType,
} from '../../lib/blocks/templates';

/** Der Abschnitt als Ganzes ist eine Einstellung — wie die Altar-Bibliothek. */
const COLLAPSED_KEY = 'templates-defaults-collapsed';

/** Menüwert „kein Standard" — `null` ist kein Dropdown-Wert. */
const NONE = '__none__';

/**
 * Die Gesamtübersicht unter der Vorlagenliste: je Eintragsart die
 * Kombinationen — Journal einmal, Wiki und Operationen mit „Alle Kategorien",
 * „Ohne Kategorie" und jeder Kategorie — und welche Vorlage dort Standard ist,
 * direkt änderbar. Ohne eigenen Standard nennt eine Kategoriezeile, was
 * stattdessen greift (der Standard für „Alle Kategorien").
 */
export default function TemplateDefaultsOverview() {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const setDefaultFor = useTemplateStore((s) => s.setDefaultFor);
  const categories = useCategoryStore((s) => s.categories);
  const [collapsed, toggle] = usePersistedFlag(COLLAPSED_KEY);

  if (templates.length === 0) return null;

  const options: DropdownOption<string>[] = [
    { value: NONE, label: t('templates.overview.none') },
    ...templates.map((tpl) => ({
      value: tpl.id,
      label: templateLabel(t, tpl),
      // Ein Bild-Icon passt nicht in die Menüzeile; der Name genügt.
      emoji: isImageIcon(tpl.icon) ? undefined : tpl.icon,
    })),
  ];

  const row = (entryType: TemplateEntryType, category: string | null, label: string) => {
    const current = defaultTemplateAt(templates, entryType, category);
    const fallback = !current && category !== ALL_CATEGORIES ? defaultTemplateAt(templates, entryType, ALL_CATEGORIES) : undefined;
    return (
      <li key={assignmentKey(entryType, category)} className="flex items-start gap-3">
        <span className="flex-1 min-w-0 max-w-48 truncate pt-1.5 text-xs text-[var(--text-secondary)]" title={label}>{label}</span>
        <div className="w-64 max-w-full min-w-0">
          <FieldDropdown
            value={current?.id ?? NONE}
            options={options}
            onChange={(id) => void setDefaultFor(entryType, category, id === NONE ? null : id)}
          />
          {fallback && (
            <p className="block-field-hint mt-1">{t('templates.overview.fallback', { name: templateLabel(t, fallback) })}</p>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="mt-8">
      <GroupDivider label={t('templates.overview.title')} collapsed={collapsed} onToggleCollapse={toggle} />
      {!collapsed && (
        <div className="space-y-6">
          <p className="block-field-hint">{t('templates.overview.hint')}</p>
          {TEMPLATE_ENTRY_TYPES.map((entryType) => {
            const meta = MODULES[viewTypeForEntryType(entryType)];
            return (
              <section key={entryType} className="space-y-2">
                <p className="label-xs flex items-center gap-1.5">
                  <meta.icon size={12} />
                  {t(meta.navLabelKey)}
                </p>
                <ul className="space-y-2">
                  {entryType === 'journal'
                    ? row(entryType, ALL_CATEGORIES, t('templates.overview.everyEntry'))
                    : [
                        row(entryType, ALL_CATEGORIES, t('templates.allCategories')),
                        row(entryType, null, t('categories.uncategorized')),
                        ...categories.map((cat) => row(entryType, cat.id, `${cat.emoji} ${categoryLabel(t, cat)}`)),
                      ]}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
