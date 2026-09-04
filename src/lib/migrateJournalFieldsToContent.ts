import type Database from '@tauri-apps/plugin-sql';
import i18n from '../i18n';
import { categoryLabel } from './categories';
import { isImageIcon } from './helpers';
import { linkItemKey } from './linkItems';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import {
  extractInternalLinks,
  internalLinkBlockHtml,
  isBlankContent,
  plainBlockHtml,
  type InternalLinkChip,
} from './internalLinkHtml';

/**
 * Migration v37 — die drei festen Journal-Felder Paradigma, Bannung und
 * Meditation werden zu Link-Chips im Inhalt.
 *
 * Sie waren Dropdowns in der rechten Seitenleiste und Chips unter dem Titel,
 * jedes auf eine Wiki-Kategorie festgelegt. Beides ist weg: Ein Journal-Eintrag
 * verlinkt jetzt frei, und das Verlinkungs-Feld zeigt die Ziele nach Kategorie
 * sortiert — womit Paradigma, Bannung und Meditation dort weiterhin
 * beieinanderstehen, nur ohne eigenes Feld.
 *
 * Derselbe Umzug wie bei v36 (`linked_operation_ids`/`linked_wiki_ids`), mit
 * zwei Eigenheiten:
 * - Die Meditationsdauer hat kein Link-Ziel. Sie wandert als Text hinter den
 *   Chip: „Stilles Sitzen (20 min)".
 * - `is_bannung`/`is_meditation` konnten ohne Artikel gesetzt sein (der Haken
 *   ist älter als die Auswahl dahinter). Dann bleibt nur ein Absatz mit dem
 *   Namen der Kategorie — ein Chip ohne Ziel wäre ein toter Link.
 * Ein Feld, dessen Artikel im Papierkorb liegt oder gelöscht wurde, fällt weg;
 * wie in v36 wird ein verschwundenes Ziel nicht als Chip verewigt.
 *
 * Die Spalten bleiben im Schema (Backup-Wiederherstellung und die
 * Integritätsprüfung kennen sie), werden hier aber geleert.
 */

interface EntryRow {
  id: string;
  content: string | null;
  paradigm_id: string | null;
  is_bannung: number | null;
  bannung_type_wiki_id: string | null;
  is_meditation: number | null;
  meditation_duration: number | null;
  meditation_type_wiki_id: string | null;
}

interface ArticleRow {
  id: string;
  title: string | null;
  icon: string | null;
  category_id: string | null;
  entry_number: number | null;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
  is_builtin: number;
}

/**
 * Die drei abgelösten Felder in der Reihenfolge, in der sie in der Seitenleiste
 * standen — Schlüssel ist zugleich die ID ihrer Wiki-Kategorie. `fallbackName`
 * greift nur, wenn es die Kategorie-Zeile selbst nicht mehr gibt; sonst kommt
 * der Anzeigename aus dem Locale-Key.
 *
 * Exportiert, weil der `.emerald`-/Markdown-Import dieselbe Kenntnis braucht:
 * eine Datei von vor v37 trägt diese Felder im Kopf und soll dort dieselben
 * Blöcke ergeben wie die Migration hier.
 */
export const LEGACY_JOURNAL_FIELDS = {
  paradigm: { emoji: '🌀', fallbackName: 'Paradigma' },
  bannung: { emoji: '🚫', fallbackName: 'Bannung' },
  meditation: { emoji: '🧘', fallbackName: 'Meditation' },
} as const;

export type LegacyJournalField = keyof typeof LEGACY_JOURNAL_FIELDS;

const FIELD_ORDER: LegacyJournalField[] = ['paradigm', 'bannung', 'meditation'];

