import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdminTaskError, isAdminTaskError } from '@kc/domain';
import { SupabaseAdminTaskRepository } from '../SupabaseAdminTaskRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mockClient(rpcImpl: (name: string, args?: unknown) => unknown): SupabaseClient {
  return { rpc: vi.fn(rpcImpl as never) } as unknown as SupabaseClient;
}

const validRow = {
  task_id: 't1',
  title: 'Hello',
  description: null,
  status: 'open',
  priority: 'medium',
  assignee_id: null,
  assignee_display_name: null,
  created_by: 'u-creator',
  created_by_display_name: 'Creator',
  due_at: null,
  labels: ['p0'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  comment_count: 2,
};

describe('SupabaseAdminTaskRepository — list', () => {
  it('returns mapped tasks and parses timestamps + comment count', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: [validRow], error: null })),
    );
    const out = await repo.list({});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      taskId: 't1', title: 'Hello', status: 'open', priority: 'medium', commentCount: 2,
    });
    expect(out[0]?.createdAt).toBeInstanceOf(Date);
    expect(out[0]?.labels).toEqual(['p0']);
  });

  it('drops rows with an unparseable status', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: [{ ...validRow, status: 'limbo' }], error: null })),
    );
    expect(await repo.list({})).toEqual([]);
  });

  it('maps SQLSTATE 42501 to forbidden even when the message is opaque', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: { message: 'permission denied', code: '42501' } })),
    );
    await expect(repo.list({})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('returns empty when data is null', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    expect(await repo.list({})).toEqual([]);
  });

  it('forwards dueFrom / dueTo / unassignedOnly into RPC args', async () => {
    const captured: { name?: string; args?: Record<string, unknown> } = {};
    const repo = new SupabaseAdminTaskRepository(
      mockClient((name, args) => {
        captured.name = name;
        captured.args = args as Record<string, unknown>;
        return { data: [], error: null };
      }),
    );
    await repo.list({
      dueFrom: new Date('2026-01-01T00:00:00.000Z'),
      dueTo:   new Date('2026-01-31T23:59:59.999Z'),
      unassignedOnly: true,
    });
    expect(captured.name).toBe('admin_task_list');
    expect(captured.args).toMatchObject({
      p_due_from:        '2026-01-01T00:00:00.000Z',
      p_due_to:          '2026-01-31T23:59:59.999Z',
      p_unassigned_only: true,
    });
  });
});

describe('SupabaseAdminTaskRepository — getDetail', () => {
  it('returns the task + parsed activities', async () => {
    const row = {
      ...validRow,
      activities: [{
        activity_id: 'a1',
        actor_id: 'u-actor',
        actor_display_name: 'Actor',
        kind: 'comment',
        payload: { body: 'hi' },
        created_at: '2026-01-03T00:00:00.000Z',
      }],
    };
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: [row], error: null })),
    );
    const out = await repo.getDetail('t1');
    expect(out?.task.taskId).toBe('t1');
    expect(out?.activities).toHaveLength(1);
    expect(out?.activities[0]).toMatchObject({ activityId: 'a1', kind: 'comment' });
  });

  it('drops activities with unknown kinds', async () => {
    const row = {
      ...validRow,
      activities: [{
        activity_id: 'a1', actor_id: null, actor_display_name: null,
        kind: 'rocket_launch', payload: {}, created_at: '2026-01-03T00:00:00.000Z',
      }],
    };
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: [row], error: null })),
    );
    const out = await repo.getDetail('t1');
    expect(out?.activities).toEqual([]);
  });

  it('returns null when the task is missing', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: [], error: null })),
    );
    expect(await repo.getDetail('nope')).toBeNull();
  });
});

describe('SupabaseAdminTaskRepository — writes', () => {
  it('create returns task_id from the RPC', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: 't-new', error: null })),
    );
    expect(await repo.create({ title: 'x' })).toBe('t-new');
  });

  it('create throws when RPC returns non-string data', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    await expect(repo.create({ title: 'x' })).rejects.toMatchObject({
      code: 'unknown',
      message: 'admin_task_create returned non-string task_id',
    });
  });

  it('create maps known error messages', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: { message: 'assignee_not_admin', code: '23514' } })),
    );
    const err = await repo.create({ title: 'x', assigneeId: 'u' }).catch((e) => e);
    expect(isAdminTaskError(err)).toBe(true);
    expect((err as AdminTaskError).code).toBe('assignee_not_admin');
  });

  it('update forwards patch args to RPC', async () => {
    let capturedArgs: any;
    const repo = new SupabaseAdminTaskRepository(
      mockClient((name, args) => {
        expect(name).toBe('admin_task_update');
        capturedArgs = args;
        return { data: null, error: null };
      }),
    );
    await repo.update('t1', {
      title: 'new title',
      clearDue: true,
      labels: ['bug'],
      category: 'support',
    });
    expect(capturedArgs).toMatchObject({
      p_task_id: 't1',
      p_title: 'new title',
      p_clear_due: true,
      p_labels: ['bug'],
      p_category: 'support',
    });
  });

  it('setStatus maps invalid_transition error', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: { message: 'invalid_transition', code: '22023' } })),
    );
    await expect(repo.setStatus('t1', 'archived')).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('assign forwards new assignee to admin_task_assign RPC', async () => {
    let capturedArgs: any;
    const repo = new SupabaseAdminTaskRepository(
      mockClient((name, args) => {
        expect(name).toBe('admin_task_assign');
        capturedArgs = args;
        return { data: null, error: null };
      }),
    );
    await repo.assign('t1', 'u_new_admin');
    expect(capturedArgs).toEqual({
      p_task_id: 't1',
      p_new_assignee: 'u_new_admin',
    });
  });

  it('addComment returns activity_id from the RPC', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: 'a-1', error: null })),
    );
    expect(await repo.addComment('t1', 'hi')).toBe('a-1');
  });

  it('addComment throws when RPC returns non-string data', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    await expect(repo.addComment('t1', 'hi')).rejects.toMatchObject({
      code: 'unknown',
      message: 'admin_task_add_comment returned non-string activity_id',
    });
  });

  it('delete maps task_not_found by SQLSTATE P0002 when message is opaque', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: { message: 'no rows', code: 'P0002' } })),
    );
    await expect(repo.delete('t1')).rejects.toMatchObject({ code: 'task_not_found' });
  });

  it('falls back to unknown on unrecognized error', async () => {
    const repo = new SupabaseAdminTaskRepository(
      mockClient(() => ({ data: null, error: { message: 'mystery', code: '99999' } })),
    );
    await expect(repo.update('t1', { title: 'x' })).rejects.toMatchObject({ code: 'unknown' });
  });
});
