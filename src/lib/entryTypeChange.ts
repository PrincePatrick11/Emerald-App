/**
 * Den Typ eines Eintrags wechseln — Journal, Operation und Wiki untereinander,
 * die drei Module mit Blockstapel. Aufgaben und Altäre haben ein anderes
 * Datenmodell und bleiben, was sie sind.
 *
 * Der Eintrag behält seine id: seine Zeile in `entries` bekommt den neuen Typ,
 * und alles, was ihn über `(id, Typ)` adressiert, zieht mit — Link-Chips in
 * Einträgen, Vorlagen und den Vorgaben eigener Blöcke, die `task_links`-Zeilen,
 * offene Tabs und ihre Verläufe. Titel, Inhalt, Tags und
 * Anlagedatum bleiben; die Nummer (`entry_number`) zählt im neuen Typ weiter.
 * Kategorie, Icon und Titelbild wandern zwischen Wiki und Operation mit — das
 * Journal kennt keine davon, sie fallen dort weg (die Seitenleiste fragt vorher).
 *
 * Der Inhalt bleibt, wie er ist: ein Standard greift nur beim Anlegen. Die
 * Vorlagen des neuen Typs stehen danach zum Einsetzen von Hand bereit.
 *
 * Ein Wechsel mitten im Bearbeiten gehört zur Bearbeitung: ihr Ausgangsstand
 * zieht mit (`store/entryEdit.ts`), und Cancel bringt den Eintrag auf demselben
 * Weg zurück (`revertEntryType`) — in sein Modul, mit seiner alten Nummer.
 *
 * Ohne Transaktion (siehe `normalizeSchema.ts`): erst die Zeile, dann die
 * Verweise. Bricht es dazwischen ab, zeigen schlimmstenfalls einzelne Chips
 * noch den alten Typ — der Eintrag selbst ist nie doppelt und nie weg (bis v48
 * zog die Zeile zwischen drei Tabellen um).
 *
 * Import-Regel wie `dbBackup`: liest und schreibt die Stores von außen; keiner
 * von ihnen importiert zurück.
 */
import type Database from './sqlite';
import { getDb, nextEntryNumber } from './db';
import { nowIso } from './helpers';
import { retypeInternalLinks } from './internalLinkHtml';
import { serialKey, serialized } from './serialize';
import { viewTypeForEntryType } from './modules';
import { parseDefinitionElements, remapDefinitionDefaults } from './blocks/definitions';
import { hasOwnTitle } from './entryTitle';
import { carryBaseline, originOfEdit, retypeBaselineLinks, type BaselineFields, type EditOrigin } from '../store/entryEdit';
import { useBlockDraftStore, useTemplateDraftStore } from '../store/draftStore';
import { mapEntries, useEntryStore, withAddedEntry, withSortedEntry, withoutIds } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useUIStore, withEditLock } from '../store/uiStore';
import type { Entry, EntryType } from '../types';

/** Die Typen, zwischen denen ein Eintrag wechseln kann — die Module mit Blockstapel. */
export type ConvertibleEntryType = EntryType;

/** Was ein Eintrag über den Typwechsel mitnimmt. */
type EntryCore = Pick<Entry, 'id' | 'title' | 'content' | 'tags' | 'created_at' | 'category_id' | 'icon' | 'cover_image'>;


/**
 * Verliert der Eintrag etwas, wenn er `to` wird? Nur das Journal hat weniger
 * Eigenschaften als die anderen beiden.
 */
export function typeChangeDropsProperties(entry: Pick<EntryCore, 'category_id' | 'icon' | 'cover_image'>, to: ConvertibleEntryType): boolean {
  return to === 'journal' && !!(entry.category_id || entry.icon || entry.cover_image);
}

/** Die Rücknahme eines Typwechsels: wohin, und mit welchem Stand. */
interface Revert {
  origin: EditOrigin;
  fields: BaselineFields;
  /** „Zuletzt geändert" vom Beginn der Bearbeitung. */
  stamp: string | undefined;
}

