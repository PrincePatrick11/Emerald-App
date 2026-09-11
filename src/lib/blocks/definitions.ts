import { generateId } from '../helpers';
import { parseBlocks, serializeBlocks } from './blockHtml';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, isSlotKind, parseDisplay, parseElements, parseFields, serializeFields, slotFromDefault,
  type ChargeDefault, type DisplayRules, type ElementDef, type FallbackText, type FieldsModel, type FieldValue,
} from './fields';
import { isSigilFrozen, mayHoldSigil, sigilPartId, sigilState, todayIso } from './sigil';
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

/** Das Element, wie eine Kopie es trägt: ohne Vorgabe — die ist dort schon Wert geworden. */
function elementForCopy(element: ElementDef): ElementDef {
  const { defaultValue: _defaultValue, ...rest } = element;
  return rest;
}

// Vergleich per JSON: hängt an der Schlüsselreihenfolge. Elemente entstehen
// deshalb immer über `parseElement` bzw. als Kopie von dort — ein anders
// sortiertes Objekt ergäbe eine Revision ohne echte Änderung. Vorgaben zählen
// nicht: sie wirken nur auf neue Kopien, eine bestehende hätte nichts zu aktualisieren.
export function sameShape(a: DefinitionShape, b: DefinitionShape): boolean {
  const shape = (d: DefinitionShape) => JSON.stringify([d.name, d.icon, d.elements.map(elementForCopy), d.display]);
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

/**
 * Die Bilddateien, die Vorgaben einer Definition nennen. Sie stehen in keinem
 * Inhalt, bis eine Kopie entsteht — Backup, `.emerald` und das Bild-Aufräumen
 * müssen sie deshalb eigens kennen.
 */
export function definitionImageRefs(elements: readonly ElementDef[]): string[] {
  return elements
    .filter((e) => e.kind === 'image' && typeof e.defaultValue === 'string')
    .map((e) => e.defaultValue as string);
}

/** Ein Link-Ziel, wie der Import es auflöst — `null` heißt: gibt es hier nicht. */
export type LinkDefaultResolver = (target: { id: string; entryType: string; label: string }) => { id: string; label: string } | null;

/**
 * Die `elements` einer Definitionszeile aus fremder Quelle mit umgeschriebenen
 * Vorgaben: Bildnamen nach `image`, Link-Ziele nach `link` (Merge-Import mit
 * Präfix, `.emerald` nach ID oder Titel). Findet `link` kein Ziel, fällt die
 * Vorgabe weg — sonst trüge jede neue Kopie einen Chip ins Leere. Unlesbares
 * kommt unverändert zurück; das Lesen prüft ohnehin.
 */
export function remapDefinitionDefaults(
  rawElements: unknown,
  image: (name: string) => string,
  link: LinkDefaultResolver = (target) => target,
): unknown {
  const parsed = parseJsonText(rawElements);
  if (!Array.isArray(parsed)) return rawElements;
  const remapped = parsed.map((el: unknown) => {
    if (typeof el !== 'object' || el === null || !('defaultValue' in el)) return el;
    const value = (el as { defaultValue: unknown }).defaultValue;
    if (typeof value === 'string' && (el as { kind?: unknown }).kind === 'image') return { ...el, defaultValue: image(value) };
    if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string') {
      const raw = value as { id: string; entryType?: unknown; label?: unknown };
      const target = link({
        id: raw.id,
        entryType: typeof raw.entryType === 'string' ? raw.entryType : '',
        label: typeof raw.label === 'string' ? raw.label : '',
      });
      if (!target) {
        const { defaultValue: _dropped, ...rest } = el as Record<string, unknown>;
        return rest;
      }
      return { ...el, defaultValue: { ...raw, id: target.id, label: target.label } };
    }
    return el;
  });
  return typeof rawElements === 'string' ? JSON.stringify(remapped) : remapped;
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

/**
 * Die Vorgaben der Elemente — was eine neue Kopie (oder ein neues Element in
 * ihr) mitbekommt: Skalare als Werte, Verknüpfung, Altar und Bild als Slot.
 */
function defaultsOf(elements: readonly ElementDef[], blockId: string): Pick<FieldsModel, 'values' | 'slots'> {
  const values: Record<string, FieldValue> = {};
  const slots: Record<string, string> = {};
  for (const element of elements) {
    if (element.defaultValue === undefined) continue;
    if (element.kind === 'sigilCharge') {
      // Die Ladung ungeladen, mit Sperre und Zielen — die Ziele jetzt auf diesen Block.
      const { lock, targets } = element.defaultValue as ChargeDefault;
      values[element.id] = {
        loaded: false, revealDate: null, lock,
        ...(targets ? { targets: targets.map((id) => sigilPartId(blockId, id)) } : {}),
      };
      continue;
    }
    if (isSlotKind(element.kind)) {
      const slot = slotFromDefault(element);
      if (slot) slots[element.id] = slot;
      continue;
    }
    const value = element.defaultValue as FieldValue;
    // Eine Checkliste bekommt eigene Punkt-IDs, damit zwei Kopien nicht dieselben tragen.
    values[element.id] = Array.isArray(value) ? value.map((item) => ({ ...item, id: generateId() })) : value;
  }
  return { values, slots };
}

/**
 * Ein neuer Block als Kopie der Definition — ohne die archivierten Elemente,
 * vorbelegt mit den Vorgaben. `text` schreibt den lesbaren Fallback dieser
 * Werte, damit Suche und Export sie gleich finden.
 */
export function instantiateDefinition(def: BlockDefinition, text: FallbackText): BlockInstance {
  const elements = def.elements.filter((e) => !e.archived);
  const attrs: Record<string, string> = {
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: elements.map(elementForCopy),
      display: blockDisplay(def.display),
      name: def.name,
      icon: def.icon,
    }),
    [BLOCK_ATTR.origin]: def.id,
    [BLOCK_ATTR.rev]: String(def.revision),
  };
  // Der Standard des Feldblocks ist „ohne Titel"; nur die Abweichung wird Attribut.
  if (def.display.showTitle) attrs[BLOCK_ATTR.showTitle] = '1';
  const block: BlockInstance = { id: generateId(), type: FIELDS_BLOCK_TYPE, html: '', attrs };
  const defaults = defaultsOf(elements, block.id);
  if (Object.keys(defaults.values).length === 0 && Object.keys(defaults.slots).length === 0) return block;
  const model = parseFields(block);
  return serializeFields(block, {
    ...model,
    values: { ...model.values, ...defaults.values },
    slots: { ...model.slots, ...defaults.slots },
  }, text);
}