export async function migrateJournalFieldsToContent(db: Database): Promise<void> {
  const entries = await db.select<EntryRow[]>(
    `SELECT id, content, paradigm_id, is_bannung, bannung_type_wiki_id,
            is_meditation, meditation_duration, meditation_type_wiki_id
       FROM journal_entries
      WHERE paradigm_id IS NOT NULL
         OR bannung_type_wiki_id IS NOT NULL
         OR meditation_type_wiki_id IS NOT NULL
         OR is_bannung = 1
         OR is_meditation = 1`
  );
  if (entries.length === 0) return;

  const [articleRows, categoryRows] = await Promise.all([
    db.select<ArticleRow[]>(
      'SELECT id, title, icon, category_id, entry_number FROM wiki_articles WHERE deleted_at IS NULL'
    ),
    db.select<CategoryRow[]>('SELECT id, name, emoji, is_builtin FROM wiki_categories'),
  ]);
  const articles = new Map(articleRows.map((a) => [a.id, a]));
  const categories = new Map(categoryRows.map((c) => [c.id, c]));

  const t = i18n.t;

  for (const entry of entries) {
    const content = entry.content ?? '';
    const alreadyLinked = new Set(extractInternalLinks(content).map(linkItemKey));
    let separator = !isBlankContent(content);
    let appended = '';

    // Was jedes Feld zu sagen hat: eine Artikel-ID, ein „war gesetzt"-Flag und
    // beim Meditations-Feld die Dauer. Erst hier zusammengetragen, damit die
    // Schleife darunter alle drei gleich behandelt.
    const values: Record<LegacyJournalField, { id: string | null; active: boolean; suffix?: string }> = {
      paradigm: { id: entry.paradigm_id, active: !!entry.paradigm_id },
      bannung: {
        id: entry.bannung_type_wiki_id,
        active: !!entry.is_bannung || !!entry.bannung_type_wiki_id,
      },
      meditation: {
        id: entry.meditation_type_wiki_id,
        active: !!entry.is_meditation || !!entry.meditation_type_wiki_id,
        suffix: entry.meditation_duration ? `(${entry.meditation_duration} min)` : undefined,
      },
    };

    for (const key of FIELD_ORDER) {
      const { id, active, suffix } = values[key];
      if (!active) continue;

      const field = LEGACY_JOURNAL_FIELDS[key];
      const article = id ? articles.get(id) : undefined;
      const cat = categories.get(article?.category_id ?? key);
      // Eingebaute Wiki-Kategorien liegen mit deutschem Seed-Namen in der DB;
      // der Anzeigename kommt aus dem Locale-Key. Ohne diesen Umweg stünde in
      // einem englischen Vault dauerhaft „Bannung" im Eintrag. Ohne
      // Kategorie-Zeile bleibt der Name leer — lieber keine Überschrift als
      // eine erfundene.
      const label = categoryLabel(
        t, 'wiki',
        cat ? { id: cat.id, name: cat.name, is_builtin: !!cat.is_builtin } : undefined,
      );

      if (!article) {
        // Gesetzt, aber ohne Artikel dahinter — nur der Name der Kategorie.
        // Ein `paradigm_id`, dessen Artikel gelöscht wurde, fällt hier ebenfalls
        // heraus: `active` ist dann zwar wahr, aber der Text „Paradigma" allein
        // sagt nichts, was der Eintrag nicht schon durch sein Fehlen sagt.
        if (id) continue;
        const text = `${cat?.emoji || field.emoji} ${label || field.fallbackName}`;
        appended += plainBlockHtml(suffix ? `${text} ${suffix}` : text, { separator });
        separator = true;
        continue;
      }

      const linkKey = linkItemKey({ id: article.id, entryType: 'wiki' });
      if (alreadyLinked.has(linkKey)) continue;
      alreadyLinked.add(linkKey);

      // Wie in v36: ein hochgeladenes Bild gehört nicht in die Node-Attrs, dort
      // steht nur der Emoji-Rückfall (der Chip löst sein Bild live auf).
      const icon = article.icon && !isImageIcon(article.icon)
        ? article.icon
        : (cat?.emoji || getCategoryEmoji(article.category_id ?? ''));

      const chip: InternalLinkChip = {
        id: article.id,
        entryType: 'wiki',
        label: article.title ?? '',
        icon,
        entry_number: article.entry_number,
      };
      appended += internalLinkBlockHtml(chip, label, { separator, suffix });
      separator = true;
    }

    // `updated_at` bleibt unangetastet — die Migration ist keine Bearbeitung
    // durch den Nutzer und soll die Sortierung nicht umwerfen.
    const nextContent = content + appended;
    await db.execute(
      `UPDATE journal_entries
          SET content = $1, paradigm_id = NULL, is_bannung = 0, bannung_type_wiki_id = NULL,
              is_meditation = 0, meditation_duration = NULL, meditation_type_wiki_id = NULL
        WHERE id = $2`,
      [nextContent, entry.id]
    );

    // Die `links`-Tabelle spiegelt sonst `syncLinks` beim Speichern; die
    // Migration schreibt am Store vorbei und zieht den Spiegel selbst nach.
    await db.execute('DELETE FROM links WHERE source_id=$1', [entry.id]);
    for (const link of extractInternalLinks(nextContent)) {
      await db.execute(
        `INSERT OR IGNORE INTO links (source_id, source_type, target_id, target_type)
         VALUES ($1, 'journal', $2, $3)`,
        [entry.id, link.id, link.entryType]
      );
    }
  }
}
