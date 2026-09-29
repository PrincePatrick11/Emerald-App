import { nowIso } from './helpers';

/**
 * Wann ein Schreibzugriff „Zuletzt geändert" (`updated_at`) weiterstellt. Es
 * zählt nur, was jemand an genau diesem Eintrag ändert — was als Folge von
 * anderswo hereinkommt, lässt den Stempel stehen, und mit ihm die Reihenfolge
 * der Listen.
 *
 * Gilt für die Einträge der drei Module, Aufgaben, Vorlagen, Altäre, eigene
 * Blöcke und das Lexikon — jede Methode, die `updated_at` schreibt, fragt
 * `needsWrite` und stempelt über `stampFor`.
 *
 * - `true` (Standard): jetzt.
 * - `false`: eine Folge — ein umbenannter Tag, „Alle aktualisieren", ein
 *   neues Vorschaubild.
 * - ein Zeitstempel: genau dieser. Cancel stellt so den von vorher wieder her.
 */
export type Touch = boolean | string;

export interface WriteOptions {
  touch?: Touch;
}

/** Für jeden Schreibzugriff, der eine Folge von anderswo ist — so lassen sie sich alle finden. */
export const AS_A_CONSEQUENCE: WriteOptions = { touch: false };

export function stampFor(current: string, touch: Touch = true): string {
  if (touch === true) return nowIso();
  return touch === false ? current : touch;
}

/**
 * Muss ein Store für `patch` überhaupt schreiben? Nicht, wenn sich nichts
 * ändert — ein „Fertig" ohne Änderung oder ein Autosave auf denselben Stand
 * stellen „Zuletzt geändert" sonst weiter. Fehlend und `null` gelten gleich.
 * Ein ausdrücklich gesetzter Stempel, der abweicht, ist auch eine Änderung.
 */
export function needsWrite(current: { updated_at: string }, patch: object, touch?: Touch): boolean {
  if (typeof touch === 'string' && touch !== current.updated_at) return true;
  const fields = current as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) =>
    JSON.stringify(fields[key] ?? null) !== JSON.stringify(value ?? null));
}
