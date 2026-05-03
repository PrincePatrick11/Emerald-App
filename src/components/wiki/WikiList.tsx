export function getCategoryEmoji(category: string): string {
  const map: Record<string, string> = {
    ritual: '🕯️',
    deity: '✨',
    herb: '🌿',
    symbol: '🔮',
    tool: '⚗️',
    concept: '📖',
    spell: '🌙',
    paradigm: '🌀',
    bannung: '🚫',
    meditation: '🧘',
    other: '📄',
  };
  return map[category] ?? '📄';
}
