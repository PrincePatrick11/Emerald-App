/**
 * Datentypen der funktionalen Blöcke.
 *
 * Importregel für alles unter `lib/blocks/`: nur Typen, `lucide-react` und
 * andere reine `lib`-Module — keine React-Komponenten, keine Stores, kein
 * TipTap. Migrationen, Export und `scripts/check-blocks.mjs` benutzen diese
 * Dateien, und die laufen ohne Browser.
 */

/** `<herkunft>.<name>` — eingebaute Typen heißen `core.*`; die Form lässt
 *  später Erweiterungen (`meinplugin.x`) neben den eingebauten zu. */
export type BlockTypeId = `${string}.${string}`;

/** Der Textblock: TipTap-HTML als inneres HTML seiner Section. */
export const TEXT_BLOCK_TYPE = 'core.text' satisfies BlockTypeId;

/** Name eines Section-Attributs — nur `data-*` übersteht das Lesen (siehe `parseBlocks`). */
export type BlockAttrName = `data-${string}`;

/**
 * Die Instanz-Attribute, die jeder Block tragen kann, unabhängig vom Typ.
 * Sie stehen am Block selbst — und damit im Inhalt: Cancel dreht sie mit dem
 * Text zurück, Export und Backup tragen sie ohne eigenes Feld.
 */
export const BLOCK_ATTR = {
  /** Datenformat-Version des Typs; fehlt = 1. */
  version: 'data-block-v',
  /** `"1"`: im Lesemodus ausgeblendet, im Bearbeitungsmodus ausgegraut. */
  hidden: 'data-block-hidden',
  /** Eigener Titel statt des Typnamens. */
  title: 'data-block-title',
  /** `"1"`/`"0"`: Titel im Lesemodus zeigen — fehlt = Standard des Typs. */
  showTitle: 'data-block-show-title',
} as const;

/**
 * Ein Block, wie er im gespeicherten `content` steht.
 *
 * `type` ist bewusst `string`, nicht `BlockTypeId`: gelesen wird auch, was
 * diese App-Version nicht kennt — ein Block aus einer neueren Version oder aus
 * einer fehlenden Erweiterung. Er muss unverändert zurückgeschrieben werden.
 */
export interface BlockInstance {
  id: string;
  type: string;
  /** Inneres HTML der Section. Beim Textblock das TipTap-HTML. */
  html: string;
  /**
   * Alle übrigen `data-*`-Attribute der Section (`data-block-v`,
   * `data-block-hidden` …), dekodiert und in ihrer Reihenfolge — damit ein
   * unbekannter Typ beim Speichern nichts verliert.
   */
  attrs: Record<string, string>;
}
