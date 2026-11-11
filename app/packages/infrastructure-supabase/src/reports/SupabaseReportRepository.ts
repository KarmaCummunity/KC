import type { SupabaseClient } from '@supabase/supabase-js';
import type { IReportRepository } from '@kc/application';
import { ReportError } from '@kc/application';
import type { ReportSubmission } from '@kc/domain';
import type { Database } from '../database.types';

export class SupabaseReportRepository implements IReportRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async submit(reporterId: string, input: ReportSubmission): Promise<void> {
    const { error } = await this.client.from('reports').insert({
      reporter_id: reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      note: input.note ?? null,
    });
    if (error) {
      if (error.code === '23505') throw new ReportError('duplicate_within_24h', error.message, error);
      // Postgres trigger raises duplicate_report with unique_violation SQLSTATE
      // (23505) too, but distinguishes via message body.
      if (error.message?.includes('duplicate_report'))
        throw new ReportError('duplicate_within_24h', error.message, error);
      // TD-94 (2): distinct error when the target has already been moderated.
      if (error.code === 'P0020')
        throw new ReportError('target_already_moderated', error.message, error);
      // #2061: these guards raise their own message; matching on it keeps them from collapsing
      // into the generic failure (23514 is shared with the target-shape CHECK below).
      if (error.message?.includes('cannot_report_self'))
        throw new ReportError('cannot_report_self', error.message, error);
      if (error.message?.includes('rate_limit_exceeded'))
        throw new ReportError('rate_limited', error.message, error);
      if (error.code === '23514' || error.code === '23502')
        throw new ReportError('invalid_target', error.message, error);
      throw new ReportError('unknown', error.message, error);
    }
  }
}