/**
 * Die Nummer, die ein Eintrag in `type` schon einmal hatte — oder die nächste,
 * wenn sie inzwischen ein anderer trägt (`nextEntryNumber` zählt vom höchsten
 * Wert weiter, und der war vielleicht dieser Eintrag).
 */
async function formerEntryNumber(db: Database, type: ConvertibleEntryType, id: string, former: number | undefined): Promise<number> {
  if (former !== undefined) {
    const taken = await db.select<{ id: string }[]>(
      'SELECT id FROM entries WHERE type=$1 AND entry_number=$2 AND id<>$3 LIMIT 1', [type, former, id]
    );
    if (!taken.length) return former;
  }
  return nextEntryNumber(db, type);
}

/** Gibt der Zeile den neuen Typ — samt den Feldern aus `core`, der Nummer in dessen Zählung und dem Stempel. */
async function retypeRow(
  db: Database, to: ConvertibleEntryType, core: EntryCore, entryNumber: number, updatedAt: string,
): Promise<Entry> {
  const entry: Entry = { ...core, type: to, entry_number: entryNumber, updated_at: updatedAt, deleted_at: null };
  await db.execute(
    `UPDATE entries
        SET type=$1, entry_number=$2, title=$3, content=$4, category_id=$5, icon=$6, cover_image=$7, updated_at=$8, tags=$9
      WHERE id=$10`,
    [to, entry.entry_number, entry.title, entry.content, entry.category_id, entry.icon ?? null, entry.cover_image ?? null,
      entry.updated_at, JSON.stringify(entry.tags), entry.id]
  );
  return entry;
}

/**
 * Schreibt `content` jeder Zeile um, die einen Chip auf `id` trägt — auch im
 * Papierkorb, sonst käme ein wiederhergestellter Eintrag mit einem toten Link
 * zurück. Ohne `updated_at`: am Inhalt dieser Einträge hat niemand etwas
 * geändert. Liefert die neuen Inhalte je id, für die Stores.
 */
async function retypeContentColumn(db: Database, table: string, id: string, to: ConvertibleEntryType): Promise<Map<string, string>> {
  const rows = await db.select<{ id: string; content: string }[]>(
    `SELECT id, content FROM ${table} WHERE content LIKE $1`, [`%${id}%`]
  );
  const changed = new Map<string, string>();
  for (const row of rows) {
    const next = retypeInternalLinks(row.content, id, to);
    if (next === row.content) continue;
    await db.execute(`UPDATE ${table} SET content=$1 WHERE id=$2`, [next, row.id]);
    changed.set(row.id, next);
  }
  return changed;
}

function withContent<T extends { id: string; content: string }>(items: T[], changed: Map<string, string>): T[] {
  return changed.size ? items.map((item) => (changed.has(item.id) ? { ...item, content: changed.get(item.id)! } : item)) : items;
}

/**
 * Wechselt den Typ des Eintrags `id` von `from` nach `to` und öffnet ihn
 * überall unter dem neuen Typ. Ist er gerade im Bearbeiten offen, wird die
 * laufende Eingabe vorher gespeichert; das Bearbeiten geht danach im neuen
 * Modul weiter.
 */
export async function changeEntryType(id: string, from: ConvertibleEntryType, to: ConvertibleEntryType): Promise<void> {
  if (from === to) return;
  // Fertig und Abbrechen warten: sie gehören der Ansicht, die gleich abgebaut
  // wird, und führten nach dem Wechsel auf ein Paar aus Typ und id, das es
  // nicht mehr gibt.
  await withEditLock(async () => {
    // Vor der Kette unten: der Flush läuft selbst unter dem Schlüssel des Eintrags.
    await useUIStore.getState().editActions?.flush?.();
    // Der Inhalt zieht mit — auch bei einem Eintrag, der seit dem Start nie offen war.
    await useEntryStore.getState().ensureEntryContent(id);
    await retypeEntry(id, from, to);
  });
}

