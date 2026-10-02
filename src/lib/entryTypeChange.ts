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
import { remapDefinitionDefaults } from './blocks/definitions';
import { hasOwnTitle } from './entryTitle';
import { mapEntries, useEntryStore, withAddedEntry } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useUIStore } from '../store/uiStore';
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

/** Gibt der Zeile den neuen Typ — samt Nummer in dessen Zählung und den Feldern aus `core`. */
async function retypeRow(db: Database, to: ConvertibleEntryType, core: EntryCore): Promise<Entry> {
  const entry: Entry = {
    ...core,
    type: to,
    entry_number: await nextEntryNumber(db, to),
    updated_at: nowIso(),
    deleted_at: null,
  };
  await db.execute(
    `UPDATE entries
        SET type=$1, entry_number=$2, title=$3, content=$4, category_id=$5, icon=$6, cover_image=$7, updated_at=$8
      WHERE id=$9`,
    [to, entry.entry_number, entry.title, entry.content, entry.category_id, entry.icon ?? null, entry.cover_image ?? null,
      entry.updated_at, entry.id]
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
  // Vor der Kette unten: der Flush läuft selbst unter dem Schlüssel des Eintrags.
  await useUIStore.getState().editActions?.flush?.();
  // Der Inhalt zieht mit — auch bei einem Eintrag, der seit dem Start nie offen war.
  await useEntryStore.getState().ensureEntryContent(id);

  await serialized(serialKey('entry', id), async () => {
    const source = useEntryStore.getState().getEntry(id, from);
    if (!source) return;
    const db = await getDb();

    const core: EntryCore = {
      id: source.id,
      tags: source.tags,
      created_at: source.created_at,
      category_id: source.category_id,
      icon: source.icon,
      cover_image: source.cover_image,
      // Ein unbenannter Eintrag heißt danach wie ein unbenannter des neuen Typs.
      // Ohne eigenen Titel bleibt er leer — „Unbenannt…" zeigt die neue Art von selbst.
      title: hasOwnTitle(source.title) ? source.title : '',
      // Ein Link des Eintrags auf sich selbst zieht mit.
      content: retypeInternalLinks(source.content, id, to),
      ...(to === 'journal' ? { category_id: null, icon: undefined, cover_image: undefined } : {}),
    };
    const converted = await retypeRow(db, to, core);

    const entryContent = await retypeContentColumn(db, 'entries', id, to);
    const templateContent = await retypeContentColumn(db, 'templates', id, to);

    const definitionRows = await db.select<{ id: string; elements: string }[]>(
      'SELECT id, elements FROM block_definitions WHERE elements LIKE $1', [`%${id}%`]
    );
    let definitionsChanged = false;
    for (const row of definitionRows) {
      let hit = false;
      // Ohne Revisionssprung: die Kopien in den Einträgen hat `retypeContentColumn` schon umgeschrieben.
      const next = remapDefinitionDefaults(row.elements, (name) => name, (target) => {
        if (target.id !== id) return target;
        hit = true;
        return { ...target, entryType: to };
      });
      if (!hit) continue;
      await db.execute('UPDATE block_definitions SET elements=$1 WHERE id=$2', [next, row.id]);
      definitionsChanged = true;
    }

    await db.execute('UPDATE task_links SET target_type=$1 WHERE target_id=$2', [to, id]);

    // Ohne await dazwischen: der neue Typ steht im Store, bevor die Ansicht
    // wechselt, und der alte verschwindet erst mit ihr — kein Frame, in dem
    // der offene Tab auf einen Eintrag zeigt, den es nicht gibt.
    useEntryStore.setState((s) => ({ entries: withAddedEntry(s.entries, converted) }));
    useUIStore.getState().retypeEntryViews(id, viewTypeForEntryType(from), viewTypeForEntryType(to));
    useEntryStore.setState((s) => ({
      entries: mapEntries(s.entries, (list, type) => {
        const next = withContent(list, entryContent);
        return type === from ? next.filter((e) => e.id !== id) : next;
      }),
    }));
    useTemplateStore.setState((s) => ({ templates: withContent(s.templates, templateContent) }));
    useTaskStore.setState((s) => ({
      links: s.links.map((link) => (link.target_id === id ? { ...link, target_type: to } : link)),
    }));
    if (definitionsChanged) void useBlockDefinitionStore.getState().fetchDefinitions();
  });
}
