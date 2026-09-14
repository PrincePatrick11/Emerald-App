/**
 * Die Vorlagen des Vorlagen-Dashboards (Tabelle `templates`, seit v43). Eine
 * Vorlage wirkt nur beim Einsetzen — was ein Eintrag bekommt, ist eine Kopie
 * (siehe `lib/blocks/templates.ts`). Löschen, Wiederherstellen und Ändern
 * berühren deshalb keinen Eintrag.
 *
 * Je Kombination (Eintragsart × Kategorie) gibt es höchstens einen Standard
 * unter den aktiven Vorlagen. Das hält dieser Store, nicht die Datenbank: wer
 * einen Stern setzt, nimmt ihn der bisherigen Vorlage weg; eine Vorlage aus
 * dem Papierkorb verliert ihren Stern, wenn inzwischen eine andere die
 * Kombination hält.
 *
 * Import-Regel wie `blockDefinitionStore`: keine Inhalts-Stores — die
 * importieren umgekehrt diesen, um beim Anlegen den Standard einzusetzen.
 * Alle Schreibzugriffe laufen unter einem gemeinsamen Schlüssel: ein Standard
 * betrifft immer mehrere Zeilen.
 */
import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import { insertTemplateRow, nextTemplateSortOrder, templateById } from '../lib/templateRows';
import {
  assignmentKey, DEFAULT_TEMPLATE_ICON, defaultKeys, parseAssignments, resolveDefaultTemplate, templateStart, templateToRow,
  ALL_CATEGORIES, assignedCategoryId, withDefaultAt, withoutDefaultsFor,
  type EntryStart, type Template, type TemplateAssignment, type TemplateEntryType,
} from '../lib/blocks/templates';
import i18n from '../i18n';

export type TemplatePatch = Partial<Pick<Template, 'name' | 'icon' | 'description' | 'title' | 'content' | 'tags' | 'assignments'>>;

/** Was eine neue Vorlage mitbringt. Sterne (`isDefault`) werden dabei verworfen — die setzt nur `updateTemplate`. */
export type TemplateInit = Omit<TemplatePatch, 'name'>;

interface TemplateState {
  /** Aktive Vorlagen in Anzeigereihenfolge. */
  templates: Template[];