/** Stellt die Link-Vorgaben eigener Blöcke, die auf `id` zeigen, auf den Typ `to` — `hit`, wenn es eine gab. */
function retypeDefinitionTargets(elements: unknown, id: string, to: ConvertibleEntryType): { next: unknown; hit: boolean } {
  let hit = false;
  const next = remapDefinitionDefaults(elements, (name) => name, (target) => {
    if (target.id !== id) return target;
    hit = true;
    return { ...target, entryType: to };
  });
  return { next, hit };
}

/**
 * Was noch nicht gespeichert ist und trotzdem auf den Eintrag zeigt: die
 * Ausgangsstände anderer Bearbeitungen und die Entwürfe von Vorlagen und
 * eigenen Blöcken (`base` wie `draft` — „Fertig" speichert nur den Unterschied).
 * Ohne das käme der alte Typ mit dem nächsten Cancel oder Fertig dort zurück.
 */
function retypeUnsavedLinks(id: string, to: ConvertibleEntryType): void {
  retypeBaselineLinks(id, to);

  const templateDrafts = useTemplateDraftStore.getState().drafts;
  for (const [draftId, entry] of Object.entries(templateDrafts)) {
    const base = retypeInternalLinks(entry.base.content, id, to);
    const draft = retypeInternalLinks(entry.draft.content, id, to);
    if (base === entry.base.content && draft === entry.draft.content) continue;
    useTemplateDraftStore.getState().saveDraft(draftId, {
      base: { ...entry.base, content: base },
      draft: { ...entry.draft, content: draft },
    });
  }

  const blockDrafts = useBlockDraftStore.getState().drafts;
  for (const [draftId, entry] of Object.entries(blockDrafts)) {
    const base = retypeDefinitionTargets(entry.base.elements, id, to);
    const draft = retypeDefinitionTargets(entry.draft.elements, id, to);
    if (!base.hit && !draft.hit) continue;
    useBlockDraftStore.getState().saveDraft(draftId, {
      base: { ...entry.base, elements: parseDefinitionElements(base.next) },
      draft: { ...entry.draft, elements: parseDefinitionElements(draft.next) },
    });
  }
}

/**
 * Nimmt die Typwechsel einer Bearbeitung zurück: der Eintrag `id`, gerade vom
 * Typ `from`, wird wieder, was er beim Betreten war — Typ und Nummer aus
 * `origin`, die Felder aus dem Ausgangsstand, „Zuletzt geändert" eingeschlossen.
 * Die offene Seite steht danach im Lesen. Ohne Flush: die laufende Eingabe
 * wird ja verworfen. `false`, wenn es den Eintrag unter `from` nicht mehr gibt.
 */
export function revertEntryType(
  id: string, from: ConvertibleEntryType, origin: EditOrigin, fields: BaselineFields, stamp: string | undefined,
): Promise<boolean> {
  return retypeEntry(id, from, origin.type, { origin, fields, stamp });
}

/**
 * Der eine Weg in beide Richtungen: die Zeile, dann alles, was den Eintrag
 * über `(id, Typ)` adressiert. Mit `revert` kommen die Felder aus dem
 * Ausgangsstand statt aus dem Store, und die Bearbeitung endet.
 */
