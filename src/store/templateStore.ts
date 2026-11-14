/**
 * The templates of the templates dashboard (table `templates`, since v43). A
 * template only takes effect on insertion — what an entry gets is a copy
 * (see `lib/blocks/templates.ts`). Deleting, restoring and changing
 * therefore touch no entry.
 *
 * Which template a new entry starts with is said by its category
 * (`categories.template_id`) and the vault's default template (setting
 * `templates.defaultTemplateId`); a template in the trash counts as none, so
 * it comes back from there with its categories.
 *
 * Import rule as in `blockDefinitionStore`: no content stores — they
 * conversely import this one, to apply a template on creation.
 * All writes run under a shared key.
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
  DEFAULT_TEMPLATE_ICON, resolveStartTemplate, templateStart, templateToRow,
  type EntryStart, type Template,
} from '../lib/blocks/templates';
import i18n from '../i18n';
import { withUsableTags } from '../lib/templateTags';
import { useSettingsStore } from './settingsStore';

export type TemplatePatch = Partial<Pick<Template, 'name' | 'icon' | 'title' | 'content' | 'tags'>>;

/** What a new template brings along. */
export type TemplateInit = Omit<TemplatePatch, 'name'>;

interface TemplateState {
  /** Active templates in display order. */
  templates: Template[];

  fetchTemplates: () => Promise<void>;
  createTemplate: (name: string, init?: TemplateInit) => Promise<Template>;
  updateTemplate: (id: string, patch: TemplatePatch, options?: WriteOptions) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  /** Soft delete. Entries from this template stay as they are; its categories fall back to the default meanwhile. */
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
            SET name=$1, icon=$2, title=$3, tags=$4, updated_at=$5
          WHERE id=$6`,
        [row.name, row.icon, row.title, row.tags, row.updated_at, id],
      ],
      ...(blocks?.statements ?? []),
    ]);
    blocks?.commit();
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? updated : t)) }));
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
    await db.execute('UPDATE templates SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
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
    // Its categories lose it by ON DELETE SET NULL; the default setting here.
    await db.execute('DELETE FROM templates WHERE id=$1', [id]);
    const settings = useSettingsStore.getState();
    if (settings.settings.templates.defaultTemplateId === id) await settings.update('templates', { defaultTemplateId: null });
  },
}));

/**
 * What a new entry starts with: the start template of its category, else the
 * vault's default (`resolveStartTemplate`) — or none with `blank`. For
 * `createEntry`, which reads the category's `template_id`; imports and
 * duplicates pass `blank`, since they overwrite the content anyway.
 */
export function startOfNewEntry(categoryTemplateId: string | null, blank = false): EntryStart {
  const template = blank ? null : resolveStartTemplate(
    useTemplateStore.getState().templates,
    { template_id: categoryTemplateId },
    useSettingsStore.getState().settings.templates.defaultTemplateId,
  );
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
