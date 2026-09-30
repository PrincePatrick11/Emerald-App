import type { TrashKind, ViewId } from '../lib/modules';

export type ContentType = 'journal' | 'wiki' | 'operation' | 'task' | 'altar';

/** Die Eintragsarten der Tabelle `entries` — die Module mit Blockstapel. */
export type EntryType = 'journal' | 'wiki' | 'operation';

export interface JournalEntry {
  id: string;
  title: string;
  content: string; // HTML, wie TipTaps getHTML() es liefert
  created_at: string;
  updated_at: string;
  tags: string[];
  // Die Mondphase ist keine Spalte mehr: sie folgt aus `created_at`
  // (`entryMoonPhase` in lib/moonPhase.ts). Paradigma, Bannung, Meditation und
  // die verlinkten Einträge sind seit v36/v37 Link-Chips im Inhalt.
  deleted_at: string | null;
  entry_number?: number;
}

export interface WikiArticle {
  id: string;
  title: string;
  content: string; // HTML, wie TipTaps getHTML() es liefert
  /** `null` = ohne Kategorie, seit v39 der Normalfall eines neuen Eintrags. */
  category_id: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
  cover_image?: string;
  icon?: string;
  entry_number?: number;
}

/**
 * Eine Zeile der globalen `categories`-Tabelle — dieselbe Liste für Wiki,
 * Operationen, Aufgaben und Altar-Elemente. `is_builtin` gilt nur für `other`
 * und `sigils`; der Anzeigename läuft über `lib/categories.categoryLabel`.
 */
export interface Category {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
  deleted_at: string | null;
}

export interface Operation {
  id: string;
  title: string;
  content: string; // HTML, wie TipTaps getHTML() es liefert
  /** `null` = ohne Kategorie, seit v39 der Normalfall eines neuen Eintrags. */
  category_id: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
  // Status/Enddatum/Version (v41, lib/blocks/legacyStatus.ts) und die
  // Sigillen-Felder samt Notizen (v42, lib/blocks/sigil.ts) sind Blöcke im
  // Inhalt; ihre Spalten stehen noch im Schema, die App liest sie nicht mehr.
  entry_number?: number;
  icon?: string;
  cover_image?: string;
}

export interface TrashedItem {
  id: string;
  title: string;
  type: TrashKind;
  deleted_at: string;
  category?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type MoonPhase =
  | 'new'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent';

export interface AltarRecord {
  id: string;
  title: string;
  background_preset: string;
  background_image_data: string | null;
  background_overlay: number;
  background_overlay_color: string;
  created_at: string;
  updated_at: string;
  grid_enabled: boolean;
  grid_size: number;
  grid_opacity: number;
  grid_color: string;
  snap_to_grid: boolean;
  rotation_snap_enabled: boolean;
  rotation_snap_angle: number;
  snap_scale_to_grid: boolean;
  resolution: string;
  thumbnail_data?: string | null;
  icon_data?: string | null;
  /** Im Papierkorb seit — der Store hält nur Altäre ohne. */
  deleted_at?: string | null;
}

export interface AltarItem {
  id: string;
  name: string;
  emoji: string;
  /** `null` = ohne Kategorie, seit v39 der Normalfall eines neuen Eintrags. */
  category_id: string | null;
  note: string;
  image_data?: string;
  /** Nur für die Sortierung der Bibliothek — die Spalte gab es in
   *  `altar_items` schon, sie kam bloß nie im Typ an. */
  created_at: string;
}

export interface AltarPlacement {
  id: string;
  altar_id?: string;
  item_id: string;
  // name, emoji, category_id und image_data stammen aus altar_items und werden
  // beim Laden hinzugejoint — sie sind keine Spalten von altar_placements.
  name: string;
  emoji: string;
  /** `null` = ohne Kategorie, seit v39 der Normalfall eines neuen Eintrags. */
  category_id: string | null;
  x: number;
  y: number;
  z_index: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  image_data?: string;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: ContentType;
}

export interface Task {
  id: string;
  title: string;
  /** `null` = ohne Kategorie, seit v39 der Normalfall eines neuen Eintrags. */
  category_id: string | null;
  priority: TaskPriority;
  completed: boolean;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Ein Zeichenpaar des Alphabets einer Sprache: `from` ist das Zeichen (oder
 * die Zeichenfolge) der eigenen Schrift, `to` das der Sprache. Mehrbuchstabige
 * Paare sind ausdrücklich erlaubt — „th" → „ᚦ" ist genau der Fall, für den die
 * Umschrift beim längsten Treffer zuerst schaut (siehe `lib/lexicon.ts`).
 */
export interface AlphabetPair {
  from: string;
  to: string;
}

/** Eine Sprache des Lexikons. Ihre Vokabeln stehen als `LexiconEntry` daneben. */
export interface Language {
  id: string;
  name: string;
  /** Emoji oder Bild-Data-URL, wie bei eigenen Blöcken und Vorlagen. */
  icon: string;
  alphabet: AlphabetPair[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Eine Vokabel. `term` steht in der Sprache, `translation` in der eigenen —
 * das Übersetzen-Feld liest das Paar in beide Richtungen.
 */
export interface LexiconEntry {
  id: string;
  language_id: string;
  term: string;
  translation: string;
  pronunciation: string;
  note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActiveView {
  // ViewId statt der alten Ad-hoc-Union: die enthielt über ContentType auch
  // 'operation' (singular), das als View-Typ nie gültig war.
  type: ViewId;
  id?: string;
  mode?: 'view' | 'edit';
  /** Frisch angelegt und noch nie mit „Fertig" bestätigt — Cancel verwirft
   *  den Eintrag wieder, statt nur zum letzten Speicherstand zurückzukehren.
   *  Wird von jedem „Neu"-Handler gesetzt und fällt beim Speichern weg. */
  isNew?: boolean;
}
