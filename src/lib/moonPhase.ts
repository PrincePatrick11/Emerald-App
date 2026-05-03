import type { MoonPhase } from '../types';

/**
 * Calculates the approximate moon phase for a given date.
 * Based on the known new moon on 2000-01-06 and the synodic period of ~29.53 days.
 */
export function getMoonPhase(date: Date = new Date()): MoonPhase {
  const knownNewMoon = new Date('2000-01-06T18:14:00Z');
  const synodicPeriod = 29.53058867;

  const daysSinceNewMoon =
    (date.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24);
  const currentCycleDay =
    ((daysSinceNewMoon % synodicPeriod) + synodicPeriod) % synodicPeriod;

  if (currentCycleDay < 1.85) return 'new';
  if (currentCycleDay < 7.38) return 'waxing_crescent';
  if (currentCycleDay < 9.22) return 'first_quarter';
  if (currentCycleDay < 14.77) return 'waxing_gibbous';
  if (currentCycleDay < 16.61) return 'full';
  if (currentCycleDay < 22.15) return 'waning_gibbous';
  if (currentCycleDay < 23.99) return 'last_quarter';
  return 'waning_crescent';
}

export const MOON_PHASE_SYMBOLS: Record<MoonPhase, string> = {
  new: '🌑',
  waxing_crescent: '🌒',
  first_quarter: '🌓',
  waxing_gibbous: '🌔',
  full: '🌕',
  waning_gibbous: '🌖',
  last_quarter: '🌗',
  waning_crescent: '🌘',
};