/**
 * Die Kopie auf den Stand der Definition bringen:
 * - Werte bleiben, wo sie sind — an ihrer Element-ID.
 * - Neue Elemente kommen dazu, in der Reihenfolge der Definition — mit ihrer
 *   Vorgabe, sonst leer.
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
      return mine && mine.kind !== e.kind ? mine : elementForCopy(e);
    });
  // Nur Elemente, die die Kopie nie kannte — weder als (auch archiviertes) Element noch als verwaisten Wert oder Slot.
  const added = def.elements.filter((e) =>
    !e.archived && !own.has(e.id) && !(e.id in model.orphans) && !(e.id in model.slots));
  const defaults = defaultsOf(added, block.id);
  const shown = new Set(fromDef.map((e) => e.id));
  const archived = model.elements
    .filter((e) => !shown.has(e.id))
    .map((e) => ({ ...e, archived: true }));

  const next: FieldsModel = {
    ...model,
    values: { ...defaults.values, ...model.values },
    slots: { ...defaults.slots, ...model.slots },
    elements: [...fromDef, ...archived],
    display: blockDisplay(def.display),
    name: def.name,
    icon: def.icon,
  };
  const withRev = { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.rev]: String(def.revision) } };
  return serializeFields(withRev, next, text);
}

/**
 * Trägt der Inhalt eine Kopie der Definition, die eine geladene Sigille
 * festhält (`isSigilFrozen`)? Die bleibt beim Aktualisieren und Entfernen
 * stehen — der Aufrufer meldet sie als übersprungen.
 */
export function hasFrozenCopy(content: string, defId: string, today = todayIso()): boolean {
  if (!mayHoldSigil(content)) return false;
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, today);
  return blocks.some((block) => blockOrigin(block)?.id === defId && isSigilFrozen(block, state));
}

/** Alle veralteten Kopien der Definition in einem Inhalt aktualisieren — `null`, wenn es keine gab. */
export function updateCopiesInContent(content: string, def: BlockDefinition, text: FallbackText): string | null {
  let changed = false;
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, todayIso());
  const next = blocks.map((block) => {
    if (!isOutdatedCopy(block, def) || isSigilFrozen(block, state)) return block;
    changed = true;
    return updateInstanceToDefinition(block, def, text);
  });
  return changed ? serializeBlocks(next) : null;
}

/** Alle Kopien der Definition aus einem Inhalt entfernen — `null`, wenn es keine gab. Gesperrte bleiben (siehe `hasFrozenCopy`). */
export function removeCopiesFromContent(content: string, defId: string): string | null {
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, todayIso());
  const next = blocks.filter((block) => blockOrigin(block)?.id !== defId || isSigilFrozen(block, state));
  return next.length === blocks.length ? null : serializeBlocks(next);
}
