import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Image as ImageIcon, Smile } from 'lucide-react';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import SidebarSection, { SidebarPropertyRow } from './SidebarSection';
import { FaviconGlyph } from './Favicon';
import { LinkedEntriesSection } from './LinkedEntriesField';
import { TagsSection } from './TagsField';

/**
 * Die Leseansicht eines Eintrags in der rechten Seitenleiste — Journal, Wiki
 * und Operationen gleich: Eigenschaften, Verlinkungen, Tags. Ein Fragment,
 * damit die Blöcke darunter (`BlockSidebarArea`) im selben Abstand folgen.
 * Ohne `properties` entfällt der Eigenschaften-Abschnitt.
 */
export default function EntryReadSections({ properties, content, legacyIds, tags }: {
  properties?: ReactNode;
  content: string;
  legacyIds?: ComponentProps<typeof LinkedEntriesSection>['legacyIds'];
  tags: string[];
}) {
  return (
    <>
      {properties && <PropertiesSection>{properties}</PropertiesSection>}
      <LinkedEntriesSection content={content} legacyIds={legacyIds} />
      <TagsSection tags={tags} />
    </>
  );
}

/** Der Abschnitt „Eigenschaften" — auch vom Altar benutzt, der sonst andere Abschnitte hat. */
export function PropertiesSection({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <SidebarSection storageKey="entry-sidebar-properties-open" label={t('properties.title')}>{children}</SidebarSection>;
}

/** Die Kategorie als Eigenschaft — eine gelöschte zeigt „Keine" statt der rohen id. */
export function CategoryPropertyRow({ categoryId }: { categoryId?: string | null }) {
  const { t } = useTranslation();
  const category = useCategoryStore((s) => s.categories.find((c) => c.id === categoryId));
  return (
    <SidebarPropertyRow
      icon={<Folder size={14} />}
      label={t('properties.category')}
      value={category ? <><span className="font-normal">{category.emoji}</span><span className="truncate">{categoryLabel(t, category)}</span></> : t('properties.noCategory')}
      muted={!category}
    />
  );
}

/**
 * Icon und Titelbild als zwei Eigenschaften (Wiki, Operationen): gesetzt als
 * kleine Vorschau rechts, sonst leise „Keins". Geändert wird im Bearbeiten
 * über `IconCoverField`.
 */
export function IconCoverPropertyRows({ icon, cover }: { icon?: string | null; cover?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <SidebarPropertyRow
        icon={<Smile size={14} />}
        label={t('properties.icon')}
        value={icon ? <FaviconGlyph value={icon} className="w-4 h-4 text-sm" /> : t('properties.noIcon')}
        muted={!icon}
      />
      <SidebarPropertyRow
        icon={<ImageIcon size={14} />}
        label={t('properties.coverImage')}
        value={cover
          ? <img src={cover} alt="" className="h-4 w-9 flex-shrink-0 object-cover rounded-sm border border-stone-700/60" />
          : t('properties.noCover')}
        muted={!cover}
      />
    </>
  );
}
