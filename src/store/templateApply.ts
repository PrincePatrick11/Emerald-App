/**
 * Eine Vorlage in einen bestehenden Eintrag bringen — was dafür außerhalb des
 * Blockstapels geschieht: Titel und Tags über den Store des Eintrags (wie die
 * Eigenschaften-Seitenleiste im Bearbeiten, die Views übernehmen den Stand
 * über ihre Sync-Effekte) und „Als Vorlage speichern". Die Blöcke setzt der Stapel selbst
 * (`applyTemplate` im `BlockStack`) — er hält den lebenden Inhalt.
 *
 * Import-Regel wie `blockCopies`: dieser Store liest die Inhalts-Stores und
 * den Vorlagen-Store, keiner von ihnen importiert zurück.
 */
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTemplateStore } from './templateStore';
import { useBlockSessionStore } from './blockSessionStore';
import { createMissingTags, withUsableTags } from '../lib/templateTags';
import { serializeBlocks } from '../lib/blocks/blockHtml';
import {
  contentForTemplate, fieldsWithoutTemplate, fieldsWithTemplate,
  type Template, type TemplateEntryType, type TemplateFields,
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
  /** Die Vorlage, die sie ablöst („Andere Vorlage") — ihre Tags fallen vorher weg. */
  replaces?: Template;
  /** Danach den Hinweis „Vorlage angewendet" zeigen. */
  notice?: boolean;
}

function entryFields(entryType: TemplateEntryType, id: string): (TemplateFields & { content: string }) | undefined {
  switch (entryType) {
    case 'journal': return useJournalStore.getState().entries.find((e) => e.id === id);
    case 'wiki': return useWikiStore.getState().articles.find((a) => a.id === id);
    case 'operation': return useOperationStore.getState().operations.find((o) => o.id === id);
  }
}

function updateFields(entryType: TemplateEntryType, id: string, patch: Partial<TemplateFields>): Promise<void> {
  switch (entryType) {
    case 'journal': return useJournalStore.getState().updateEntry(id, patch);
    case 'wiki': return useWikiStore.getState().updateArticle(id, patch);
    case 'operation': return useOperationStore.getState().updateOperation(id, patch);
  }
}

/** Schreibt nur, was sich an Titel oder Tags geändert hat. */
async function writeChangedFields(entryType: TemplateEntryType, id: string, before: TemplateFields, after: TemplateFields): Promise<void> {
  const patch: Partial<TemplateFields> = {};
  if (after.title !== before.title) patch.title = after.title;
  // Nicht nur die Länge: ein Tausch gegen gleich viele Tags ändert sie nicht.
  if (after.tags.length !== before.tags.length || after.tags.some((tag, i) => tag !== before.tags[i])) patch.tags = after.tags;
  if (Object.keys(patch).length) await updateFields(entryType, id, patch);
}

/**
 * Titel und Tags der Vorlage in den Eintrag (`fieldsWithTemplate`). Der
 * Aufrufer speichert vorher, was im Editor noch nicht gespeichert ist — sonst
 * läse das hier einen älteren Titel, und der Sync der View überschriebe die
 * laufende Eingabe.
 */
export async function applyTemplateFields(
  entryType: TemplateEntryType,
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
  options: TemplateFieldOptions & { replaces?: Pick<Template, 'title'> },
): Promise<void> {
  const fields = entryFields(entryType, id);
  if (!fields) return;
  const usable = withUsableTags(template);
  await createMissingTags(usable.tags);
  await writeChangedFields(entryType, id, fields, fieldsWithTemplate(fields, usable, options));
}

/**
 * Rückgängig nach einer automatisch eingesetzten Vorlage (`fieldsWithoutTemplate`)
 * — bei einem frisch angelegten Eintrag trug er keinen ihrer Tags schon vorher.
 * Die Blöcke leert der Stapel.
 */
export async function undoTemplateFields(
  entryType: TemplateEntryType,
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
): Promise<void> {
  const fields = entryFields(entryType, id);
  if (!fields) return;
  await writeChangedFields(entryType, id, fields, fieldsWithoutTemplate(fields, template));
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
