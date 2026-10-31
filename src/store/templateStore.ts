/**
 * The templates of the templates dashboard (table `templates`, since v43). A
 * template only takes effect on insertion — what an entry gets is a copy
 * (see `lib/blocks/templates.ts`). Deleting, restoring and changing
 * therefore touch no entry.
 *
 * Per combination (entry kind × category) there is at most one default
 * among the active templates. This store enforces that, not the database: whoever
 * sets a star takes it from the previous template; a template from
 * the trash loses its star if another one has meanwhile taken the
 * combination.
 *
 * Import rule as in `blockDefinitionStore`: no content stores — they
 * conversely import this one, to apply the default on creation.
 * All writes run under a shared key: a default
 * always affects several rows.
 */
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import { insertTemplateRow, nextTemplateSortOrder, templateById } from '../lib/templateRows';
import {
  DEFAULT_TEMPLATE_ICON, defaultKeys, parseAssignments, resolveDefaultTemplate, templateStart, templateToRow,
  assignedCategoryId, withoutDefaultsFor,
  type EntryStart, type Template, type TemplateAssignment, type TemplateEntryType,
} from '../lib/blocks/templates';
import i18n from '../i18n';
import { useSettingsStore } from './settingsStore';
import { withUsableTags } from '../lib/templateTags';

export type TemplatePatch = Partial<Pick<Template, 'name' | 'icon' | 'title' | 'content' | 'tags' | 'assignments'>>;

/** What a new template brings along. Stars (`isDefault`) are discarded in the process — only `updateTemplate` sets them. */
export type TemplateInit = Omit<TemplatePatch, 'name'>;

interface TemplateState {
  /** Active templates in display order. */
  templates: Template[];

  fetchTemplates: () => Promise<void>;
  createTemplate: (name: string, init?: TemplateInit) => Promise<Template>;
  /**
   * Saves the change. If it sets a default, other active
   * templates lose it for the same combination.
   */
  updateTemplate: (id: string, patch: TemplatePatch, options?: WriteOptions) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  /** Soft delete. Entries from this template stay as they are. */
  deleteTemplate: (id: string) => Promise<void>;
  restoreTemplate: (id: string) => Promise<void>;
  permanentlyDeleteTemplate: (id: string) => Promise<void>;
}

const WRITE_KEY = serialKey('template', '*');

async function selectActive(db: Database): Promise<Template[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(fromRow.template);
}

/** Takes the default for `keys` away from `others` and writes the affected rows. */
async function clearDefaults(db: Database, others: readonly Template[], keys: ReadonlySet<string>): Promise<Template[]> {
  const changed: Template[] = [];
  if (keys.size === 0) return changed;
  for (const other of others) {
    const assignments = withoutDefaultsFor(other.assignments, keys);
    if (assignments.every((a, i) => a === other.assignments[i])) continue;
    changed.push({ ...other, assignments });
  }
  await db.batch(changed.map((t) => ['UPDATE templates SET assignments=$1 WHERE id=$2', [templateToRow(t).assignments, t.id]] as const));
  return changed;
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
    const template: Template = {
      id: generateId(),
      name: name.trim(),
      icon: init.icon ?? DEFAULT_TEMPLATE_ICON,
      title: init.title ?? '',
      content: init.content ?? '',
      tags: init.tags ?? [],
      // A new template takes no default from anyone — only `updateTemplate` sets stars.
      assignments: parseAssignments(init.assignments ?? []).map((a) => ({ ...a, isDefault: false })),
      sort_order: await nextTemplateSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await insertTemplateRow(db, template);
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
      assignments: patch.assignments ? parseAssignments(patch.assignments) : current.assignments,
      updated_at: stampFor(current.updated_at, touch),
    };
    const db = await getDb();
    const row = templateToRow(updated);
    await db.execute(
      `UPDATE templates
          SET name=$1, icon=$2, title=$3, content=$4, tags=$5, assignments=$6, updated_at=$7
        WHERE id=$8`,
      [row.name, row.icon, row.title, row.content, row.tags, row.assignments, row.updated_at, id]
    );
    // Only newly set stars displace others — an unchanged one already holds its combination anyway.
    const before = defaultKeys(current.assignments);
    const added = new Set([...defaultKeys(updated.assignments)].filter((key) => !before.has(key)));
    const replaced = await clearDefaults(db, get().templates.filter((t) => t.id !== id), added);
    const byId = new Map(replaced.map((t) => [t.id, t]));
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? updated : byId.get(t.id) ?? t)),
    }));
  }),

  duplicateTemplate: async (id) => {
    const source = get().templates.find((t) => t.id === id);
    if (!source) return undefined;
    // Without stars: there are no two defaults for the same combination.
    return get().createTemplate(source.name + i18n.t('common.copySuffix'), {
      icon: source.icon,
      title: source.title,
      content: source.content,
      tags: source.tags,
      assignments: source.assignments,
    });
  },

  deleteTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    await db.execute('UPDATE templates SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  }),

  restoreTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const template = await templateById(db, id);
    if (!template) return;
    // Stars that another template has taken in the meantime stay with it.
    const taken = new Set(get().templates.filter((t) => t.id !== id).flatMap((t) => [...defaultKeys(t.assignments)]));
    const assignments = withoutDefaultsFor(template.assignments, taken);
    // To the end of the list: the old slot may have been taken in the meantime.
    await db.execute(
      'UPDATE templates SET deleted_at=NULL, sort_order=$1, assignments=$2 WHERE id=$3',
      [await nextTemplateSortOrder(db), templateToRow({ ...template, assignments }).assignments, id]
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
 * What a new entry starts with: the default of its combination (see
 * `resolveDefaultTemplate`) — or no template at all: with `blank`, or if
 * the vault does not apply defaults by itself (setting). For the
 * `create*` actions of the content stores; imports and duplicates pass
 * `blank`, since they overwrite the content anyway.
 */
export function startOfNewEntry(
  entryType: TemplateEntryType,
  categoryId: string | null,
  blank = false,
): EntryStart {
  const apply = !blank && useSettingsStore.getState().settings.templates.applyDefault;
  const template = !apply ? null : resolveDefaultTemplate(useTemplateStore.getState().templates, entryType, categoryId);
  return withUsableTags(templateStart(template));
}

/** A template just applied automatically — the entry's block stack shows Undo and "Other template" for it. */
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
