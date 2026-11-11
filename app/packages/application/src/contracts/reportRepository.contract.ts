// IReportRepository contract (G39) — what every implementation must accept and
// refuse when a member files a report. Mapped to FR-MOD-001 AC2 (reason + note
// of at most 500 characters), AC3 (the report is stored) and AC7 (one report per
// reporter and target per 24 hours), plus the target rules of the reports
// validation trigger: no self-reports, the target must exist, and a chat may be
// reported only by its participants.
//
// The port exposes `submit` only, so each case observes acceptance or a typed
// refusal. User and chat targets cover the rules; post and listing targets need
// their own fixtures and stay in the DB tests (supabase/tests).

import { REPORT_NOTE_MAX_LENGTH } from '@kc/domain';
import type { IChatRepository } from '../ports/IChatRepository';
import type { IReportRepository } from '../ports/IReportRepository';
import type { ContractCase } from './types';
import { assertRejects, assertRejectsWithCode } from './assert';

export interface ReportActor {
  readonly userId: string;
  /** Report repository acting as `userId` (for the Supabase adapter: that user's signed-in client). */
  readonly reports: IReportRepository;
  /** Chat repository acting as `userId`: chats are a report target. */
  readonly chats: IChatRepository;
}

export interface ReportContractContext {
  /** A new active member who has reported nothing yet. */
  newActor(): Promise<ReportActor>;
}

type Ctx = ReportContractContext;

/** A report on another member. */
function reportUser(reporter: ReportActor, targetId: string, note?: string): Promise<void> {
  return reporter.reports.submit(reporter.userId, {
    targetType: 'user',
    targetId,
    reason: 'Spam',
    ...(note === undefined ? {} : { note }),
  });
}

const reportAnotherMember: ContractCase<Ctx> = {
  name: 'submit: a member reports another member, with or without a note (FR-MOD-001 AC3)',
  async run(ctx) {
    const reporter = await ctx.newActor();
    const target = await ctx.newActor();
    const other = await ctx.newActor();
    await reportUser(reporter, target.userId);
    await reportUser(reporter, other.userId, 'keeps sending the same offer');
  },
};

const oneReportPerDay: ContractCase<Ctx> = {
  name: 'submit: the same reporter may report a target once per 24 hours; other reporters still may (FR-MOD-001 AC7)',
  async run(ctx) {
    const reporter = await ctx.newActor();
    const second = await ctx.newActor();
    const target = await ctx.newActor();
    await reportUser(reporter, target.userId);
    await assertRejectsWithCode(reportUser(reporter, target.userId), 'duplicate_within_24h', 'second report on the same target');
    await reportUser(second, target.userId);
  },
};

const generalReportsRepeat: ContractCase<Ctx> = {
  name: "submit: a general report (target 'none') is not limited to one per day",
  async run(ctx) {
    const reporter = await ctx.newActor();
    const general = { targetType: 'none' as const, targetId: null, reason: 'Other' as const, note: 'the map does not load' };
    await reporter.reports.submit(reporter.userId, general);
    await reporter.reports.submit(reporter.userId, general);
  },
};

const noSelfReport: ContractCase<Ctx> = {
  name: 'submit: a member cannot report themselves (cannot_report_self)',
  async run(ctx) {
    const reporter = await ctx.newActor();
    await assertRejectsWithCode(reportUser(reporter, reporter.userId), 'cannot_report_self', 'self-report');
  },
};

const targetMustExist: ContractCase<Ctx> = {
  name: 'submit: the target must exist (invalid_target)',
  async run(ctx) {
    const reporter = await ctx.newActor();
    await assertRejectsWithCode(reportUser(reporter, crypto.randomUUID()), 'invalid_target', 'report on an unknown user');
    await assertRejectsWithCode(
      reporter.reports.submit(reporter.userId, { targetType: 'chat', targetId: crypto.randomUUID(), reason: 'Offensive' }),
      'invalid_target',
      'report on an unknown chat',
    );
  },
};

const chatParticipantsOnly: ContractCase<Ctx> = {
  name: 'submit: only a participant may report a chat (invalid_target for anyone else)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const outsider = await ctx.newActor();
    const { chatId } = await a.chats.findOrCreateChat(a.userId, b.userId);
    await b.reports.submit(b.userId, { targetType: 'chat', targetId: chatId, reason: 'Offensive' });
    await assertRejectsWithCode(
      outsider.reports.submit(outsider.userId, { targetType: 'chat', targetId: chatId, reason: 'Offensive' }),
      'invalid_target',
      "report on a chat the reporter is not in",
    );
  },
};

const noteBounded: ContractCase<Ctx> = {
  name: `submit: a note of up to ${REPORT_NOTE_MAX_LENGTH} characters (FR-MOD-001 AC2); a longer one is refused`,
  async run(ctx) {
    const reporter = await ctx.newActor();
    const target = await ctx.newActor();
    const other = await ctx.newActor();
    await reportUser(reporter, target.userId, 'n'.repeat(REPORT_NOTE_MAX_LENGTH));
    await assertRejectsWithCode(
      reportUser(reporter, other.userId, 'n'.repeat(REPORT_NOTE_MAX_LENGTH + 1)),
      'invalid_target',
      'note one character over the limit',
    );
  },
};

const reporterIsTheActor: ContractCase<Ctx> = {
  name: "submit: a member cannot file a report in someone else's name",
  async run(ctx) {
    const actor = await ctx.newActor();
    const impersonated = await ctx.newActor();
    const target = await ctx.newActor();
    await assertRejects(
      actor.reports.submit(impersonated.userId, { targetType: 'user', targetId: target.userId, reason: 'Spam' }),
      'report with another member as the reporter',
    );
  },
};

/** Every case an IReportRepository implementation must pass. */
export function reportRepositoryContract(): ContractCase<ReportContractContext>[] {
  return [
    reportAnotherMember,
    oneReportPerDay,
    generalReportsRepeat,
    noSelfReport,
    targetMustExist,
    chatParticipantsOnly,
    noteBounded,
    reporterIsTheActor,
  ];
}
