/**
 * Import-Sperre fuer die Editor-Speicherpfade.
 *
 * Ein Backup-Restore im replace-Modus behaelt die Original-IDs. Navigierte der
 * Import den offenen Editor weg, feuerte dessen Unmount-Save und schrieb den
 * VOR-Import-Inhalt ueber die gerade wiederhergestellte Zeile — stiller
 * Datenverlust, den es (verteilt auf drei Kopien) schon vor dem
 * useEntryEditor-Hook gab. dbBackup haelt die Sperre um replace- und
 * add-vault-Importe; der Hook und der Sigil-Editor pruefen sie vor jedem
 * automatischen Speichern.
 *
 * Ein Zaehler statt eines booleschen Flags, damit sich verschachtelte oder
 * ueberlappende Sperren nicht gegenseitig vorzeitig aufheben.
 */
let suspended = 0;

export function suspendEditorSaves(): void {
  suspended++;
}

export function resumeEditorSaves(): void {
  suspended = Math.max(0, suspended - 1);
}

export function editorSavesSuspended(): boolean {
  return suspended > 0;
}
