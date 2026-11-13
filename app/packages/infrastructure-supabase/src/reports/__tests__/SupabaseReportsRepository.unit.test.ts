import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseReportsRepository } from '../SupabaseReportsRepository';
import { chainHas, fakeStaffClient, type FakeResult } from '../../__tests__/fakeStaffClient';

const ok = (data: unknown): FakeResult => ({ data, error: null });
const refuse = (message: string, code: string): FakeResult => ({ data: null, error: { code, message } });

function repoWith(options: Parameters<typeof fakeStaffClient>[0] = {}) {
  const fake = fakeStaffClient(options);
  return { ...fake, repo: new SupabaseReportsRepository(fake.client) };
}

const inboxRow = (targetType: string, targetId: string, reporters: number, oldestAt: string, latest: string | null) => ({
  target_type: targetType, target_id: targetId, reporter_count: reporters, report_count: reporters,
  oldest_at: oldestAt, latest_at: oldestAt, latest_reporter_id: latest, target_hidden_at: null,
});

describe('SupabaseReportsRepository.listOpenInbox', () => {
  const cases = [
    inboxRow('post', 'p1', 2, '2026-11-01T10:00:00Z', 'r2'),
    inboxRow('user', 'u1', 1, '2026-11-03T10:00:00Z', 'r1'),
    inboxRow('chat', 'c1', 1, '2026-11-04T10:00:00Z', 'r3'),
    inboxRow('org', 'x', 1, '2026-11-04T11:00:00Z', 'r3'),
  ];

  it('reads the server-grouped cases (no device cap) and attaches their target previews', async () => {
    const { repo, rpcCalls } = repoWith({
      rpc: { admin_reports_inbox: ok(cases) },
      tables: {
        posts: ok([{ id: 'p1', title: 'Sofa', description: null, status: 'hidden_pending_review', owner_id: 'o1', created_at: '2026-10-01T00:00:00Z' }]),
        users: ok([{ id: 'u1', display_name: 'Dana', created_at: '2026-09-01T00:00:00Z' }]),
        user_account: ok([{ user_id: 'u1', status: 'active' }]),
        chats: ok([{ id: 'c1', moderation_hidden_at: '2026-11-04T11:00:00Z', created_at: '2026-10-01T00:00:00Z' }]),
      },
    });

    const page = await repo.listOpenInbox({}, null, 25);

    expect(rpcCalls[0]).toEqual({ name: 'admin_reports_inbox', args: expect.objectContaining({ p_limit: 25 }) });
    // The unknown target type `org` is dropped; the three real cases keep the server order.
    expect(page.rows.map((r) => `${r.targetType}:${r.targetId}`)).toEqual(['post:p1', 'user:u1', 'chat:c1']);
    expect(page.rows[0]).toMatchObject({
      reporterCount: 2, oldestAt: '2026-11-01T10:00:00Z', latestReporterId: 'r2',
      target: { preview: 'Sofa', status: 'hidden_pending_review', author_id: 'o1' },
    });
    expect(page.rows[1]?.target).toMatchObject({ display_name: 'Dana', status: 'active' });
    expect(page.rows[2]?.target).toMatchObject({ removed_at: '2026-11-04T11:00:00Z' });
    expect(page.nextCursor).toBeNull();
  });

  it('sends the filters and the search text to the server', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { admin_reports_inbox: ok([]) } });

    await repo.listOpenInbox({ targetType: 'post', reporterId: 'r9', maxAgeDays: 7, search: '  dana ' }, null, 25);

    expect(rpcCalls[0]?.args).toMatchObject({
      p_target_type: 'post', p_reporter_id: 'r9', p_max_age_days: 7, p_search: 'dana', p_limit: 25,
    });
  });

  it('pages: a full page ends with a cursor that the next call sends back', async () => {
    const { repo, rpcCalls } = repoWith({
      rpc: { admin_reports_inbox: ok(cases.slice(0, 2)) },
      tables: { posts: ok([]), users: ok([]), user_account: ok([]) },
    });

    const first = await repo.listOpenInbox({}, null, 2);
    expect(first.nextCursor).toEqual({ oldestAt: '2026-11-03T10:00:00Z', targetType: 'user', targetId: 'u1' });

    await repo.listOpenInbox({}, first.nextCursor, 2);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_after_oldest_at: '2026-11-03T10:00:00Z', p_after_target_type: 'user', p_after_target_id: 'u1',
    });
  });

  it('degrades to BackendUnavailableError when the inbox function is missing', async () => {
    const { repo } = repoWith({ rpc: { admin_reports_inbox: refuse('missing', 'PGRST202') } });

    const failure = await repo.listOpenInbox({}, null, 25).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BackendUnavailableError);
    expect(failure).toMatchObject({ object: 'rpc:admin_reports_inbox' });
  });

  it('rethrows a real failure instead of returning an empty inbox', async () => {
    const { repo } = repoWith({ rpc: { admin_reports_inbox: refuse('boom', '57014') } });

    await expect(repo.listOpenInbox({}, null, 25)).rejects.toThrow('boom');
  });
});

