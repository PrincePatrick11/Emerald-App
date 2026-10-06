/** `MouseEvent.button` der Daumentasten: 3 ist zurück, 4 ist vor. */
export const HISTORY_BUTTON_STEPS: Partial<Record<number, -1 | 1>> = { 3: -1, 4: 1 };

/**
 * Ob das Ereignis von einer Daumentaste der Maus stammt. Die blättern im
 * Verlauf (`useMouseNavigation`) und greifen sonst nichts: wer auf `mousedown`
 * etwas beginnt oder schließt, fragt hier nach — der Druck wird dort nur
 * abgebrochen, nicht angehalten, und kommt bei jedem Handler an.
 */
export function isHistoryButton(e: { button: number }): boolean {
  return HISTORY_BUTTON_STEPS[e.button] !== undefined;
}
