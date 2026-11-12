/**
 * The templates of the templates dashboard (table `templates`, since v43). A
 * template only takes effect on insertion — what an entry gets is a copy
 * (see `lib/blocks/templates.ts`). Deleting, restoring and changing
 * therefore touch no entry.
 *
 * Per combination (entry kind × category) at most one active template is
 * assigned. This store enforces that, not the database: `assignTemplate` takes
 * the combination from whoever held it. Deleting a template clears its assignments,
 * so it comes back from the trash without them.
 *
 * Import rule as in `blockDefinitionStore`: no content stores — they
 * conversely import this one, to apply a template on creation.
 * All writes run under a shared key: an assignment
 * may affect several rows.
 */
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import { insertTemplateStatement, nextTemplateSortOrder } from '../lib/templateRows';
import { contentOf, loadBlocks, planContentWrite, type BlockOwner } from '../lib/blockStore';
import {
  DEFAULT_TEMPLATE_ICON, matches, resolveAssignedTemplate, templateStart, templateToRow, assignedCategoryId,
  type EntryStart, type Template, type TemplateAssignment, type TemplateEntryType,
} from '../lib/blocks/templates';
import i18n from '../i18n';
import { withUsableTags } from '../lib/templateTags';

export type TemplatePatch = Partial<Pick<Template, 'name' | 'icon' | 'title' | 'content' | 'tags'>>;

/** What a new template brings along. It starts without assignments. */
export type TemplateInit = Omit<TemplatePatch, 'name'>;

interface TemplateState {
  /** Active templates in display order. */
  templates: Template[];

  fetchTemplates: () => Promise<void>;
  createTemplate: (name: string, init?: TemplateInit) => Promise<Template>;
  updateTemplate: (id: string, patch: TemplatePatch, options?: WriteOptions) => Promise<void>;
  /**
   * New entries of this combination start with this template, or with none
   * (`null`). Applies immediately; whoever held the combination loses it.
   */
  assignTemplate: (entryType: TemplateEntryType, category: string | null, templateId: string | null) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  /** Soft delete, without assignments. Entries from this template stay as they are. */
  deleteTemplate: (id: string) => Promise<void>;
  restoreTemplate: (id: string) => Promise<void>;
  permanentlyDeleteTemplate: (id: string) => Promise<void>;
}

const WRITE_KEY = serialKey('template', '*');

