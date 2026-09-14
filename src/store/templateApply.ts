/**
 * Eine Vorlage in einen bestehenden Eintrag bringen — was dafür außerhalb des
 * Blockstapels geschieht: Titel und Tags über den Store des Eintrags (wie die
 * Eigenschaften-Seitenleiste im Bearbeiten, die Views übernehmen den Stand
 * über ihre Sync-Effekte), der Standard nach einer nachträglich gesetzten
 * Kategorie und „Als Vorlage speichern". Die Blöcke setzt der Stapel selbst
 * (`BlockStackApi.applyTemplate`) — er hält den lebenden Inhalt.
 *
 * Import-Regel wie `blockCopies`: dieser Store liest die Inhalts-Stores und
 * den Vorlagen-Store, keiner von ihnen importiert zurück.
 */
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTemplateStore } from './templateStore';
import { useBlockSessionStore } from './blockSessionStore';
import { serializeBlocks } from '../lib/blocks/blockHtml';
import {
  areBlocksEmpty, contentForTemplate, isUnchangedTemplateContent, mergeTemplateTags, resolveDefaultTemplate,
  templateOriginsOf, UNTITLED_TITLES, type Template, type TemplateEntryType,
} from '../lib/blocks/templates';

/** Was außer den Blöcken übernommen wird. */
export interface TemplateFieldOptions {
  /**
   * Den Titel der Vorlage setzen (nur, wenn sie einen hat). `'ifUntitled'`:
   * nur, solange der Eintrag keinen eigenen trägt (`mayTakeTemplateTitle`) —
   * entschieden erst nach dem Speichern der laufenden Eingabe.
   */
  title: boolean | 'ifUntitled';
  /** Die Tags der Vorlage ergänzen. */
  tags: boolean;
}

/** Wie eine Vorlage in den Stapel kommt. */
export interface TemplateApplyOptions extends TemplateFieldOptions {
  /** Anhängen ans Ende oder den ganzen Inhalt ersetzen. Ein leerer Stapel wird immer ersetzt. */
  mode: 'append' | 'replace';
  /** Die Vorlage, die sie ablöst („Andere Vorlage", Kategoriewechsel) — ihre Tags fallen vorher weg. */
  replaces?: Template;
  /** Danach den Hinweis „Vorlage angewendet" zeigen (automatisch eingesetzt). */
  notice?: boolean;
}

interface EntryFields {
  title: string;
  tags: string[];
}

function entryFields(entryType: TemplateEntryType, id: string): (EntryFields & { content: string }) | undefined {
  switch (entryType) {
    case 'journal': return useJournalStore.getState().entries.find((e) => e.id === id);
    case 'wiki': return useWikiStore.getState().articles.find((a) => a.id === id);
    case 'operation': return useOperationStore.getState().operations.find((o) => o.id === id);
  }
}

function updateFields(entryType: TemplateEntryType, id: string, patch: Partial<EntryFields>): Promise<void> {
  switch (entryType) {
    case 'journal': return useJournalStore.getState().updateEntry(id, patch);
    case 'wiki': return useWikiStore.getState().updateArticle(id, patch);
    case 'operation': return useOperationStore.getState().updateOperation(id, patch);
  }
}

/**
 * Darf eine Vorlage den Titel setzen, ohne einen eigenen zu überschreiben?
 * Ja, solange der Eintrag leer oder mit dem Standardtitel seiner Art heißt —
 * oder noch den Titel der Vorlage trägt, die gerade abgelöst wird.
 */
export function mayTakeTemplateTitle(entryType: TemplateEntryType, id: string, replaces?: Pick<Template, 'title'>): boolean {
  const title = entryFields(entryType, id)?.title.trim() ?? '';
  return !title || title === UNTITLED_TITLES[entryType] || (!!replaces?.title.trim() && title === replaces.title.trim());
}

/**
 * Titel und Tags der Vorlage in den Eintrag. Der Aufrufer speichert vorher,
 * was im Editor noch nicht gespeichert ist — sonst läse das hier einen
 * älteren Titel, und der Sync der View überschriebe die laufende Eingabe.
 */
