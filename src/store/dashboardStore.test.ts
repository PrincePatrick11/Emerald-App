import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard } from '../types';

const db = vi.hoisted(() => ({
  fail: false,
  execute: vi.fn(),
  batch: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../lib/db', () => ({ getDb: async () => db }));

import { useDashboardStore } from './dashboardStore';
import { useSaveNoticeStore } from './saveNoticeStore';

function dashboard(id: string, position: number): Dashboard {
  return {
    id, builtin: null, name: id, icon: '', position, filter: {},
    sort: { by: 'updated', dir: 'desc' }, display: {} as Dashboard['display'],
    created_at: '', updated_at: '', deleted_at: null,
  };
}

const initial = [dashboard('a', 0), dashboard('b', 1), dashboard('c', 2)];

beforeEach(() => {
  db.fail = false;
  const write = async () => { if (db.fail) throw new Error('disk full'); };
  db.execute.mockImplementation(write);
  db.batch.mockImplementation(write);
  db.select.mockResolvedValue([{ max: 2 }]);
  useDashboardStore.setState({ dashboards: initial });
  useSaveNoticeStore.setState({ notice: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a failing write', () => {
  it('rename: puts the old name back and shows the notice', async () => {
    db.fail = true;
    await useDashboardStore.getState().updateDashboard('b', { name: 'New' });
    expect(useDashboardStore.getState().dashboards).toEqual(initial);
    expect(useSaveNoticeStore.getState().notice).not.toBeNull();
  });

  it('reorder: puts the old order back and shows the notice', async () => {
    db.fail = true;
    await useDashboardStore.getState().reorderDashboards(['c', 'a', 'b']);
    expect(useDashboardStore.getState().dashboards).toEqual(initial);
    expect(useSaveNoticeStore.getState().notice).not.toBeNull();
  });

  it('delete: keeps the dashboard and shows the notice', async () => {
    db.fail = true;
    await useDashboardStore.getState().deleteDashboard('b');
    expect(useDashboardStore.getState().dashboards).toEqual(initial);
    expect(useSaveNoticeStore.getState().notice).not.toBeNull();
  });

  it('create: adds nothing and shows the notice', async () => {
    db.fail = true;
    const created = await useDashboardStore.getState().createDashboard('New');
    expect(created).toBeNull();
    expect(useDashboardStore.getState().dashboards).toEqual(initial);
    expect(useSaveNoticeStore.getState().notice).not.toBeNull();
  });
});

describe('a working write', () => {
  it('rename: keeps the change', async () => {
    await useDashboardStore.getState().updateDashboard('b', { name: 'New' });
    expect(useDashboardStore.getState().dashboards[1].name).toBe('New');
    expect(useSaveNoticeStore.getState().notice).toBeNull();
  });
});
