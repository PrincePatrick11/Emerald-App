import { generateId } from '../helpers';
import { parseBlocks, serializeBlocks } from './blockHtml';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, parseDisplay, parseElements, parseFields, serializeFields,
  type DisplayRules, type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * Eigene Blöcke (Blöcke-Ansicht, Tabelle `block_definitions`): eine Definition
 * ist die Vorlage, aus der ein Feldblock mit mehreren Elementen kopiert wird.
 *
 * Das Modell sind **Kopien, keine Live-Verweise** (Entscheidung des Nutzers):
 * ein eingefügter Block trägt Elemente, Anzeigeregeln, Name und Icon selbst —
 * gerendert wird immer aus der Kopie. Eine Änderung an der Definition ändert
 * deshalb keinen bestehenden Eintrag; fehlt die Definition (Papierkorb, Import
 * aus einem anderen Vault), funktioniert die Kopie trotzdem. Die Kopie merkt
 * sich nur, woher sie stammt (`data-block-origin`) und in welcher Revision
 * (`data-block-rev`) — daran erkennt die App eine „ältere Version" und bietet
 * das Aktualisieren an, einzeln im Eintrag oder gesammelt in der Blöcke-Ansicht.
 *
 * Element-IDs sind in Definition und allen Kopien dieselben. Werte bleiben so
 * über Umbenennen und Aktualisieren hinweg an ihrem Element, und ein späterer
 * Listenfilter findet sie in jeder Kopie, egal welcher Version.
 */

/** Die Anzeigeregeln einer Definition: die des Feldblocks plus der Titel im Lesemodus. */
export interface DefinitionDisplay extends DisplayRules {
  /** Wird beim Einfügen zum Instanz-Attribut `data-block-show-title` — pro Block änderbar. */
  showTitle: boolean;
}

export const DEFAULT_DEFINITION_DISPLAY: DefinitionDisplay = { ...DEFAULT_DISPLAY, showTitle: true };

/** Das Emoji einer neuen Definition — auch der Spalten-Default in `schema.ts`. */
export const DEFAULT_DEFINITION_ICON = '🧩';

/**
 * Eine Definitions-ID aus fremder Quelle (Backup, `.emerald`): sie landet in
 * `data-block-origin` jeder Kopie, also nur harmlose Zeichen. Eine gemeinsame
 * Regel für beide Importwege.
 */
export function isDefinitionId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

export interface BlockDefinition {
  id: string;
  name: string;
  /** Emoji. */
  icon: string;
  description: string;
  /** Mit archivierten Elementen: sie bleiben wiederherstellbar. */
  elements: ElementDef[];
  display: DefinitionDisplay;
  /** Steigt mit jeder Änderung, die Kopien betrifft (Name, Icon, Elemente, Anzeige). */
  revision: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Die Definition als Datenbankzeile — `elements`/`display` als JSON-Text. */
export function definitionToRow(def: BlockDefinition) {
  return { ...def, elements: JSON.stringify(def.elements), display: JSON.stringify(def.display) };
}

/** Was eine Definition an ihre Kopien weitergibt — ändert es sich, steigt die Revision. */
export type DefinitionShape = Pick<BlockDefinition, 'name' | 'icon' | 'elements' | 'display'>;

// Vergleich per JSON: hängt an der Schlüsselreihenfolge. Elemente entstehen
// deshalb immer über `parseElement` bzw. als Kopie von dort — ein anders
// sortiertes Objekt ergäbe eine Revision ohne echte Änderung.
export function sameShape(a: DefinitionShape, b: DefinitionShape): boolean {
  const shape = (d: DefinitionShape) => JSON.stringify([d.name, d.icon, d.elements, d.display]);
  return shape(a) === shape(b);
}

function parseJsonText(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Die Elemente einer Definition aus ihrer JSON-Spalte — geprüft wie die Kopie im Inhalt. */
export function parseDefinitionElements(raw: unknown): ElementDef[] {
  return parseElements(parseJsonText(raw));
}

export function parseDefinitionDisplay(raw: unknown): DefinitionDisplay {
  const parsed = parseJsonText(raw);
  const showTitle = typeof parsed === 'object' && parsed !== null && 'showTitle' in parsed
    ? (parsed as { showTitle: unknown }).showTitle
    : undefined;
  return {
    ...parseDisplay(parsed),
    showTitle: typeof showTitle === 'boolean' ? showTitle : DEFAULT_DEFINITION_DISPLAY.showTitle,
  };
}

/** Herkunft einer Kopie, oder `null` für jeden anderen Block. */
export function blockOrigin(block: BlockInstance): { id: string; rev: number } | null {
  if (block.type !== FIELDS_BLOCK_TYPE) return null;
  const id = block.attrs[BLOCK_ATTR.origin];
  if (!id) return null;
  const rev = Number(block.attrs[BLOCK_ATTR.rev]);
  return { id, rev: Number.isInteger(rev) && rev > 0 ? rev : 0 };
}

/** Ist der Block eine Kopie dieser Definition in einer älteren Revision — und lesbar genug, um sie zu aktualisieren? */
export function isOutdatedCopy(block: BlockInstance, def: BlockDefinition): boolean {
  const origin = blockOrigin(block);
  return !!origin && origin.id === def.id && origin.rev < def.revision && !parseFields(block).broken;
}

function blockDisplay(display: DefinitionDisplay): DisplayRules {
  return { readHideEmpty: display.readHideEmpty, readOnly: display.readOnly };
}

/** Ein neuer Block als Kopie der Definition — ohne die archivierten Elemente, ohne Werte. */
export function instantiateDefinition(def: BlockDefinition): BlockInstance {
  const attrs: Record<string, string> = {
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: def.elements.filter((e) => !e.archived),
      display: blockDisplay(def.display),
      name: def.name,
      icon: def.icon,
    }),
    [BLOCK_ATTR.origin]: def.id,
    [BLOCK_ATTR.rev]: String(def.revision),
  };
  // Der Standard des Feldblocks ist „ohne Titel"; nur die Abweichung wird Attribut.
  if (def.display.showTitle) attrs[BLOCK_ATTR.showTitle] = '1';
  return { id: generateId(), type: FIELDS_BLOCK_TYPE, html: '', attrs };
}

