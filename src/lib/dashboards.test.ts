import { describe, expect, it } from 'vitest';
import { filterCanMatch, matchesFilter, parseDashboardFilter } from './dashboards';

const live = { categories: new Set(['c1']), tags: new Set(['t1']) };
const entry = (category_id: string | null, tags: string[]) => ({ category_id, tags });

describe('tag rule of a dashboard filter', () => {
  it('lets through entries with a live tag of the rule', () => {
    expect(matchesFilter(entry('c1', ['t1']), { tags: ['t1'] }, live)).toBe(true);
  });

  it('matches nothing once the tag is in the trash or gone', () => {
    expect(matchesFilter(entry('c1', ['t2']), { tags: ['t2'] }, live)).toBe(false);
    expect(matchesFilter(entry('c1', ['t2']), { tags: [] }, live)).toBe(false);
  });

  it('keeps an empty tag list when read: it means nothing', () => {
    expect(parseDashboardFilter({ tags: [] })).toEqual({ tags: [] });
  });

  it('shows everything without a rule', () => {
    expect(matchesFilter(entry(null, []), {}, live)).toBe(true);
  });
});

describe('filterCanMatch', () => {
  it('is false when a rule names nothing alive, true otherwise', () => {
    expect(filterCanMatch({}, live)).toBe(true);
    expect(filterCanMatch({ categories: ['c1'], tags: ['t1'] }, live)).toBe(true);
    expect(filterCanMatch({ categories: ['x'] }, live)).toBe(false);
    expect(filterCanMatch({ tags: [] }, live)).toBe(false);
  });
});
