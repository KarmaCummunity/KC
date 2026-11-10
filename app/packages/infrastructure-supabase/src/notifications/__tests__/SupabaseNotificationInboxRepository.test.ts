import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseNotificationInboxRepository } from '../SupabaseNotificationInboxRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

function repo(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_fn: string, _args?: unknown) => result);
  return { r: new SupabaseNotificationInboxRepository({ rpc } as unknown as SupabaseClient<any>), rpc };
}

const row = {
  id: 'n1',
  kind: 'post_comment',
  category: 'social',
  world_slug: 'items',
  entity_type: 'post',
  entity_id: 'p1',
  title_key: 'notifications.postCommentTitle',
  body_key: 'notifications.postCommentBody',
  data: { post_id: 'p1', status: 'open', nested: { dropped: true }, nothing: null },
  actor_ids: ['u1'],
  group_count: 2,
  read_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:05:00Z',
  actor_display_name: 'Dana',
  actor_avatar_url: null,
};

describe('SupabaseNotificationInboxRepository', () => {
  it('page calls notifications_page with defaults and maps rows', async () => {
    const { r, rpc } = repo({ data: [row, { ...row, id: 'n2', entity_id: null, data: null, world_slug: null }], error: null });
    await expect(r.page()).resolves.toEqual([
      {
        id: 'n1',
        kind: 'post_comment',
        category: 'social',
        worldSlug: 'items',
        entity: { type: 'post', id: 'p1' },
        titleKey: 'notifications.postCommentTitle',
        bodyKey: 'notifications.postCommentBody',
        args: { post_id: 'p1', status: 'open' },
        groupCount: 2,
        actorDisplayName: 'Dana',
        actorAvatarUrl: null,
        readAt: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
      expect.objectContaining({ id: 'n2', entity: null, args: {}, worldSlug: null }),
    ]);
    expect(rpc).toHaveBeenCalledWith('notifications_page', {
      p_limit: 30, p_before_created_at: null, p_before_id: null, p_category: null,
    });
  });

  it('page passes the keyset cursor and the category', async () => {
    const { r, rpc } = repo({ data: null, error: null });
    await expect(
      r.page({ limit: 10, before: { id: 'n9', createdAt: '2026-01-02T00:00:00Z' }, category: 'critical' }),
    ).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('notifications_page', {
      p_limit: 10, p_before_created_at: '2026-01-02T00:00:00Z', p_before_id: 'n9', p_category: 'critical',
    });
  });

  it('unreadCount calls notifications_unread_count', async () => {
    const { r, rpc } = repo({ data: 7, error: null });
    await expect(r.unreadCount()).resolves.toBe(7);
    expect(rpc.mock.calls[0]?.[0]).toBe('notifications_unread_count');
    await expect(repo({ data: null, error: null }).r.unreadCount()).resolves.toBe(0);
  });

  it('markRead sends the ids and skips the call for an empty list', async () => {
    const { r, rpc } = repo({ data: 2, error: null });
    await expect(r.markRead(['n1', 'n2'])).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith('notifications_mark_read', { p_ids: ['n1', 'n2'] });
    await expect(r.markRead([])).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('markAllRead calls notifications_mark_all_read', async () => {
    const { r, rpc } = repo({ data: 5, error: null });
    await expect(r.markAllRead()).resolves.toBe(5);
    expect(rpc.mock.calls[0]?.[0]).toBe('notifications_mark_all_read');
  });

  it('throws the RPC error', async () => {
    const error = { message: 'boom' };
    const { r } = repo({ data: null, error });
    await expect(r.page()).rejects.toBe(error);
    await expect(r.unreadCount()).rejects.toBe(error);
    await expect(r.markRead(['n1'])).rejects.toBe(error);
    await expect(r.markAllRead()).rejects.toBe(error);
  });
});
