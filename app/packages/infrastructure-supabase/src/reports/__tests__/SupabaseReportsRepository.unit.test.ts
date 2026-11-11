import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseReportsRepository } from '../SupabaseReportsRepository';
import { chainHas, fakeStaffClient, type FakeResult } from '../../__tests__/fakeStaffClient';

const ok = (data: unknown): FakeResult => ({ data, error: null });
const refuse = (message: string, code: string): FakeResult => ({ data: null, error: { code, message } });

function repoWith(options: Parameters<typeof fakeStaffClient>[0] = {}) {
  const fake = fakeStaffClient(options);
  return { ...fake, repo: new SupabaseReportsRepository(fake.client) };
}

const openReport = (targetType: string, targetId: string, reporterId: string | null, createdAt: string) => ({
  reporter_id: reporterId, target_type: targetType, target_id: targetId, created_at: createdAt,
});

describe('SupabaseReportsRepository.listOpenInbox', () => {
  const NOW = new Date('2026-11-10T12:00:00.000Z');
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const reports = [
    openReport('post', 'p1', 'r1', '2026-11-01T10:00:00Z'),
    openReport('post', 'p1', 'r2', '2026-11-02T10:00:00Z'),
    openReport('user', 'u1', 'r1', '2026-11-03T10:00:00Z'),
    openReport('chat', 'c1', 'r3', '2026-11-04T10:00:00Z'),
    openReport('org', 'x', 'r3', '2026-11-04T11:00:00Z'),
  ];

  it('reads open reports oldest first and groups them into cases with target previews', async () => {
    const { repo, chains } = repoWith({
      tables: {
        reports: ok(reports),
        posts: ok([{ id: 'p1', title: 'Sofa', description: null, status: 'hidden_pending_review', owner_id: 'o1', created_at: '2026-10-01T00:00:00Z' }]),
        users: ok([{ id: 'u1', display_name: 'Dana', created_at: '2026-09-01T00:00:00Z' }]),
        user_account: ok([{ user_id: 'u1', status: 'active' }]),
      },
    });

    const page = await repo.listOpenInbox({}, null, 25);

    expect(chains[0]?.table).toBe('reports');
    expect(chains[0]?.calls).toEqual(expect.arrayContaining([
      ['select', ['reporter_id, target_type, target_id, created_at']],
      ['eq', ['status', 'open']],
      ['order', ['created_at', { ascending: true }]],
      ['limit', [1000]],
    ]));
    // The unknown target type `org` is dropped; the three real cases are oldest first.
    expect(page.rows.map((r) => `${r.targetType}:${r.targetId}`)).toEqual(['post:p1', 'user:u1', 'chat:c1']);
    expect(page.rows[0]).toMatchObject({
      reporterCount: 2, oldestAt: '2026-11-01T10:00:00Z', latestReporterId: 'r2',
      target: { preview: 'Sofa', status: 'hidden_pending_review', author_id: 'o1' },
    });
    expect(page.rows[1]?.target).toMatchObject({ display_name: 'Dana', status: 'active' });
    expect(page.rows[2]?.target).toEqual({});
    expect(page.nextCursor).toBeNull();
  });

  it('applies the target type, reporter and age filters to the read', async () => {
    const { repo, chains } = repoWith({ tables: { reports: ok([]) } });

    await repo.listOpenInbox({ targetType: 'post', reporterId: 'r9', maxAgeDays: 7 }, null, 25);

    expect(chainHas(chains[0]!, 'eq', 'target_type', 'post')).toBe(true);
    expect(chainHas(chains[0]!, 'eq', 'reporter_id', 'r9')).toBe(true);
    expect(chainHas(chains[0]!, 'gte', 'created_at', '2026-11-03T12:00:00.000Z')).toBe(true);
  });

  it('pages: the first page ends with a cursor, the next resumes after it', async () => {
    const { repo } = repoWith({ tables: { reports: ok(reports), posts: ok([]), users: ok([]), user_account: ok([]) } });

    const first = await repo.listOpenInbox({}, null, 2);
    expect(first.rows.map((r) => r.targetId)).toEqual(['p1', 'u1']);
    expect(first.nextCursor).toEqual({ oldestAt: '2026-11-03T10:00:00Z', targetType: 'user', targetId: 'u1' });

    const second = await repo.listOpenInbox({}, first.nextCursor, 2);
    expect(second.rows.map((r) => r.targetId)).toEqual(['c1']);
    expect(second.nextCursor).toBeNull();
  });

  it('degrades to BackendUnavailableError when the reports table is missing', async () => {
    const { repo } = repoWith({ tables: { reports: refuse('missing', 'PGRST205') } });

    const failure = await repo.listOpenInbox({}, null, 25).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BackendUnavailableError);
    expect(failure).toMatchObject({ object: 'table:reports' });
  });

  it('rethrows a real failure instead of returning an empty inbox', async () => {
    const { repo } = repoWith({ tables: { reports: refuse('boom', '57014') } });

    await expect(repo.listOpenInbox({}, null, 25)).rejects.toThrow('boom');
  });
});

