import type { SupabaseClient } from '@supabase/supabase-js';
import type { IReportRepository } from '@kc/application';
import { ReportError } from '@kc/application';
import { BackendUnavailableError, type ReportSubmission } from '@kc/domain';
import type { Database } from '../database.types';
import { refusalReason } from '../admin/refusalReason';
import { mapRpcError } from '../rpc/mapRpcError';

type ReportInsert = Database['public']['Tables']['reports']['Insert'];
type ReportTarget = ReportInsert['target_type'];

/** A listing is a post in the baseline, so a listing report is filed against its post. */
function reportTargetOf(type: ReportSubmission['targetType']): ReportTarget {
  return type === 'listing' ? 'post' : type;
}

/** Stable `P0001` messages of the `reports_validate` trigger and the rate limiter. */
const REASON_TO_CODE: Readonly<Record<string, ReportError['code']>> = {
  report_target_not_found: 'invalid_target',
  cannot_report_self: 'cannot_report_self',
  target_already_moderated: 'target_already_moderated',
  rate_limited: 'rate_limited',
};

/** Table-level failures that are not `P0001` refusals: unique and check constraints. */
function constraintCode(code: string | undefined): ReportError['code'] | null {
  // 23505: `reports_open_per_reporter_key`, one open report per reporter and target.
  if (code === '23505') return 'duplicate_within_24h';
  // 23514 / 23502: the note length check, or a required column left empty.
  if (code === '23514' || code === '23502') return 'invalid_target';
  return null;
}

/** FR-MOD-001 — files a report as a plain insert into `reports`; the triggers do the rest. */
export class SupabaseReportRepository implements IReportRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async submit(reporterId: string, input: ReportSubmission): Promise<void> {
    const { error } = await this.client.from('reports').insert({
      reporter_id: reporterId,
      target_type: reportTargetOf(input.targetType),
      target_id: input.targetId,
      reason: input.reason,
      note: input.note ?? null,
    });
    if (!error) return;

    const byConstraint = constraintCode(error.code);
    if (byConstraint) throw new ReportError(byConstraint, error.message, error);

    const failure = mapRpcError('table:reports', error);
    if (failure instanceof BackendUnavailableError) throw failure;
    const code = REASON_TO_CODE[refusalReason(failure) ?? ''];
    throw new ReportError(code ?? 'unknown', error.message, error);
  }
}
