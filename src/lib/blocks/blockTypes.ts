import { Type, type LucideIcon } from 'lucide-react';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockInstance, type BlockTypeId } from './types';

/**
 * Die Registry der Blocktypen — der reine Teil (Metadaten). Welche Komponente
 * einen Typ darstellt, steht in `components/blocks/blockViews.ts`; die
 * Trennung hält TipTap aus allem heraus, was nur wissen will, WAS ein Block ist
 * (Picker, Seitenleiste, Export, Migrationen).
 *
 * Die Form ist die Keimzelle der späteren Erweiterungs-API: ein Plugin würde
 * genau so einen Eintrag registrieren, mit `origin: 'plugin'`.
 */

export type BlockGroup = 'text' | 'fields' | 'sigil' | 'media' | 'reference' | 'moon';

export interface BlockTypeMeta {
  id: BlockTypeId;
  origin: 'core' | 'plugin';
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  group: BlockGroup;
  /**
   * Version des gespeicherten Datenformats (`data-block-v`, fehlt = 1). Ein
   * Block mit höherer Version stammt aus einer neueren App und wird wie ein
   * unbekannter Typ behandelt: angezeigt als Fallback, unverändert gespeichert.
   */
  dataVersion: number;
  /** Titel im Lesemodus zeigen, solange die Instanz nichts anderes sagt.
   *  Text fließt ohne Überschrift, Feld- und Werkzeugblöcke tragen eine. */
  defaultShowTitle: boolean;
}

// Eine Map statt eines Objekts: der Typ kommt aus gespeichertem Inhalt, und
// `BLOCK_TYPES['constructor']` fände sonst den Prototyp.
const BLOCK_TYPES = new Map<string, BlockTypeMeta>([
  [TEXT_BLOCK_TYPE, {
    id: TEXT_BLOCK_TYPE,
    origin: 'core',
    icon: Type,
    labelKey: 'blocks.types.text.label',
    descriptionKey: 'blocks.types.text.description',
    group: 'text',
    dataVersion: 1,
    defaultShowTitle: false,
  }],
]);

/** Alle Typen, die man einem Eintrag hinzufügen kann, in Anzeigereihenfolge. */
export const BLOCK_TYPE_LIST: readonly BlockTypeMeta[] = [...BLOCK_TYPES.values()];

/**
 * Der Typ, mit dem die App diesen Block darstellen kann — oder `undefined` für
 * einen unbekannten Typ oder ein zu neues Datenformat. Beides wird als Fallback
 * angezeigt und unverändert zurückgeschrieben.
 */
export function resolveBlockType(block: BlockInstance): BlockTypeMeta | undefined {
  const meta = BLOCK_TYPES.get(block.type);
  if (!meta) return undefined;
  const version = Number(block.attrs[BLOCK_ATTR.version] ?? 1);
  return Number.isFinite(version) && version <= meta.dataVersion ? meta : undefined;
}
