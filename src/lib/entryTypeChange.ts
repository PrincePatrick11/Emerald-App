/**
 * Den Typ eines Eintrags wechseln — Journal, Operation und Wiki untereinander,
 * die drei Module mit Blockstapel. Aufgaben und Altäre haben ein anderes
 * Datenmodell und bleiben, was sie sind.
 *
 * Der Eintrag behält seine id: die Zeile zieht in die Tabelle des neuen Typs
 * um, und alles, was ihn über `(id, Typ)` adressiert, zieht mit — Link-Chips in
 * Einträgen, Vorlagen und den Vorgaben eigener Blöcke, die `links`- und
 * `task_links`-Zeilen, offene Tabs und ihre Verläufe. Titel, Inhalt, Tags und
 * Anlagedatum bleiben; die Nummer (`entry_number`) vergibt die neue Tabelle.
 * Kategorie, Icon und Titelbild wandern zwischen Wiki und Operation mit — das
 * Journal kennt keine davon, sie fallen dort weg (die Seitenleiste fragt vorher).
 *
 * Vorlagen nach derselben Regel wie beim Kategoriewechsel
 * (`defaultTemplateSwap`): ist der Inhalt leer oder steht noch unverändert der
 * Standard des alten Typs drin, kommt der Standard des neuen — mit dem Hinweis
 * „Vorlage angewendet" samt Rückgängig im Blockstapel.
 *
 * Ohne Transaktion (siehe `normalizeSchema.ts`), deshalb in dieser
 * Reihenfolge: erst die neue Zeile, dann die Verweise, zuletzt die alte Zeile
 * löschen. Bricht es mittendrin ab, steht der Eintrag schlimmstenfalls doppelt
 * da — verloren geht nichts.
 *
 * Import-Regel wie `dbBackup`: liest und schreibt die Stores von außen; keiner
 * von ihnen importiert zurück.
 */
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from './db';
import { nowIso } from './helpers';
import { syncLinks } from './links';
import { retypeInternalLinks } from './internalLinkHtml';
import { getMoonPhase } from './moonPhase';
import { serialKey, serialized } from './serialize';
import { viewTypeForEntryType } from './modules';
import { remapDefinitionDefaults } from './blocks/definitions';
import { parseBlocks, serializeBlocks } from './blocks/blockHtml';
import {
  defaultTemplateSwap, fieldsWithoutTemplate, fieldsWithTemplate, instantiateTemplateBlocks, UNTITLED_TITLES,
  type TemplateEntryType,
} from './blocks/templates';
import { useJournalStore } from '../store/journalStore';
import { uniqueSlugify, useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateNoticeStore, useTemplateStore } from '../store/templateStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useUIStore } from '../store/uiStore';
import type { JournalEntry, Operation, WikiArticle } from '../types';

/** Die Typen, zwischen denen ein Eintrag wechseln kann — die Module mit Blockstapel. */
export type ConvertibleEntryType = TemplateEntryType;

const TABLES: Record<ConvertibleEntryType, 'journal_entries' | 'wiki_articles' | 'operations'> = {
  journal: 'journal_entries',
  wiki: 'wiki_articles',
  operation: 'operations',
};

/** Was ein Eintrag über den Typwechsel mitnimmt. */
interface EntryCore {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  category_id: string | null;
  icon?: string;
  cover_image?: string;
}

function readEntry(type: ConvertibleEntryType, id: string): EntryCore | undefined {
  switch (type) {
    case 'journal': {
      const e = useJournalStore.getState().entries.find((x) => x.id === id);
      return e && { ...e, category_id: null };
    }
    case 'wiki': return useWikiStore.getState().articles.find((x) => x.id === id);
    case 'operation': return useOperationStore.getState().operations.find((x) => x.id === id);
  }
}

/**
 * Verliert der Eintrag etwas, wenn er `to` wird? Nur das Journal hat weniger
 * Eigenschaften als die anderen beiden.
 */
export function typeChangeDropsProperties(entry: Pick<EntryCore, 'category_id' | 'icon' | 'cover_image'>, to: ConvertibleEntryType): boolean {
  return to === 'journal' && !!(entry.category_id || entry.icon || entry.cover_image);
}

type Converted =
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'wiki'; entry: WikiArticle }
  | { type: 'operation'; entry: Operation };