describe('SupabaseReportsRepository.getCaseDetail', () => {
  const caseReports = [
    { id: 'rep1', reporter_id: 'r1', reason: 'Spam', note: 'ad', status: 'open', created_at: '2026-11-01T10:00:00Z', resolved_at: null, resolved_by: null },
    { id: 'rep2', reporter_id: null, reason: 'Other', note: null, status: 'dismissed_no_violation', created_at: '2026-11-02T10:00:00Z', resolved_at: '2026-11-03T10:00:00Z', resolved_by: 'mod1' },
  ];

  it('assembles reporters, the target preview and the whole case timeline (oldest first)', async () => {
    const { repo, chains, rpcCalls } = repoWith({
      tables: {
        reports: ok(caseReports),
        users: ok([{ id: 'r1', display_name: 'Reporter One' }]),
        posts: ok([{ id: 'p1', title: null, description: 'x'.repeat(200), status: 'open', owner_id: 'o1', created_at: '2026-10-01T00:00:00Z' }]),
      },
      rpc: {
        admin_report_case_timeline: ok([
          { id: 8, occurred_at: '2026-11-01T10:00:00Z', actor_id: null, action: 'report_target', target_type: 'post', target_id: 'p1', metadata: null },
          { id: 9, occurred_at: '2026-11-03T10:00:00Z', actor_id: 'mod1', action: 'dismiss_report', target_type: 'report', target_id: 'rep2', metadata: { a: 1 } },
        ]),
      },
    });

    const detail = await repo.getCaseDetail('post', 'p1');

    expect(chainHas(chains[0]!, 'eq', 'target_type', 'post')).toBe(true);
    expect(chainHas(chains[0]!, 'eq', 'target_id', 'p1')).toBe(true);
    expect(rpcCalls).toEqual([{
      name: 'admin_report_case_timeline', args: { p_target_type: 'post', p_target_id: 'p1', p_limit: 100 },
    }]);
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

  it('gives a chat case its hidden-for-review time, never its messages', async () => {
    const { repo, chains } = repoWith({
      tables: { reports: ok(caseReports), users: ok([]), chats: ok([{ id: 'c1', moderation_hidden_at: null, created_at: '2026-10-01T00:00:00Z' }]) },
      rpc: { admin_report_case_timeline: ok([]) },
    });

    expect((await repo.getCaseDetail('chat', 'c1'))?.target).toEqual({ removed_at: null, created_at: '2026-10-01T00:00:00Z' });
    expect(chains.map((c) => c.table)).not.toContain('messages');
  });

  it('degrades to BackendUnavailableError when the timeline RPC is missing', async () => {
    const { repo } = repoWith({
      tables: { reports: ok(caseReports), users: ok([]), posts: ok([]) },
      rpc: { admin_report_case_timeline: refuse('missing', 'PGRST202') },
    });

    await expect(repo.getCaseDetail('post', 'p1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('rethrows a refusal of the timeline', async () => {
    const { repo } = repoWith({
      tables: { reports: ok(caseReports), users: ok([]), posts: ok([]) },
      rpc: { admin_report_case_timeline: refuse('forbidden', '42501') },
    });

    await expect(repo.getCaseDetail('post', 'p1')).rejects.toThrow('forbidden');
  });
});