/**
 * Die Kopie auf den Stand der Definition bringen:
 * - Werte bleiben, wo sie sind — an ihrer Element-ID.
 * - Neue Elemente kommen leer dazu, in der Reihenfolge der Definition.
 * - Elemente, die die Definition nicht (mehr) zeigt, werden archiviert:
 *   unsichtbar, mit ihren Daten.
 * - Beschriftungen, Optionen, Anzeigeregeln, Name und Icon kommen aus der
 *   Definition. Was an der Instanz selbst hängt — eigener Titel, Auge, Titel
 *   im Lesemodus —, bleibt.
 *
 * Ein unlesbarer Block kommt unverändert zurück. Ein Element, dessen Art in
 * der Kopie eine andere ist als in der Definition (die Blöcke-Ansicht lässt
 * das nicht zu; nur eine präparierte Datei könnte es), behält seine Fassung —
 * die der Definition verwürfe seinen Wert.
 */
export function updateInstanceToDefinition(block: BlockInstance, def: BlockDefinition, text: FallbackText): BlockInstance {
  const model = parseFields(block);
  if (model.broken) return block;
  const own = new Map(model.elements.map((e) => [e.id, e]));
  const fromDef = def.elements
    .filter((e) => !e.archived)
    .map((e) => {
      const mine = own.get(e.id);
      return mine && mine.kind !== e.kind ? mine : { ...e };
    });
  const shown = new Set(fromDef.map((e) => e.id));
  const archived = model.elements
    .filter((e) => !shown.has(e.id))
    .map((e) => ({ ...e, archived: true }));

  const next: FieldsModel = {
    ...model,
    elements: [...fromDef, ...archived],
    display: blockDisplay(def.display),
    name: def.name,
    icon: def.icon,
  };
  const withRev = { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.rev]: String(def.revision) } };
  return serializeFields(withRev, next, text);
}

/** Alle veralteten Kopien der Definition in einem Inhalt aktualisieren — `null`, wenn es keine gab. */
export function updateCopiesInContent(content: string, def: BlockDefinition, text: FallbackText): string | null {
  let changed = false;
  const next = parseBlocks(content).map((block) => {
    if (!isOutdatedCopy(block, def)) return block;
    changed = true;
    return updateInstanceToDefinition(block, def, text);
  });
  return changed ? serializeBlocks(next) : null;
}

/** Alle Kopien der Definition aus einem Inhalt entfernen — `null`, wenn es keine gab. */
export function removeCopiesFromContent(content: string, defId: string): string | null {
  const blocks = parseBlocks(content);
  const next = blocks.filter((block) => blockOrigin(block)?.id !== defId);
  return next.length === blocks.length ? null : serializeBlocks(next);
}