function retypeEntry(id: string, from: ConvertibleEntryType, to: ConvertibleEntryType, revert?: Revert): Promise<boolean> {
  return serialized(serialKey('entry', id), async () => {
    const source = useEntryStore.getState().getEntry(id, from);
    if (!source) return false;
    const db = await getDb();

    const fields = { ...source, ...revert?.fields };
    const core: EntryCore = {
      id: source.id,
      tags: fields.tags,
      created_at: source.created_at,
      category_id: fields.category_id,
      icon: fields.icon,
      cover_image: fields.cover_image,
      // Ein unbenannter Eintrag heißt danach wie ein unbenannter des neuen Typs.
      // Ohne eigenen Titel bleibt er leer — „Unbenannt…" zeigt die neue Art von selbst.
      // Der Ausgangsstand dagegen kommt zurück, wie er war.
      title: (revert || hasOwnTitle(fields.title)) ? fields.title : '',
      // Ein Link des Eintrags auf sich selbst zieht mit.
      content: retypeInternalLinks(fields.content, id, to),
      ...(to === 'journal' ? { category_id: null, icon: undefined, cover_image: undefined } : {}),
    };
    // Zurück zum Typ vom Beginn der Bearbeitung — über Cancel oder von Hand —
    // bekommt der Eintrag seine Nummer von damals wieder.
    const origin = revert?.origin ?? originOfEdit(id, from);
    const entryNumber = origin?.type === to
      ? await formerEntryNumber(db, to, id, origin.entry_number)
      : await nextEntryNumber(db, to);
    const converted = await retypeRow(db, to, core, entryNumber, revert?.stamp ?? nowIso());

    const entryContent = await retypeContentColumn(db, 'entries', id, to);
    const templateContent = await retypeContentColumn(db, 'templates', id, to);

    const definitionRows = await db.select<{ id: string; elements: string }[]>(
      'SELECT id, elements FROM block_definitions WHERE elements LIKE $1', [`%${id}%`]
    );
    let definitionsChanged = false;
    for (const row of definitionRows) {
      // Ohne Revisionssprung: die Kopien in den Einträgen hat `retypeContentColumn` schon umgeschrieben.
      const { next, hit } = retypeDefinitionTargets(row.elements, id, to);
      if (!hit) continue;
      await db.execute('UPDATE block_definitions SET elements=$1 WHERE id=$2', [next, row.id]);
      definitionsChanged = true;
    }

    await db.execute('UPDATE task_links SET target_type=$1 WHERE target_id=$2', [to, id]);

    // Ohne await dazwischen: der neue Typ steht im Store, bevor die Ansicht
    // wechselt, und der alte verschwindet erst mit ihr — kein Frame, in dem
    // der offene Tab auf einen Eintrag zeigt, den es nicht gibt.
    // Zurückgenommen steht der Eintrag wieder an seinem Platz, nicht vorn wie ein neuer.
    useEntryStore.setState((s) => ({ entries: (revert ? withSortedEntry : withAddedEntry)(s.entries, converted) }));
    // Der Ausgangsstand der Bearbeitung zieht mit, bevor die Tabs es tun; nach
    // einer Rücknahme ist sie zu Ende, und er verfällt mit dem Wechsel ins Lesen.
    if (!revert) carryBaseline(id, from, to, { type: from, entry_number: source.entry_number });
    useUIStore.getState().retypeEntryViews(id, viewTypeForEntryType(from), viewTypeForEntryType(to), { endEdit: !!revert });
    useEntryStore.setState((s) => ({
      entries: mapEntries(s.entries, (list, type) => {
        const next = withContent(list, entryContent);
        return type === from ? next.filter((e) => e.id !== id) : next;
      }),
      // Die umgeschriebenen Inhalte sind der neueste Stand: ein noch laufendes
      // Nachladen (`fetchEntries`) darf sie nicht mit seinem älteren ersetzen.
      pendingContent: s.pendingContent && withoutIds(s.pendingContent, entryContent.keys()),
    }));
    useTemplateStore.setState((s) => ({ templates: withContent(s.templates, templateContent) }));
    useTaskStore.setState((s) => ({
      links: s.links.map((link) => (link.target_id === id ? { ...link, target_type: to } : link)),
    }));
    if (definitionsChanged) void useBlockDefinitionStore.getState().fetchDefinitions();
    retypeUnsavedLinks(id, to);
    return true;
  });
}
