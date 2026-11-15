import { describe, it, expect } from 'vitest';
import { ReportError } from '@kc/application';
import { BackendUnavailableError, type ReportSubmission } from '@kc/domain';
import { SupabaseReportRepository } from '../SupabaseReportRepository';
import { fakeStaffClient } from '../../__tests__/fakeStaffClient';

const POST_SUBMISSION: ReportSubmission = {
  targetType: 'post',
  targetId: 'p_1',
  reason: 'Spam',
  note: 'spammy content',
};

/** A client whose `reports` insert resolves to `error` (or succeeds), recording the inserted row. */
function reportsClient(error: { code?: string; message: string } | null) {
  const fake = fakeStaffClient({ tables: { reports: { data: null, error } } });
  return { ...fake, repo: new SupabaseReportRepository(fake.client) };
}

/** The row passed to `insert(...)` on the first `reports` chain. */
const insertedRow = (chains: ReturnType<typeof fakeStaffClient>['chains']): unknown =>
  chains[0]?.calls.find(([method]) => method === 'insert')?.[1][0];

describe('SupabaseReportRepository — insert shape', () => {
  it('inserts into the reports table with the snake_case row', async () => {
    const { chains, repo } = reportsClient(null);

    await repo.submit('u_reporter', POST_SUBMISSION);

    expect(chains).toHaveLength(1);
    expect(chains[0]?.table).toBe('reports');
    expect(insertedRow(chains)).toEqual({
      reporter_id: 'u_reporter',
      target_type: 'post',
      target_id: 'p_1',
      reason: 'Spam',
      note: 'spammy content',
    });
  });

  it('coalesces an undefined note to null', async () => {
    const { chains, repo } = reportsClient(null);

    await repo.submit('u_reporter', { targetType: 'user', targetId: 'u_target', reason: 'Offensive' });

    expect((insertedRow(chains) as { note: unknown }).note).toBeNull();
  });

  it('files a listing report against its post (a listing is a post)', async () => {
    const { chains, repo } = reportsClient(null);

    await repo.submit('u_reporter', { targetType: 'listing', targetId: 'l_1', reason: 'Illegal' });

    expect(insertedRow(chains)).toMatchObject({ target_type: 'post', target_id: 'l_1' });
  });

  it('files comment and chat reports as they are', async () => {
    const { chains, repo } = reportsClient(null);

    await repo.submit('u_reporter', { targetType: 'comment', targetId: 'c_1', reason: 'Spam' });
    await repo.submit('u_reporter', { targetType: 'chat', targetId: 'ch_1', reason: 'Spam' });

    expect(chains.map((c) => (c.calls[0]?.[1][0] as { target_type: string }).target_type)).toEqual(['comment', 'chat']);
  });

  it('resolves to void on a successful insert', async () => {
    const { repo } = reportsClient(null);

    await expect(repo.submit('u_reporter', POST_SUBMISSION)).resolves.toBeUndefined();
  });
});

describe('SupabaseReportRepository — error mapping', () => {
  it.each([
    ['report_target_not_found', 'invalid_target'],
    ['cannot_report_self', 'cannot_report_self'],
    ['target_already_moderated', 'target_already_moderated'],
    ['rate_limited', 'rate_limited'],
  ] as const)('maps the stable P0001 message %s to ReportError(%s)', async (message, code) => {
    const { repo } = reportsClient({ code: 'P0001', message });

    await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({ name: 'ReportError', code });
  });

  it('maps the unique index on open reports (23505) to duplicate_within_24h', async () => {
    const { repo } = reportsClient({ code: '23505', message: 'duplicate key value violates reports_open_per_reporter_key' });

    await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({ code: 'duplicate_within_24h' });
  });

  it.each(['23514', '23502'])('maps SQLSTATE %s (note length, missing column) to invalid_target', async (code) => {
    const { repo } = reportsClient({ code, message: 'constraint' });

    await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({ code: 'invalid_target' });
  });

  it('maps an RLS refusal (inactive reporter) and any unknown failure to unknown', async () => {
    for (const error of [
      { code: '42501', message: 'new row violates row-level security policy for table "reports"' },
      { message: 'connection reset' },
      { code: 'P0001', message: 'some_future_reason' },
    ]) {
      await expect(reportsClient(error).repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'unknown',
      });
    }
  });

  it('degrades to BackendUnavailableError when the reports table is not deployed', async () => {
    const { repo } = reportsClient({ code: 'PGRST205', message: "Could not find the table 'public.reports'" });

    const failure = await repo.submit('u_reporter', POST_SUBMISSION).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BackendUnavailableError);
    expect(failure).toMatchObject({ object: 'table:reports', kind: 'relation' });
  });

  it('forwards the original database error as cause and keeps its message', async () => {
    const pgError = { code: '23505', message: 'dup msg verbatim' };
    const { repo } = reportsClient(pgError);

    const failure = await repo.submit('u_reporter', POST_SUBMISSION).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ReportError);
    expect((failure as ReportError).cause).toBe(pgError);
    expect((failure as ReportError).message).toBe('dup msg verbatim');
  });
});