async function insertAs(db: Database, to: ConvertibleEntryType, core: EntryCore): Promise<Converted> {
  const now = nowIso();
  const entry_number = await nextEntryNumber(db, TABLES[to]);
  const tags = JSON.stringify(core.tags);
  switch (to) {
    case 'journal': {
      const entry: JournalEntry = {
        id: core.id, entry_number, title: core.title, content: core.content, tags: core.tags,
        created_at: core.created_at, updated_at: now,
        // Die Mondphase des Tages, an dem der Eintrag entstand — wie beim Anlegen.
        moon_phase: getMoonPhase(new Date(core.created_at)),
        mood: null, paradigm_id: null, linked_operation_ids: [], linked_wiki_ids: [],
        is_bannung: false, bannung_type_wiki_id: null, is_meditation: false, meditation_duration: null,
        meditation_type_wiki_id: null, deleted_at: null,
      };
      await db.execute(
        `INSERT INTO journal_entries (id, title, content, created_at, updated_at, tags, moon_phase, mood, entry_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.id, entry.title, entry.content, entry.created_at, entry.updated_at, tags, entry.moon_phase, entry.mood, entry_number]
      );
      return { type: to, entry };
    }
    case 'wiki': {
      const entry: WikiArticle = {
        id: core.id, entry_number, title: core.title, content: core.content, tags: core.tags,
        slug: await uniqueSlugify(db, core.title, core.id),
        category_id: core.category_id, icon: core.icon, cover_image: core.cover_image,
        created_at: core.created_at, updated_at: now, deleted_at: null,
      };
      await db.execute(
        `INSERT INTO wiki_articles (id, title, slug, content, category_id, created_at, updated_at, tags, entry_number, cover_image, icon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [entry.id, entry.title, entry.slug, entry.content, entry.category_id, entry.created_at, entry.updated_at, tags,
          entry_number, entry.cover_image ?? null, entry.icon ?? null]
      );
      return { type: to, entry };
    }
    case 'operation': {
      const entry: Operation = {
        id: core.id, entry_number, title: core.title, content: core.content, tags: core.tags,
        category_id: core.category_id, icon: core.icon, cover_image: core.cover_image,
        created_at: core.created_at, updated_at: now, deleted_at: null,
      };
      await db.execute(
        `INSERT INTO operations (id, title, content, category_id, created_at, updated_at, tags, entry_number, icon, cover_image)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [entry.id, entry.title, entry.content, entry.category_id, entry.created_at, entry.updated_at, tags,
          entry_number, entry.icon ?? null, entry.cover_image ?? null]
      );
      return { type: to, entry };
    }
  }
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

  await serialized(serialKey(from, id), async () => {
    const source = readEntry(from, id);
    if (!source) return;
    const db = await getDb();

    let core: EntryCore = {
      ...source,
      // Ein unbenannter Eintrag heißt danach wie ein unbenannter des neuen Typs.
      title: source.title === UNTITLED_TITLES[from] ? UNTITLED_TITLES[to] : source.title,
      // Ein Link des Eintrags auf sich selbst zieht mit.
      content: retypeInternalLinks(source.content, id, to),
      ...(to === 'journal' ? { category_id: null, icon: undefined, cover_image: undefined } : {}),
    };
    const swap = defaultTemplateSwap(
      useTemplateStore.getState().templates,
      parseBlocks(source.content),
      { entryType: from, categoryId: source.category_id },
      { entryType: to, categoryId: core.category_id },
    );
    if (swap) {
      // Wie `BlockStack.applyTemplate` mit `replaces`: erst Titel und Tags der
      // abgelösten Vorlage weg, dann die der neuen.
      const cleared = swap.replaces ? fieldsWithoutTemplate(core, to, swap.replaces) : core;
      core = {
        ...core,
        ...fieldsWithTemplate(cleared, to, swap.template, { title: 'ifUntitled', tags: true, replaces: swap.replaces }),
        content: serializeBlocks(instantiateTemplateBlocks(swap.template)),
      };
    }
    const converted = await insertAs(db, to, core);

    const journalContent = await retypeContentColumn(db, 'journal_entries', id, to);
    const wikiContent = await retypeContentColumn(db, 'wiki_articles', id, to);
    const operationContent = await retypeContentColumn(db, 'operations', id, to);
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

    await db.execute('UPDATE links SET target_type=$1 WHERE target_id=$2', [to, id]);
    await db.execute('UPDATE task_links SET target_type=$1 WHERE target_id=$2', [to, id]);
    await db.execute(`DELETE FROM ${TABLES[from]} WHERE id=$1`, [id]);

    // Ohne await dazwischen: der neue Typ steht im Store, bevor die Ansicht
    // wechselt, und der alte verschwindet erst mit ihr — kein Frame, in dem
    // der offene Tab auf einen Eintrag zeigt, den es nicht gibt.
    switch (converted.type) {
      case 'journal': useJournalStore.setState((s) => ({ entries: [converted.entry, ...s.entries] })); break;
      case 'wiki': useWikiStore.setState((s) => ({ articles: [...s.articles, converted.entry] })); break;
      case 'operation': useOperationStore.setState((s) => ({ operations: [converted.entry, ...s.operations] })); break;
    }
    if (swap) useTemplateNoticeStore.getState().show({ entryId: id, templateId: swap.template.id });
    useUIStore.getState().retypeEntryViews(id, viewTypeForEntryType(from), viewTypeForEntryType(to));
    useJournalStore.setState((s) => ({ entries: withContent(s.entries, journalContent).filter((e) => from !== 'journal' || e.id !== id) }));
    useWikiStore.setState((s) => ({ articles: withContent(s.articles, wikiContent).filter((a) => from !== 'wiki' || a.id !== id) }));
    useOperationStore.setState((s) => ({ operations: withContent(s.operations, operationContent).filter((o) => from !== 'operation' || o.id !== id) }));
    useTemplateStore.setState((s) => ({ templates: withContent(s.templates, templateContent) }));
    useTaskStore.setState((s) => ({
      links: s.links.map((link) => (link.target_id === id ? { ...link, target_type: to } : link)),
    }));
    if (definitionsChanged) void useBlockDefinitionStore.getState().fetchDefinitions();

    // Die ausgehenden Links unter dem neuen Quelltyp — hinter einem noch
    // laufenden syncLinks des alten Typs eingereiht, nicht davor.
    void serialized(serialKey('links', id), () => syncLinks(id, to, converted.entry.content));
  });
}
