/**
 * Was mit den Kopien eines eigenen Blocks in Einträgen und Vorlagen geschieht
 * — nur auf ausdrücklichen Wunsch aus der Blöcke-Ansicht: alle auf den Stand
 * der Definition bringen, oder (beim Löschen, zweite Bestätigung) alle
 * entfernen. Dazu, reaktiv, die Zahlen, die die Blöcke- und die
 * Vorlagen-Ansicht über diese Kopien und Herkünfte zeigen.
 *
 * Geschrieben wird über `update*(id, { content })` der Stores — serialisiert
 * pro Eintrag, mit `syncLinks`, wie jede andere Änderung. Der Eintrag, der
 * gerade bearbeitet wird, bleibt aus: sein Editor hält den Inhalt und schriebe
 * beim nächsten Speichern den Stand von vorher zurück. Ein offener Eintrag im
 * Lesemodus übernimmt den neuen Stand selbst (`BlockStack`).
 *
 * Nur aktive Einträge — was im Papierkorb liegt, behält seine Kopie. Die
 * Änderung zählt wie jede andere: `updated_at` der berührten Einträge springt
 * auf jetzt, nach Änderung sortierte Listen ordnen sie neu ein. Gewollt — ihr
 * Inhalt hat sich geändert.
 *
 * Vorlagen tragen ebenfalls Kopien und werden mitgenommen — sonst brächte eine
 * Vorlage einen entfernten Block in jeden neuen Eintrag zurück. Sie zählen
 * getrennt von den Einträgen. Eine offene Vorlagen-Seite oder ein
 * ungespeicherter Entwurf lässt die Vorlage aus, wie das Bearbeiten einen
 * Eintrag.
 *
 * Welche Module Blöcke tragen, sagt die Registry (`ModuleMeta.usesBlocks`);
 * die Stores dazu stehen hier und nur hier — Zählung, Herkunft und Umschreiben
 * lesen dieselbe Liste.
 */
import { useMemo } from 'react';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useBlockSessionStore } from './blockSessionStore';
import { useTemplateStore } from './templateStore';
import { useTemplateDraftStore } from './draftStore';
import { editorSavesSuspended } from '../lib/editorLock';
import { entryBlockSummary } from '../lib/blocks/entrySummary';
import { hasFrozenCopy, removeCopiesFromContent, updateCopiesInContent, type BlockDefinition } from '../lib/blocks/definitions';
import type { FallbackText } from '../lib/blocks/fields';
import type { TemplateEntryType } from '../lib/blocks/templates';

interface ContentRow {
  id: string;
  content: string;
}

/** Ein aktiver Eintrag mit Blockstapel. */
export interface EntryContentRow extends ContentRow {
  entryType: TemplateEntryType;
  title: string;
  updated_at: string;
}

interface ContentSource extends ContentRow {
  kind: 'entry' | 'template';
  save: (content: string) => Promise<unknown>;
}

function contentSources(): ContentSource[] {
  const journal = useJournalStore.getState();
  const wiki = useWikiStore.getState();
  const ops = useOperationStore.getState();
  const templates = useTemplateStore.getState();
  return [
    ...journal.entries.map((e) => ({ kind: 'entry' as const, id: e.id, content: e.content, save: (content: string) => journal.updateEntry(e.id, { content }) })),
    ...wiki.articles.map((a) => ({ kind: 'entry' as const, id: a.id, content: a.content, save: (content: string) => wiki.updateArticle(a.id, { content }) })),
    ...ops.operations.map((o) => ({ kind: 'entry' as const, id: o.id, content: o.content, save: (content: string) => ops.updateOperation(o.id, { content }) })),
    ...templates.templates.map((tpl) => ({ kind: 'template' as const, id: tpl.id, content: tpl.content, save: (content: string) => templates.updateTemplate(tpl.id, { content }) })),
  ];
}

/** Die Einträge mit Blöcken, reaktiv — für Verwendungszahlen und die Herkunft aus Vorlagen. */
export function useBlockContentRows(): EntryContentRow[] {
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  return useMemo(() => [
    ...entries.map((e) => ({ id: e.id, content: e.content, title: e.title, updated_at: e.updated_at, entryType: 'journal' as const })),
    ...articles.map((a) => ({ id: a.id, content: a.content, title: a.title, updated_at: a.updated_at, entryType: 'wiki' as const })),
    ...operations.map((o) => ({ id: o.id, content: o.content, title: o.title, updated_at: o.updated_at, entryType: 'operation' as const })),
  ], [entries, articles, operations]);
}