describe('SupabaseReportsRepository.getCaseDetail', () => {
  const caseReports = [
    { id: 'rep1', reporter_id: 'r1', reason: 'Spam', note: 'ad', status: 'open', created_at: '2026-11-01T10:00:00Z', resolved_at: null, resolved_by: null },
    { id: 'rep2', reporter_id: null, reason: 'Other', note: null, status: 'dismissed_no_violation', created_at: '2026-11-02T10:00:00Z', resolved_at: '2026-11-03T10:00:00Z', resolved_by: 'mod1' },
  ];

  it('assembles reporters, the target preview and the audit timeline (oldest first)', async () => {
    const { repo, chains, rpcCalls } = repoWith({
      tables: {
        reports: ok(caseReports),
        users: ok([{ id: 'r1', display_name: 'Reporter One' }]),
        posts: ok([{ id: 'p1', title: null, description: 'x'.repeat(200), status: 'open', owner_id: 'o1', created_at: '2026-10-01T00:00:00Z' }]),
      },
      rpc: {
        admin_audit_search: ok([
          { id: 9, occurred_at: '2026-11-03T10:00:00Z', actor_id: 'mod1', action: 'dismiss_report', target_type: 'report', target_id: 'p1', metadata: { a: 1 } },
          { id: 8, occurred_at: '2026-11-01T10:00:00Z', actor_id: null, action: 'report_target', target_type: 'post', target_id: 'p1', metadata: null },
        ]),
      },
    });

    const detail = await repo.getCaseDetail('post', 'p1');

    expect(chainHas(chains[0]!, 'eq', 'target_type', 'post')).toBe(true);
    expect(chainHas(chains[0]!, 'eq', 'target_id', 'p1')).toBe(true);
    expect(rpcCalls).toEqual([{ name: 'admin_audit_search', args: { p_target_id: 'p1', p_limit: 50 } }]);
    expect(detail?.reporters).toEqual([
      expect.objectContaining({ reportId: 'rep1', reporterId: 'r1', reporterName: 'Reporter One', status: 'open', note: 'ad' }),
      expect.objectContaining({ reportId: 'rep2', reporterId: null, reporterName: null, status: 'dismissed_no_violation', resolvedBy: 'mod1' }),
    ]);
    expect((detail?.target as { preview: string }).preview).toHaveLength(141);
    expect(detail?.timeline.map((e) => e.eventId)).toEqual(['8', '9']);
    expect(detail?.timeline[0]).toMatchObject({ actorId: null, metadata: {}, createdAt: '2026-11-01T10:00:00Z' });
  });

  it('returns null for a target nobody reported', async () => {
    const { repo, rpcCalls } = repoWith({ tables: { reports: ok([]) } });

    expect(await repo.getCaseDetail('user', 'u1')).toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it('gives a chat case an empty target (chats are private to staff)', async () => {
    const { repo } = repoWith({ tables: { reports: ok(caseReports), users: ok([]) }, rpc: { admin_audit_search: ok([]) } });

    expect((await repo.getCaseDetail('chat', 'c1'))?.target).toEqual({});
  });

  it('degrades to BackendUnavailableError when the audit RPC is missing', async () => {
    const { repo } = repoWith({
      tables: { reports: ok(caseReports), users: ok([]), posts: ok([]) },
      rpc: { admin_audit_search: refuse('missing', 'PGRST202') },
    });

    await expect(repo.getCaseDetail('post', 'p1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('rethrows a refusal of the audit search', async () => {
    const { repo } = repoWith({
      tables: { reports: ok(caseReports), users: ok([]), posts: ok([]) },
      rpc: { admin_audit_search: refuse('forbidden', '42501') },
    });

    await expect(repo.getCaseDetail('post', 'p1')).rejects.toThrow('forbidden');
  });
});