  fetchTemplates: () => Promise<void>;
  createTemplate: (name: string, init?: TemplateInit) => Promise<Template>;
  /**
   * Speichert die Änderung. Setzt sie einen Standard, verlieren andere aktive
   * Vorlagen ihn für dieselbe Kombination — die liefert die Funktion zurück,
   * damit die Oberfläche sagen kann, wen es betraf.
   */
  updateTemplate: (id: string, patch: TemplatePatch) => Promise<Template[]>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  /**
   * Der Standard einer Kombination aus der Gesamtübersicht: `templateId`
   * bekommt den Stern (und die Zuweisung, falls sie fehlt), wer ihn bisher
   * hielt, verliert ihn — seine Zuweisung bleibt. `null` nimmt den Stern nur weg.
   */
  setDefaultFor: (entryType: TemplateEntryType, category: string | null, templateId: string | null) => Promise<void>;
  /** Soft-Delete. Einträge aus dieser Vorlage bleiben, wie sie sind. */
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

/** Nimmt `others` den Standard für `keys` weg und schreibt die betroffenen Zeilen. */
async function clearDefaults(db: Database, others: readonly Template[], keys: ReadonlySet<string>): Promise<Template[]> {
  const changed: Template[] = [];
  if (keys.size === 0) return changed;
  for (const other of others) {
    const assignments = withoutDefaultsFor(other.assignments, keys);
    if (assignments.every((a, i) => a === other.assignments[i])) continue;
    await db.execute('UPDATE templates SET assignments=$1 WHERE id=$2', [templateToRow({ ...other, assignments }).assignments, other.id]);
    changed.push({ ...other, assignments });
  }
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
      description: init.description ?? '',
      title: init.title ?? '',
      content: init.content ?? '',
      tags: init.tags ?? [],
      // Eine neue Vorlage nimmt niemandem einen Standard weg — Sterne setzt nur `updateTemplate`.
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

  updateTemplate: (id, patch) => serialized(WRITE_KEY, async () => {
    const current = get().templates.find((t) => t.id === id);
    if (!current) return [];
    const updated: Template = {
      ...current,
      ...patch,
      name: (patch.name ?? current.name).trim(),
      assignments: patch.assignments ? parseAssignments(patch.assignments) : current.assignments,
      updated_at: nowIso(),
    };
    const db = await getDb();
    const row = templateToRow(updated);
    await db.execute(
      `UPDATE templates
          SET name=$1, icon=$2, description=$3, title=$4, content=$5, tags=$6, assignments=$7, updated_at=$8
        WHERE id=$9`,
      [row.name, row.icon, row.description, row.title, row.content, row.tags, row.assignments, row.updated_at, id]
    );
    // Nur neu gesetzte Sterne verdrängen — ein unveränderter hält seine Kombination ohnehin schon.
    const before = defaultKeys(current.assignments);
    const added = new Set([...defaultKeys(updated.assignments)].filter((key) => !before.has(key)));
    const replaced = await clearDefaults(db, get().templates.filter((t) => t.id !== id), added);
    const byId = new Map(replaced.map((t) => [t.id, t]));
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? updated : byId.get(t.id) ?? t)),
    }));
    return replaced;
  }),

  duplicateTemplate: async (id) => {
    const source = get().templates.find((t) => t.id === id);
    if (!source) return undefined;
    // Ohne Sterne: zwei Standards für dieselbe Kombination gibt es nicht.
    return get().createTemplate(source.name + i18n.t('common.copySuffix'), {
      icon: source.icon,
      description: source.description,
      title: source.title,
      content: source.content,
      tags: source.tags,
      assignments: source.assignments,
    });
  },

  setDefaultFor: (entryType, category, templateId) => serialized(WRITE_KEY, async () => {
    // Journal kennt nur „alle Kategorien" — sonst entstünden zwei Journal-Standards.
    const cat = entryType === 'journal' ? ALL_CATEGORIES : category;
    const { templates } = get();
    const target = templateId ? templates.find((t) => t.id === templateId) : undefined;
    // Inzwischen gelöscht: nichts ändern, statt nur den bisherigen Stern zu nehmen.
    if (templateId && !target) return;
    const db = await getDb();
    const changed = await clearDefaults(db, templates.filter((t) => t !== target), new Set([assignmentKey(entryType, cat)]));
    if (target) {
      const assignments = withDefaultAt(target.assignments, entryType, cat);
      if (JSON.stringify(assignments) !== JSON.stringify(target.assignments)) {
        await db.execute('UPDATE templates SET assignments=$1 WHERE id=$2', [templateToRow({ ...target, assignments }).assignments, target.id]);
        changed.push({ ...target, assignments });
      }
    }
    const byId = new Map(changed.map((t) => [t.id, t]));
    if (byId.size) set((s) => ({ templates: s.templates.map((t) => byId.get(t.id) ?? t) }));
  }),

  deleteTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    await db.execute('UPDATE templates SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  }),

  restoreTemplate: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const template = await templateById(db, id);
    if (!template) return;
    // Sterne, die inzwischen eine andere Vorlage trägt, bleiben bei ihr.
    const taken = new Set(get().templates.filter((t) => t.id !== id).flatMap((t) => [...defaultKeys(t.assignments)]));
    const assignments = withoutDefaultsFor(template.assignments, taken);
    // Ans Ende der Liste: der alte Platz ist inzwischen womöglich vergeben.
    await db.execute(
      'UPDATE templates SET deleted_at=NULL, sort_order=$1, assignments=$2 WHERE id=$3',
      [await nextTemplateSortOrder(db), templateToRow({ ...template, assignments }).assignments, id]
    );
    set({ templates: await selectActive(db) });
  }),

  permanentlyDeleteTemplate: async (id) => {
    const db = await getDb();
    // Nur aus dem Papierkorb erreichbar — in `templates` (aktive) steht sie nicht.
    await db.execute('DELETE FROM templates WHERE id=$1', [id]);
  },
}));

/**
 * Womit ein neuer Eintrag beginnt: der Standard seiner Kombination (siehe
 * `resolveDefaultTemplate`) — oder, mit `blank`, gar keine Vorlage. Für die
 * `create*`-Aktionen der Inhalts-Stores; Importe und Duplikate übergeben
 * `blank`, sie überschreiben den Inhalt ohnehin.
 */
export function startOfNewEntry(
  entryType: TemplateEntryType,
  categoryId: string | null,
  fallbackTitle: string,
  blank = false,
): EntryStart {
  const template = blank ? null : resolveDefaultTemplate(useTemplateStore.getState().templates, entryType, categoryId);
  return templateStart(template, fallbackTitle);
}

/**
 * Nimmt endgültig gelöschte Kategorien aus den Zuweisungen im Speicher — das
 * Gegenstück zu `dropCategoryFromTemplates` in der Datenbank.
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
