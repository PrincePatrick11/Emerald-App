import type { TFunction } from 'i18next';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { fieldFallbackText, translatedOr } from './blockAttrs';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import { parseFields, serializeFields } from './fields';

/**
 * Status, Enddatum und Version der Operationen waren bis v40 feste Spalten
 * mit eigenem Filter, Punkt in der Liste und Chips unter dem Titel. Seit v41
 * sind sie ein Block: die Kopie des eigenen Blocks „Status" (Aktiv — Ja/Nein,
 * Enddatum, Version), ganz oben im Inhalt. Der Block entsteht nur bei
 * Operationen, die davon etwas gesetzt hatten; die Definition nur, wenn es
 * eine solche Operation gibt — danach ist sie ein eigener Block wie jeder
 * andere, umbenenn-, änderbar und löschbar.
 *
 * Ein Konverter für alle Wege, auf denen Altbestand hereinkommt: Migration
 * v41, Backup-Import (`.emeralddb` bis Version 6), `.emerald`- und
 * Markdown-Import. Rein und DOM-frei — die Migration läuft ohne Browser.
 */

/** Feste ID: Migration und Importe aus verschiedenen Vaults treffen dieselbe Definition. */
export const STATUS_DEFINITION_ID = 'core-status';

export interface LegacyStatus {
  isActive: boolean;
  endDate: string | null;
  version: string | null;
}

/** Hatte die Operation etwas gesetzt? „Aktiv" ohne Enddatum und Version war der Normalzustand. */
export function hasLegacyStatus(status: LegacyStatus): boolean {
  return !status.isActive || !!status.endDate?.trim() || !!status.version?.trim();
}

/**
 * Die Definition „Status", beschriftet in der aktuellen Sprache — wie das
 * Starter-Set der Kategorien. Die Beschriftungen landen fest in Definition und
 * Kopien; ist i18n noch nicht bereit (`t` liefert den Schlüssel zurück), stünde
 * dort für immer „blocks.status.name". Dann lieber Englisch.
 */
export function statusDefinition(t: TFunction, now: string): BlockDefinition {
  const label = (key: string, fallback: string) => translatedOr(t, key, fallback);
  return {
    id: STATUS_DEFINITION_ID,
    name: label('blocks.status.name', 'Status'),
    icon: '📌',
    description: '',
    elements: [
      { id: 'active', kind: 'toggle', label: label('blocks.status.active', 'Active') },
      { id: 'end-date', kind: 'date', label: label('blocks.status.endDate', 'End date') },
      { id: 'version', kind: 'shorttext', label: label('blocks.status.version', 'Version') },
    ],
    display: { readHideEmpty: true, readOnly: false, showTitle: true },
    revision: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Ein Datum, wie es der Datumsblock speichert (`YYYY-MM-DD`). Die Spalte hielt
 * ISO; ein Markdown-Import bringt „Sep 10, 2026" mit. Unlesbares bleibt roh
 * stehen — der Block zeigt es dann als Text, statt es zu verlieren.
 */
function isoDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Der Inhalt mit dem Status-Block davor — dort, wo die Chips unter dem Titel standen. */
export function withLegacyStatus(content: string, status: LegacyStatus, def: BlockDefinition, t: TFunction): string {
  const text = fieldFallbackText(t);
  const block = instantiateDefinition(def, text);
  const model = parseFields(block);
  const values: Record<string, string | boolean> = { active: status.isActive };
  if (status.endDate?.trim()) values['end-date'] = isoDate(status.endDate);
  if (status.version?.trim()) values.version = status.version.trim();
  // Über die Vorgaben der Definition: ein Feld, das jemand zum Status hinzugefügt hat, behält seine.
  const filled = serializeFields(block, { ...model, values: { ...model.values, ...values } }, text);
  return serializeBlocks([filled, ...parseBlocks(content)]);
}

/** Der Altstatus einer Operationszeile — aus der Datenbank oder aus einer Sicherung (dann ungeprüft). */
export function legacyStatusOfRow(row: Record<string, unknown>): LegacyStatus {
  return {
    isActive: row.is_active == null ? true : Number(row.is_active) !== 0,
    endDate: typeof row.end_date === 'string' ? row.end_date : null,
    version: typeof row.version === 'string' ? row.version : null,
  };
}

/**
 * Operationszeilen mit Altstatus umschreiben: Status-Block in den Inhalt,
 * Spalten auf ihre Grundwerte. Zeilen ohne Altstatus kommen unverändert
 * zurück. `definition` ist die benutzte Definition — `existing`, wenn es sie
 * schon gibt, sonst eine neue —, oder `null`, wenn keine Zeile sie brauchte.
 */
export function convertLegacyStatusRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  t: TFunction,
  now: string,
  existing?: BlockDefinition,
): { rows: T[]; definition: BlockDefinition | null } {
  let definition: BlockDefinition | null = null;
  const out = rows.map((row) => {
    const status = legacyStatusOfRow(row);
    if (!hasLegacyStatus(status)) return row;
    definition ??= existing ?? statusDefinition(t, now);
    return {
      ...row,
      content: withLegacyStatus(typeof row.content === 'string' ? row.content : '', status, definition, t),
      is_active: 1,
      end_date: null,
      version: null,
    };
  });
  return { rows: out, definition };
}
