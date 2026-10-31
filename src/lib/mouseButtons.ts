/** `MouseEvent.button` of the thumb buttons: 3 is back, 4 is forward. */
export const HISTORY_BUTTON_STEPS: Partial<Record<number, -1 | 1>> = { 3: -1, 4: 1 };

/**
 * Whether the event comes from a thumb button of the mouse. Those page through
 * the history (`useMouseNavigation`) and do nothing else: anything that starts or
 * closes something on `mousedown` asks here — the press is only
 * cancelled there, not stopped, and reaches every handler.
 */
export function isHistoryButton(e: { button: number }): boolean {
  return HISTORY_BUTTON_STEPS[e.button] !== undefined;
}
