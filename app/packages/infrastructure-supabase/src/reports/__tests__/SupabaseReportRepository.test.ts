import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReportError } from '@kc/application';
import type { ReportSubmission } from '@kc/domain';
import { SupabaseReportRepository } from '../SupabaseReportRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface InsertCall {
  table: string;
  row: unknown;
}

function makeFakeClient(opts: {
  error?: { code?: string; message: string } | null;
}): { client: SupabaseClient<any>; calls: InsertCall[] } {
  const calls: InsertCall[] = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: unknown) => {
        calls.push({ table, row });
        return { error: opts.error ?? null };
      },
    }),
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const POST_SUBMISSION: ReportSubmission = {
  targetType: 'post',
  targetId: 'p_1',
  reason: 'Spam',
  note: 'spammy content',
};

describe('SupabaseReportRepository', () => {
  describe('submit — insert shape', () => {
    it('inserts into the reports table', async () => {
      const { client, calls } = makeFakeClient({});
      const repo = new SupabaseReportRepository(client);

      await repo.submit('u_reporter', POST_SUBMISSION);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.table).toBe('reports');
    });

    it('maps the camelCase submission to the snake_case row shape', async () => {
      const { client, calls } = makeFakeClient({});
      const repo = new SupabaseReportRepository(client);

      await repo.submit('u_reporter', POST_SUBMISSION);

      expect(calls[0]?.row).toEqual({
        reporter_id: 'u_reporter',
        target_type: 'post',
        target_id: 'p_1',
        reason: 'Spam',
        note: 'spammy content',
      });
    });

    it('coalesces undefined note to null in the row', async () => {
      // Domain says note is `string | undefined`; DB column is nullable.
      // The repo must coalesce so we never write `note: undefined`, which
      // PostgREST would either drop silently or reject depending on version.
      const { client, calls } = makeFakeClient({});
      const repo = new SupabaseReportRepository(client);

      await repo.submit('u_reporter', {
        targetType: 'user',
        targetId: 'u_target',
        reason: 'Offensive',
      });

      expect((calls[0]?.row as { note: unknown }).note).toBeNull();
    });

    it('forwards null targetId verbatim (targetType=none case)', async () => {
      const { client, calls } = makeFakeClient({});
      const repo = new SupabaseReportRepository(client);

      await repo.submit('u_reporter', {
        targetType: 'none',
        targetId: null,
        reason: 'Other',
      });

      expect((calls[0]?.row as { target_id: unknown }).target_id).toBeNull();
    });

    it('resolves to void on a successful insert (no return value)', async () => {
      const { client } = makeFakeClient({});
      const repo = new SupabaseReportRepository(client);

      const result = await repo.submit('u_reporter', POST_SUBMISSION);

      expect(result).toBeUndefined();
    });
  });

  describe('submit — Postgres error mapping', () => {
    it('maps SQLSTATE 23505 → ReportError("duplicate_within_24h") (the unique reporter+target+24h index)', async () => {
      const { client } = makeFakeClient({
        error: { code: '23505', message: 'duplicate key on reports_reporter_target_24h_idx' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'duplicate_within_24h',
      });
    });

    it('maps message containing duplicate_report → ReportError("duplicate_within_24h")', async () => {
      const { client } = makeFakeClient({
        error: { message: 'trigger: duplicate_report error' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'duplicate_within_24h',
      });
    });

    it('maps SQLSTATE P0020 → ReportError("target_already_moderated")', async () => {
      const { client } = makeFakeClient({
        error: { code: 'P0020', message: 'target has already been removed' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'target_already_moderated',
      });
    });

    it('maps the report_target_not_visible trigger error (23514) → ReportError("invalid_target")', async () => {
      const { client } = makeFakeClient({
        error: { code: '23514', message: 'report_target_not_visible' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({ code: 'invalid_target' });
    });

    // Regression for #2061: the self-report guard raises the same SQLSTATE as the target shape
    // check (23514), so it must be told apart by message or it surfaces as a generic failure.
    it('maps the cannot_report_self trigger error (23514) → ReportError("cannot_report_self")', async () => {
      const { client } = makeFakeClient({
        error: { code: '23514', message: 'cannot_report_self' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'cannot_report_self',
      });
    });

    // Regression for #2061: the per-reporter hourly cap (enforce_rate_limit, SQLSTATE 22023)
    // used to fall into "unknown" and show the generic error.
    it('maps rate_limit_exceeded (22023) → ReportError("rate_limited")', async () => {
      const { client } = makeFakeClient({
        error: { code: '22023', message: 'rate_limit_exceeded' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'rate_limited',
      });
    });

    it('maps SQLSTATE 23514 (CHECK violation) → ReportError("invalid_target")', async () => {
      const { client } = makeFakeClient({
        error: { code: '23514', message: 'reports_target_check' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'invalid_target',
      });
    });

    it('maps SQLSTATE 23502 (NOT NULL violation) → ReportError("invalid_target")', async () => {
      const { client } = makeFakeClient({
        error: { code: '23502', message: 'null value in column "target_id"' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'invalid_target',
      });
    });

    it('maps any other Postgres code → ReportError("unknown")', async () => {
      const { client } = makeFakeClient({
        error: { code: '42501', message: 'permission denied for table reports' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'unknown',
      });
    });

    it('maps an error with no code → ReportError("unknown")', async () => {
      const { client } = makeFakeClient({
        error: { message: 'connection reset' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toMatchObject({
        name: 'ReportError',
        code: 'unknown',
      });
    });

    it('forwards the original Postgres error as cause on every error branch', async () => {
      const pgError = { code: '23505', message: 'dup' };
      const { client } = makeFakeClient({ error: pgError });
      const repo = new SupabaseReportRepository(client);

      try {
        await repo.submit('u_reporter', POST_SUBMISSION);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReportError);
        expect((err as ReportError).cause).toBe(pgError);
      }
    });

    it('uses the Postgres error message as the thrown error message', async () => {
      const { client } = makeFakeClient({
        error: { code: '23505', message: 'dup msg verbatim' },
      });
      const repo = new SupabaseReportRepository(client);

      await expect(repo.submit('u_reporter', POST_SUBMISSION)).rejects.toThrow('dup msg verbatim');
    });
  });
});