export async function applyTemplateFields(
  entryType: TemplateEntryType,
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
  options: TemplateFieldOptions & { replaces?: Pick<Template, 'title'> },
): Promise<void> {
  const fields = entryFields(entryType, id);
  if (!fields) return;
  const patch: Partial<EntryFields> = {};
  const takeTitle = options.title === 'ifUntitled' ? mayTakeTemplateTitle(entryType, id, options.replaces) : options.title;
  if (takeTitle && template.title.trim()) patch.title = template.title.trim();
  if (options.tags) {
    const tags = mergeTemplateTags(fields.tags, template.tags);
    if (tags.length !== fields.tags.length) patch.tags = tags;
  }
  if (Object.keys(patch).length) await updateFields(entryType, id, patch);
}

/**
 * Rückgängig nach einer automatisch eingesetzten Vorlage: der Titel geht
 * zurück auf den Standardtitel, wenn er noch der der Vorlage ist; ihre Tags
 * fallen weg — auch einer, den der Eintrag schon vorher trug (bei einem
 * frisch angelegten Eintrag kommt das nicht vor). Die Blöcke leert der Stapel.
 */
export async function undoTemplateFields(
  entryType: TemplateEntryType,
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
): Promise<void> {
  const fields = entryFields(entryType, id);
  if (!fields) return;
  const patch: Partial<EntryFields> = {};
  if (template.title.trim() && fields.title === template.title.trim()) patch.title = UNTITLED_TITLES[entryType];
  const removed = new Set(template.tags.map((tag) => tag.toLowerCase()));
  const tags = fields.tags.filter((tag) => !removed.has(tag.toLowerCase()));
  if (tags.length !== fields.tags.length) patch.tags = tags;
  if (Object.keys(patch).length) await updateFields(entryType, id, patch);
}

/**
 * Nach einer nachträglich gesetzten Kategorie: den Standard der neuen
 * Kombination einsetzen — wenn der Inhalt leer ist oder noch unverändert der
 * Standard der bisherigen Kategorie drinsteht (meist der Rückfall „alle
 * Kategorien"). Eine von Hand gewählte Vorlage bleibt. Nur, solange der
 * Eintrag im Bearbeiten offen ist: dann hält sein Stapel den lebenden Inhalt.
 */
export function applyDefaultAfterCategoryChange(
  entryType: TemplateEntryType,
  id: string,
  previousCategoryId: string | null,
  categoryId: string | null,
): void {
  const session = useBlockSessionStore.getState().session;
  if (!session || session.entryId !== id || !session.isEditing || !session.templates) return;
  const templates = useTemplateStore.getState().templates;
  const next = resolveDefaultTemplate(templates, entryType, categoryId);
  if (!next) return;
  const blocks = session.api.liveBlocks();
  let previous: Template | undefined;
  if (!areBlocksEmpty(blocks)) {
    previous = resolveDefaultTemplate(templates, entryType, previousCategoryId) ?? undefined;
    const origins = templateOriginsOf(blocks);
    if (!previous || previous.id === next.id || origins.length !== 1 || origins[0] !== previous.id) return;
    if (!isUnchangedTemplateContent(serializeBlocks(blocks), previous)) return;
  }
  session.api.applyTemplate(next, { mode: 'replace', title: 'ifUntitled', tags: true, replaces: previous, notice: true });
}

/**
 * Einen Eintrag als neue Vorlage speichern — sein Titel wird ihr Name, Inhalt
 * und Tags kommen mit. Ist der Eintrag gerade im Bearbeiten offen, zählt der
 * lebende Inhalt seines Stapels, nicht der letzte Autosave.
 */
export async function saveEntryAsTemplate(entryType: TemplateEntryType, id: string): Promise<Template | undefined> {
  const entry = entryFields(entryType, id);
  if (!entry) return undefined;
  const session = useBlockSessionStore.getState().session;
  const content = session?.entryId === id && session.isEditing ? serializeBlocks(session.api.liveBlocks()) : entry.content;
  return useTemplateStore.getState().createTemplate(entry.title, {
    content: contentForTemplate(content),
    tags: entry.tags,
  });
}
