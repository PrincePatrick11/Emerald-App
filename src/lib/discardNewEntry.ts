/**
 * Verwirft einen per `ActiveView.isNew` markierten, nie mit „Fertig"
 * bestätigten Eintrag endgültig — der Cancel-Pfad von Journal, Wiki,
 * Operations und Sigil (der Altar hat keinen Soft-Delete und geht eigene
 * Wege in `AltarView.handleCancel`).
 *
 * Warum beide Schritte: der Soft-Delete nimmt den Eintrag aus dem
 * Store-State (und räumt je nach Store `links`-Zeilen mit ab), der
 * Hard-Delete entfernt die Zeile endgültig — bewusst ohne Papierkorb und
 * ohne Undo, denn aus Nutzersicht wurde der Eintrag nie angelegt.
 *
 * Sicherheitsanker gegen den Unmount-Save aus `useEntryEditor`: nach dem
 * Soft-Delete feuert dessen Navigations-Save noch ein `update(prevId, …)`.
 * Dass der Eintrag dadurch nicht wiederaufersteht, garantiert allein der
 * `if (!entry) return`-Guard in den update-Funktionen der Stores — wer den
 * entfernt, bricht diesen Pfad.
 */
export async function discardNewEntry(
  id: string,
  softDelete: (id: string) => Promise<void>,
  hardDelete: (id: string) => Promise<void>
): Promise<void> {
  await softDelete(id);
  await hardDelete(id);
}
