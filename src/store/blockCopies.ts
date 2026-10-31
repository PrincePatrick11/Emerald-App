/**
 * What happens to the copies of a custom block in entries and templates
 * — only on explicit request from the blocks view: bring all of them to the
 * state of the definition, or (on delete, second confirmation) remove all of
 * them. Plus, reactively, the numbers that the blocks and templates views
 * show about these copies and origins.
 *
 * Writing goes through the stores' `update*(id, { content })` — serialized
 * per entry, like any other change. The entry that is currently being
 * edited is skipped: its editor holds the content and would write the
 * earlier state back on the next save. An open entry in read mode picks up
 * the new state itself (`BlockStack`).
 *
 * Active entries only — whatever is in the trash keeps its copy. The
 * change is a consequence of the block, not a change to the entries themselves:
 * "Last modified" stays (`AS_A_CONSEQUENCE`, `lib/stamp.ts`), and lists sorted
 * by modification stay as they were.
 *
 * Templates also carry copies and are taken along — otherwise a template
 * would bring a removed block back into every new entry. They are counted
 * separately from the entries. An open template page or an unsaved draft
 * leaves the template out, as editing does for an entry.
 *
 * Which modules carry blocks is stated by the registry (`ModuleMeta.usesBlocks`);
 * the stores for them are listed here and only here — counting, origin and
 * rewriting read the same list.
 */
import { useMemo } from 'react';
import { useEntryStore, allEntries, whenEntryContentLoaded } from './entryStore';
import { AS_A_CONSEQUENCE } from '../lib/stamp';
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

/** An active entry with a block stack. */
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
  const { entries, updateEntry } = useEntryStore.getState();
  const templates = useTemplateStore.getState();
  return [
    ...allEntries(entries).map((e) => ({ kind: 'entry' as const, id: e.id, content: e.content, save: (content: string) => updateEntry(e.id, { content }, AS_A_CONSEQUENCE) })),
    ...templates.templates.map((tpl) => ({ kind: 'template' as const, id: tpl.id, content: tpl.content, save: (content: string) => templates.updateTemplate(tpl.id, { content }, AS_A_CONSEQUENCE) })),
  ];
}

/** The entries with blocks, reactive — for usage counts and the origin from templates. */
export function useBlockContentRows(): EntryContentRow[] {
  const entries = useEntryStore((s) => s.entries);
  return useMemo(() => allEntries(entries).map((e) => ({
    id: e.id, content: e.content, title: e.title, updated_at: e.updated_at, entryType: e.type,
  })), [entries]);
}

export interface CopyUsage {
  /** Entries with at least one copy. */
  entries: number;
  /** Of those, with at least one copy in an older revision. */
  outdated: number;
  /** Templates with at least one copy. */
  templates: number;
  /** Of those, with at least one copy in an older revision. */
  outdatedTemplates: number;
}

/** Per definition: in how many entries and templates it appears and how many of those carry an older version. */
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

/** Per template ID, the entries with at least one block from it, most recently modified first. */
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
  /** Of those, templates. */
  changedTemplates: number;
  /** Skipped because currently in edit mode. */
  skippedEditing: number;
  /** Templates skipped because their page is open or a draft is pending. */
  skippedDrafts: number;
  /** Entries in which a copy was left in place because a loaded sigil holds it. */
  skippedLocked: number;
  failed: number;
}

async function rewriteAll(defId: string, transform: (content: string) => string | null): Promise<CopyRunResult> {
  const result: CopyRunResult = { changed: 0, changedTemplates: 0, skippedEditing: 0, skippedDrafts: 0, skippedLocked: 0, failed: 0 };
  // A backup import is replacing the vault right now.
  if (editorSavesSuspended()) return result;
  // Across all contents: one that has not been loaded yet (`pendingContent`) is
  // empty and would seemingly contain no copy.
  await whenEntryContentLoaded();
  const session = useBlockSessionStore.getState().session;
  const editingId = session?.isEditing ? session.entryId : null;
  const templateDrafts = useTemplateDraftStore.getState().drafts;

  for (const source of contentSources()) {
    // Cheap pre-filter: without the ID, no copy is in the content either.
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

/** Bring all outdated copies to the state of the definition. */
export function updateAllCopies(def: BlockDefinition, text: FallbackText): Promise<CopyRunResult> {
  return rewriteAll(def.id, (content) => updateCopiesInContent(content, def, text));
}

/** Remove all copies of the definition from entries and templates — reversible only via a backup. */
export function removeAllCopies(defId: string): Promise<CopyRunResult> {
  return rewriteAll(defId, (content) => removeCopiesFromContent(content, defId));
}
