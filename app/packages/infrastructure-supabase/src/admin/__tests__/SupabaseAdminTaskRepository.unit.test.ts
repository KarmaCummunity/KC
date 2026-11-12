// FR-ADMIN-018 — the admin task adapter: argument shapes of the 0021 RPCs, keyset paging,
// record mapping (nullable creator) and error mapping by stable message.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdminTaskError, BackendUnavailableError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabaseAdminTaskRepository } from '../SupabaseAdminTaskRepository';

type Rpc = (name: string, args?: unknown) => unknown;

function repoWith(rpc: Rpc) {
  const spy = vi.fn(async (name: string, args?: unknown) => rpc(name, args));
  const client = { rpc: spy } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseAdminTaskRepository(client), rpc: spy };
}

const TASK = {
  task_id: 't1', title: 'Review reports', description: null, status: 'open', priority: 'high',
  category: 'moderation', assignee_id: 'u2', assignee_display_name: 'Noa', created_by: null,
  created_by_display_name: null, due_at: '2026-11-20T10:00:00Z', labels: ['ops'],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', comment_count: 3,
};
const CURSOR = { rank: 1, due: '2026-11-20T10:00:00+00:00', created_at: '2026-11-01T00:00:00+00:00', id: 't1' };

describe('SupabaseAdminTaskRepository.list', () => {
  it('maps the records, keeps a purged creator as null and returns the next cursor of a full page', async () => {
    const { repo, rpc } = repoWith(() => ({ data: [{ task: TASK, cursor: CURSOR }], error: null }));
    const page = await repo.list({ status: 'open', onlyMine: true, limit: 1 });
    expect(page.rows[0]).toMatchObject({ taskId: 't1', priority: 'high', createdBy: null, commentCount: 3, labels: ['ops'] });
    expect(page.rows[0]?.dueAt).toEqual(new Date('2026-11-20T10:00:00Z'));
    expect(page.nextCursor).toBe(JSON.stringify(CURSOR));
    expect(rpc).toHaveBeenCalledWith('admin_task_list', expect.objectContaining({ p_status: 'open', p_only_mine: true, p_limit: 1 }));
  });

  it('sends the cursor back as the server position and ends on a short page', async () => {
    const { repo, rpc } = repoWith(() => ({ data: [{ task: TASK, cursor: CURSOR }], error: null }));
    const page = await repo.list({ cursor: JSON.stringify(CURSOR), limit: 50 });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_cursor: CURSOR });
    expect(page.nextCursor).toBeNull();
  });

  it('skips a record with an unknown status', async () => {
    const { repo } = repoWith(() => ({ data: [{ task: { ...TASK, status: 'limbo' }, cursor: CURSOR }], error: null }));
    expect((await repo.list({})).rows).toEqual([]);
  });
});

describe('SupabaseAdminTaskRepository writes and reads', () => {
  it('reads the detail with its history, and null for an unknown task', async () => {
    const activity = { activity_id: 'a1', actor_id: 'u1', actor_display_name: 'Dana', kind: 'comment', payload: { body: 'hi' }, created_at: '2026-11-03T00:00:00Z' };
    const { repo } = repoWith(() => ({ data: { ...TASK, activities: [activity, { kind: 'bogus' }] }, error: null }));
    const detail = await repo.getDetail('t1');
    expect(detail?.activities).toEqual([expect.objectContaining({ activityId: 'a1', kind: 'comment', payload: { body: 'hi' } })]);
    const empty = repoWith(() => ({ data: null, error: null }));
    expect(await empty.repo.getDetail('t9')).toBeNull();
  });

  it('clears the description with an empty string and keeps untouched fields undefined', async () => {
    const { repo, rpc } = repoWith(() => ({ data: null, error: null }));
    await repo.update('t1', { description: null, clearDue: true });
    expect(rpc).toHaveBeenCalledWith('admin_task_update', expect.objectContaining({ p_description: '', p_clear_due: true, p_title: undefined }));
  });

  it('creates with defaults and returns the id; counts open tasks', async () => {
    const { repo, rpc } = repoWith((name) => ({ data: name === 'admin_task_open_count' ? 4 : 'new-id', error: null }));
    expect(await repo.create({ title: 'T' })).toBe('new-id');
    expect(rpc).toHaveBeenCalledWith('admin_task_create', expect.objectContaining({ p_priority: 'medium', p_category: 'other', p_labels: [] }));
    expect(await repo.openCount()).toBe(4);
  });
});

describe('SupabaseAdminTaskRepository errors', () => {
  it('maps a stable message to its code', async () => {
    const { repo } = repoWith(() => ({ data: null, error: { code: 'P0001', message: 'invalid_transition' } }));
    await expect(repo.setStatus('t1', 'done')).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('maps 42501 to forbidden and anything else to unknown', async () => {
    const forbidden = repoWith(() => ({ data: null, error: { code: '42501', message: 'forbidden' } }));
    await expect(forbidden.repo.assign('t1', null)).rejects.toMatchObject({ code: 'forbidden' });
    const other = repoWith(() => ({ data: null, error: { code: 'XX000', message: 'boom' } }));
    const error = await other.repo.delete('t1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdminTaskError);
    expect(error).toMatchObject({ code: 'unknown' });
  });

  it('reports a missing function as unavailable', async () => {
    const { repo } = repoWith(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    await expect(repo.addComment('t1', 'x')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
