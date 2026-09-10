/**
 * Was mit den Kopien eines eigenen Blocks in Einträgen geschieht — nur auf
 * ausdrücklichen Wunsch aus der Blöcke-Ansicht: alle auf den Stand der
 * Definition bringen, oder (beim Löschen, zweite Bestätigung) alle entfernen.
 *
 * Geschrieben wird über `update*(id, { content })` der drei Stores —
 * serialisiert pro Eintrag, mit `syncLinks`, wie jede andere Änderung. Der
 * Eintrag, der gerade bearbeitet wird, bleibt aus: sein Editor hält den Inhalt
 * und schriebe beim nächsten Speichern den Stand von vorher zurück. Ein offener
 * Eintrag im Lesemodus übernimmt den neuen Stand selbst (`BlockStack`).
 *
 * Nur aktive Einträge — was im Papierkorb liegt, behält seine Kopie. Die
 * Änderung zählt wie jede andere: `updated_at` der berührten Einträge springt
 * auf jetzt, nach Änderung sortierte Listen ordnen sie neu ein. Gewollt — ihr
 * Inhalt hat sich geändert.
 *
 * Welche Module Blöcke tragen, sagt die Registry (`ModuleMeta.usesBlocks`);
 * die Stores dazu stehen hier und nur hier — Zählung und Umschreiben lesen
 * dieselbe Liste.
 */
import { useMemo } from 'react';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useBlockSessionStore } from './blockSessionStore';
import { editorSavesSuspended } from '../lib/editorLock';
import { entryBlockSummary } from '../lib/blocks/entrySummary';
import { removeCopiesFromContent, updateCopiesInContent, type BlockDefinition } from '../lib/blocks/definitions';
import type { FallbackText } from '../lib/blocks/fields';

interface ContentRow {
  id: string;
  content: string;
}

interface ContentSource extends ContentRow {
  save: (content: string) => Promise<void>;
}

function contentSources(): ContentSource[] {
  const journal = useJournalStore.getState();
  const wiki = useWikiStore.getState();
  const ops = useOperationStore.getState();
  return [
    ...journal.entries.map((e) => ({ id: e.id, content: e.content, save: (content: string) => journal.updateEntry(e.id, { content }) })),
    ...wiki.articles.map((a) => ({ id: a.id, content: a.content, save: (content: string) => wiki.updateArticle(a.id, { content }) })),
    ...ops.operations.map((o) => ({ id: o.id, content: o.content, save: (content: string) => ops.updateOperation(o.id, { content }) })),
  ];
}

/** Die Inhalte aller Einträge mit Blöcken, reaktiv — für die Verwendungszahlen der Blöcke-Ansicht. */
export function useBlockContentRows(): ContentRow[] {
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  return useMemo(() => [...entries, ...articles, ...operations], [entries, articles, operations]);
}

export interface CopyUsage {
  /** Einträge mit mindestens einer Kopie. */
  entries: number;
  /** Davon mit mindestens einer Kopie in älterer Revision. */
  outdated: number;
}

/** Pro Definition: in wie vielen Einträgen sie steckt und wie viele davon eine ältere Version tragen. */
export function copyUsage(rows: readonly ContentRow[], definitions: readonly BlockDefinition[]): Map<string, CopyUsage> {
  const revisions = new Map(definitions.map((d) => [d.id, d.revision]));
  const usage = new Map<string, CopyUsage>();
  for (const row of rows) {
    const perEntry = new Map<string, boolean>();
    for (const origin of entryBlockSummary(row.id, row.content).origins) {
      const revision = revisions.get(origin.id);
      if (revision === undefined) continue;
      perEntry.set(origin.id, (perEntry.get(origin.id) ?? false) || origin.rev < revision);
    }
    for (const [id, outdated] of perEntry) {
      const u = usage.get(id) ?? { entries: 0, outdated: 0 };
      u.entries += 1;
      if (outdated) u.outdated += 1;
      usage.set(id, u);
    }
  }
  return usage;
}

export interface CopyRunResult {
  changed: number;
  /** Übersprungen, weil gerade im Bearbeitungsmodus. */
  skippedEditing: number;
  failed: number;
}

async function rewriteAll(defId: string, transform: (content: string) => string | null): Promise<CopyRunResult> {
  const result: CopyRunResult = { changed: 0, skippedEditing: 0, failed: 0 };
  // Ein Backup-Import tauscht gerade den Vault aus.
  if (editorSavesSuspended()) return result;
  const session = useBlockSessionStore.getState().session;
  const editingId = session?.isEditing ? session.entryId : null;

  for (const source of contentSources()) {
    // Billiger Vorfilter: ohne die ID steht auch keine Kopie im Inhalt.
    if (!source.content.includes(defId)) continue;
    const next = transform(source.content);
    if (next === null) continue;
    if (source.id === editingId) {
      result.skippedEditing += 1;
      continue;
    }
    try {
      await source.save(next);
      result.changed += 1;
    } catch (e) {
      console.error('[blockCopies] could not rewrite entry', source.id, e);
      result.failed += 1;
    }
  }
  return result;
}

/** Alle veralteten Kopien auf den Stand der Definition bringen. */
export function updateAllCopies(def: BlockDefinition, text: FallbackText): Promise<CopyRunResult> {
  return rewriteAll(def.id, (content) => updateCopiesInContent(content, def, text));
}

/** Alle Kopien der Definition aus den Einträgen entfernen — nur über ein Backup umkehrbar. */
export function removeAllCopies(defId: string): Promise<CopyRunResult> {
  return rewriteAll(defId, (content) => removeCopiesFromContent(content, defId));
}