export interface CopyUsage {
  /** Einträge mit mindestens einer Kopie. */
  entries: number;
  /** Davon mit mindestens einer Kopie in älterer Revision. */
  outdated: number;
  /** Vorlagen mit mindestens einer Kopie. */
  templates: number;
  /** Davon mit mindestens einer Kopie in älterer Revision. */
  outdatedTemplates: number;
}

/** Je Definition: in wie vielen Einträgen und Vorlagen sie steckt und wie viele davon eine ältere Version tragen. */
export function copyUsage(
  rows: readonly ContentRow[],
  templates: readonly ContentRow[],
  definitions: readonly BlockDefinition[],
): Map<string, CopyUsage> {
  const revisions = new Map(definitions.map((d) => [d.id, d.revision]));
  const usage = new Map<string, CopyUsage>();
  const count = (list: readonly ContentRow[], total: 'entries' | 'templates', older: 'outdated' | 'outdatedTemplates') => {
    for (const row of list) {
      const perRow = new Map<string, boolean>();
      for (const origin of entryBlockSummary(row.id, row.content).origins) {
        const revision = revisions.get(origin.id);
        if (revision === undefined) continue;
        perRow.set(origin.id, (perRow.get(origin.id) ?? false) || origin.rev < revision);
      }
      for (const [id, outdated] of perRow) {
        const u = usage.get(id) ?? { entries: 0, outdated: 0, templates: 0, outdatedTemplates: 0 };
        u[total] += 1;
        if (outdated) u[older] += 1;
        usage.set(id, u);
      }
    }
  };
  count(rows, 'entries', 'outdated');
  count(templates, 'templates', 'outdatedTemplates');
  return usage;
}

/** Je Vorlagen-ID die Einträge mit mindestens einem Block aus ihr, zuletzt geänderte zuerst. */
export function templateEntries(rows: readonly EntryContentRow[]): Map<string, EntryContentRow[]> {
  const byTemplate = new Map<string, EntryContentRow[]>();
  for (const row of rows) {
    for (const id of entryBlockSummary(row.id, row.content).templates) {
      const list = byTemplate.get(id) ?? [];
      list.push(row);
      byTemplate.set(id, list);
    }
  }
  for (const list of byTemplate.values()) list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return byTemplate;
}

export interface CopyRunResult {
  changed: number;
  /** Davon Vorlagen. */
  changedTemplates: number;
  /** Übersprungen, weil gerade im Bearbeitungsmodus. */
  skippedEditing: number;
  /** Vorlagen, übersprungen, weil ihre Seite offen ist oder ein Entwurf wartet. */
  skippedDrafts: number;
  /** Einträge, in denen eine Kopie stehen blieb, weil eine geladene Sigille sie festhält. */
  skippedLocked: number;
  failed: number;
}

async function rewriteAll(defId: string, transform: (content: string) => string | null): Promise<CopyRunResult> {
  const result: CopyRunResult = { changed: 0, changedTemplates: 0, skippedEditing: 0, skippedDrafts: 0, skippedLocked: 0, failed: 0 };
  // Ein Backup-Import tauscht gerade den Vault aus.
  if (editorSavesSuspended()) return result;
  const session = useBlockSessionStore.getState().session;
  const editingId = session?.isEditing ? session.entryId : null;
  const templateDrafts = useTemplateDraftStore.getState().drafts;

  for (const source of contentSources()) {
    // Billiger Vorfilter: ohne die ID steht auch keine Kopie im Inhalt.
    if (!source.content.includes(defId)) continue;
    if (hasFrozenCopy(source.content, defId)) result.skippedLocked += 1;
    const next = transform(source.content);
    if (next === null) continue;
    if (source.kind === 'template' && (source.id === editingId || source.id in templateDrafts)) {
      result.skippedDrafts += 1;
      continue;
    }
    if (source.id === editingId) {
      result.skippedEditing += 1;
      continue;
    }
    try {
      await source.save(next);
      result.changed += 1;
      if (source.kind === 'template') result.changedTemplates += 1;
    } catch (e) {
      console.error('[blockCopies] could not rewrite', source.kind, source.id, e);
      result.failed += 1;
    }
  }
  return result;
}

/** Alle veralteten Kopien auf den Stand der Definition bringen. */
export function updateAllCopies(def: BlockDefinition, text: FallbackText): Promise<CopyRunResult> {
  return rewriteAll(def.id, (content) => updateCopiesInContent(content, def, text));
}

/** Alle Kopien der Definition aus Einträgen und Vorlagen entfernen — nur über ein Backup umkehrbar. */
export function removeAllCopies(defId: string): Promise<CopyRunResult> {
  return rewriteAll(defId, (content) => removeCopiesFromContent(content, defId));
}