async function selectActive(db: Database): Promise<Template[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  // The block stack comes from the block rows (`blocks`).
  const blocks = await loadBlocks(db, 'template', rows.map((r) => String(r.id)));
  return rows.map((r) => {
    const template = fromRow.template(r);
    return { ...template, content: contentOf(blocks.get(template.id) ?? []) };
  });
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],

  fetchTemplates: async () => {
    const db = await getDb();
    set({ templates: await selectActive(db) });
  },

  createTemplate: (name, init = {}) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const now = nowIso();
    const id = generateId();
    const blocks = await planContentWrite(db, { kind: 'template', id }, init.content ?? '', now);
    const template: Template = {
      id,
      name: name.trim(),
      icon: init.icon ?? DEFAULT_TEMPLATE_ICON,
      title: init.title ?? '',
      content: blocks.content,
      tags: init.tags ?? [],
      assignments: [],
      sort_order: await nextTemplateSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    // The row first: its blocks point at it.
    await db.batch([insertTemplateStatement(template), ...blocks.statements]);
    blocks.commit();
    set((s) => ({ templates: [...s.templates, template] }));
    return template;
  }),

  updateTemplate: (id, patch, { touch } = {}) => serialized(WRITE_KEY, async () => {
    const current = get().templates.find((t) => t.id === id);
    if (!current || !needsWrite(current, patch, touch)) return;
    const updated: Template = {
      ...current,
      ...patch,
      name: (patch.name ?? current.name).trim(),
      updated_at: stampFor(current.updated_at, touch),
    };
    const db = await getDb();
    // The block stack only if it is meant to change: as rows, only the blocks
    // that changed, and `content` as what they give — in one transaction.
    const owner: BlockOwner = { kind: 'template', id };
    const blocks = patch.content !== undefined
      ? await planContentWrite(db, owner, patch.content, updated.updated_at)
      : null;
    if (blocks) updated.content = blocks.content;
    const row = templateToRow(updated);
    await db.batch([
      [
        `UPDATE templates
            SET name=$1, icon=$2, title=$3, tags=$4, updated_at=$5${blocks ? ', content=$7' : ''}
          WHERE id=$6`,
        [row.name, row.icon, row.title, row.tags, row.updated_at, id, ...(blocks ? [row.content] : [])],
      ],
      ...(blocks?.statements ?? []),
    ]);
    blocks?.commit();
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? updated : t)) }));
  }),

  assignTemplate: (entryType, category, templateId) => serialized(WRITE_KEY, async () => {
    const holdsIt = (t: Template) => t.assignments.some((a) => matches(a, entryType, category));
    const changed = get().templates.flatMap((t): Template[] => {
      if (t.id === templateId) return holdsIt(t) ? [] : [{ ...t, assignments: [...t.assignments, { entryType, category }] }];
      return holdsIt(t) ? [{ ...t, assignments: t.assignments.filter((a) => !matches(a, entryType, category)) }] : [];
    });
    const db = await getDb();
    await db.batch(changed.map((t) => ['UPDATE templates SET assignments=$1 WHERE id=$2', [templateToRow(t).assignments, t.id]] as const));
    const byId = new Map(changed.map((t) => [t.id, t]));
    set((s) => ({ templates: s.templates.map((t) => byId.get(t.id) ?? t) }));
  }),

  duplicateTemplate: async (id) => {
    const source = get().templates.find((t) => t.id === id);
    if (!source) return undefined;
    return get().createTemplate(source.name + i18n.t('common.copySuffix'), {
      icon: source.icon,
      title: source.title,
      content: source.content,
      tags: source.tags,
    });
  },

  deleteTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    await db.execute("UPDATE templates SET deleted_at=$1, assignments='[]' WHERE id=$2", [nowIso(), id]);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  }),

  restoreTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    // To the end of the list: the old slot may have been taken in the meantime.
    await db.execute(
      'UPDATE templates SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [await nextTemplateSortOrder(db), id]
    );
    set({ templates: await selectActive(db) });
  }),

  permanentlyDeleteTemplate: async (id) => {
    const db = await getDb();
    // Reachable only from the trash — it is not in `templates` (active).
    await db.execute('DELETE FROM templates WHERE id=$1', [id]);
  },
}));

/**
 * What a new entry starts with: the template assigned to its combination (see
 * `resolveAssignedTemplate`) — or none with `blank`. For the `create*` actions of
 * the content stores; imports and duplicates pass `blank`, since they overwrite
 * the content anyway.
 */
export function startOfNewEntry(
  entryType: TemplateEntryType,
  categoryId: string | null,
  blank = false,
): EntryStart {
  const template = blank ? null : resolveAssignedTemplate(useTemplateStore.getState().templates, entryType, categoryId);
  return withUsableTags(templateStart(template));
}

/** A template just applied automatically — the entry's block stack shows Undo for it. */
export interface AppliedTemplateNotice {
  entryId: string;
  templateId: string;
}

interface TemplateNoticeState {
  notice: AppliedTemplateNotice | null;
  show: (notice: AppliedTemplateNotice) => void;
  /** Only if the notice still belongs to this entry. */
  dismiss: (entryId: string) => void;
}

/**
 * The one "Template applied" notice. Here instead of at the block stack, because the
 * content stores set it on creation and must not import a component.
 * A new notice replaces the old one — there is only ever one
 * freshly created entry.
 */
export const useTemplateNoticeStore = create<TemplateNoticeState>((set, get) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: (entryId) => {
    if (get().notice?.entryId === entryId) set({ notice: null });
  },
}));

/**
 * Removes permanently deleted categories from the assignments in memory — the
 * counterpart to `dropCategoryFromTemplates` in the database.
 */
export function dropCategoriesFromTemplatesInMemory(ids: ReadonlySet<string>): void {
  const dropped = (a: TemplateAssignment) => {
    const category = assignedCategoryId(a);
    return category !== null && ids.has(category);
  };
  useTemplateStore.setState((s) => ({
    templates: s.templates.map((t) => (t.assignments.some(dropped)
      ? { ...t, assignments: t.assignments.filter((a) => !dropped(a)) }
      : t)),
  }));
}
