import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportInboxCursor } from '@kc/domain';
import { SupabaseReportsRepository } from '../SupabaseReportsRepository';

describe('SupabaseReportsRepository', () => {
  describe('listOpenInbox', () => {
    it('calls reports_open_inbox RPC with null cursor and filters when not provided', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          rows: [
            {
              target_type: 'post',
              target_id: 'p1',
              reporter_count: 2,
              oldest_at: '2026-05-25T10:00:00Z',
              latest_reporter_id: 'u1',
              target: { title: 'Spam post' },
            },
          ],
          next_cursor: null,
        },
        error: null,
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const page = await repo.listOpenInbox({}, null, 25);

      expect(rpc).toHaveBeenCalledWith('reports_open_inbox', {
        p_target_type_filter: null,
        p_max_age_days: null,
        p_reporter_filter: null,
        p_cursor: null,
        p_limit: 25,
      });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.targetType).toBe('post');
      expect(page.rows[0]?.targetId).toBe('p1');
      expect(page.nextCursor).toBeNull();
    });

    it('maps cursor payload and filters into RPC parameters', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          rows: [],
          next_cursor: {
            oldest_at: '2026-05-25T08:00:00Z',
            target_type: 'post',
            target_id: 'p2',
          },
        },
        error: null,
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const cursor: ReportInboxCursor = {
        oldestAt: '2026-05-25T09:00:00Z',
        targetType: 'post',
        targetId: 'p1',
      };
      const page = await repo.listOpenInbox(
        { targetType: 'post', maxAgeDays: 7, reporterId: 'u_reporter' },
        cursor,
        10,
      );

      expect(rpc).toHaveBeenCalledWith('reports_open_inbox', {
        p_target_type_filter: 'post',
        p_max_age_days: 7,
        p_reporter_filter: 'u_reporter',
        p_cursor: {
          oldest_at: '2026-05-25T09:00:00Z',
          target_type: 'post',
          target_id: 'p1',
        },
        p_limit: 10,
      });
      expect(page.rows).toEqual([]);
      expect(page.nextCursor).toEqual({
        oldestAt: '2026-05-25T08:00:00Z',
        targetType: 'post',
        targetId: 'p2',
      });
    });

    it('returns empty page when RPC returns an error', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation reports_open_inbox does not exist' },
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const page = await repo.listOpenInbox({}, null, 20);

      expect(page).toEqual({ rows: [], nextCursor: null });
    });
  });

  describe('getCaseDetail', () => {
    it('calls reports_case_detail RPC and parses case detail', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          target_type: 'post',
          target_id: 'p1',
          target: { title: 'Test Target' },
          reporters: [
            {
              report_id: 'r1',
              reporter_id: 'u1',
              reporter_name: 'Tester',
              reason: 'spam',
              note: 'Spammy text',
              status: 'open',
              created_at: '2026-01-01T00:00:00Z',
              resolved_at: null,
              resolved_by: null,
            },
          ],
          timeline: [],
        },
        error: null,
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const detail = await repo.getCaseDetail('post', 'p1');

      expect(rpc).toHaveBeenCalledWith('reports_case_detail', {
        p_target_type: 'post',
        p_target_id: 'p1',
      });
      expect(detail).not.toBeNull();
      expect(detail?.targetType).toBe('post');
      expect(detail?.targetId).toBe('p1');
      expect(detail?.reporters).toHaveLength(1);
      expect(detail?.reporters[0]?.reportId).toBe('r1');
    });

    it('returns null when RPC returns an error', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'permission denied' },
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const detail = await repo.getCaseDetail('post', 'p1');
      expect(detail).toBeNull();
    });

    it('returns null when RPC returns null data or malformed payload', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const client = { rpc } as unknown as SupabaseClient;
      const repo = new SupabaseReportsRepository(client);

      const detail = await repo.getCaseDetail('post', 'missing');
      expect(detail).toBeNull();
    });
  });
});
