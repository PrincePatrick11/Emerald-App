import { SIGIL_CATEGORY_ID } from '../schema';
import { sigilBlockSet } from './sigil';
import type { BlockInstance } from './types';

/**
 * Mit welchen Blöcken ein neuer Eintrag beginnt. Bis auf die Kategorie
 * „Sigillen" (Rechner, Zeichnung, Ladung) mit keinem — der Stapel legt dann
 * selbst einen leeren Textblock an.
 *
 * Der Andockpunkt für das spätere Vorlagen-Dashboard (Layouts je Kategorie ×
 * Eintragsart). Ein Kategoriewechsel fügt bewusst nichts hinzu: dafür gibt es
 * die Sigillen-Blöcke unter „Block hinzufügen".
 */
export function defaultBlocksFor(entryType: 'journal' | 'wiki' | 'operation', categoryId?: string): BlockInstance[] {
  if (entryType === 'operation' && categoryId === SIGIL_CATEGORY_ID) return sigilBlockSet();
  return [];
}
