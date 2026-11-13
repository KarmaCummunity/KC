// Behavioural in-memory IReportRepository (G39 contract fake). Unlike the spy
// FakeReportRepository (call capture + injected error), it applies the rules of
// the reports table and its validation trigger, and must pass the same
// reportRepositoryContract cases as SupabaseReportRepository. Bound to one actor,
// the way RLS and auth.uid() scope the adapter to its signed-in user.
//
// Members (report targets) come from the chat contract's store.

import type { ReportSubmission } from '@kc/domain';
import { REPORT_NOTE_MAX_LENGTH } from '@kc/domain';
import type { IReportRepository } from '../../ports/IReportRepository';
import type { InMemoryChatStore } from '../../chat/__tests__/inMemoryChatStore';
import { ReportError } from '../errors';

/** One stored (always open) `reports` row: what the duplicate rule needs. */
export interface StoredReport {
  readonly reporterId: string;
  readonly targetType: ReportSubmission['targetType'];
  readonly targetId: string;
}

export class InMemoryReportRepository implements IReportRepository {
  constructor(
    private readonly store: InMemoryChatStore,
    private readonly reports: StoredReport[],
    private readonly actorId: string,
  ) {}

  async submit(reporterId: string, input: ReportSubmission): Promise<void> {
    // reports_insert_self: a member reports only in their own name (RLS refusal).
    if (reporterId !== this.actorId) throw new ReportError('unknown', 'new row violates row-level security policy');
    if (input.note !== undefined && input.note.length > REPORT_NOTE_MAX_LENGTH) {
      throw new ReportError('invalid_target', 'reports_note_check');
    }
    this.assertTargetAllowed(input);
    // reports_open_per_reporter_key: one open report per reporter and target.
    if (this.hasOpenReport(input)) {
      throw new ReportError('duplicate_within_24h', 'duplicate_report');
    }
    this.reports.push({ reporterId, targetType: input.targetType, targetId: input.targetId });
  }

  /** The target rules: a member must exist and must not be the reporter; a chat is stored as given. */
  private assertTargetAllowed(input: ReportSubmission): void {
    if (input.targetType === 'user') {
      if (!this.store.users.has(input.targetId)) throw new ReportError('invalid_target', 'report_target_not_found');
      if (input.targetId === this.actorId) throw new ReportError('cannot_report_self', 'cannot_report_self');
    }
    if (input.targetType === 'post' || input.targetType === 'listing' || input.targetType === 'comment') {
      // Posts and comments live in other stores; this fake does not model them.
      throw new ReportError('invalid_target', `${input.targetType} targets are not modelled by this fake`);
    }
  }

  private hasOpenReport(input: ReportSubmission): boolean {
    return this.reports.some(
      (r) => r.reporterId === this.actorId && r.targetType === input.targetType && r.targetId === input.targetId,
    );
  }
}
