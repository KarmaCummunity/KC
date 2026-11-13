import {
  invalidWhatsAppSendLimitFields,
  isWhatsAppTemplateMetaStatus,
  WhatsAppAdminError,
  type WhatsAppAdminOverview,
  type WhatsAppChannelConfig,
  type WhatsAppConsentRow,
  type WhatsAppConversationRow,
  type WhatsAppMatchSentRow,
  type WhatsAppOutboundRow,
  type WhatsAppPage,
  type WhatsAppRateHit,
  type WhatsAppReviewDecision,
  type WhatsAppReviewItem,
  type WhatsAppSendLimits,
  type WhatsAppSendLimitsPatch,
  type WhatsAppTemplateRow,
} from '@kc/domain';
import type {
  IWhatsAppAdminRepository,
  SetWhatsAppTemplateStatusInput,
  WhatsAppOutboundListFilters,
  WhatsAppPageQuery,
  WhatsAppReviewListFilters,
} from './IWhatsAppAdminRepository';

export class GetWhatsAppAdminOverviewUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(): Promise<WhatsAppAdminOverview> { return this.repo.overview(); }
}

export class GetWhatsAppChannelUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(): Promise<WhatsAppChannelConfig> { return this.repo.getChannel(); }
}

export class SetWhatsAppChannelEnabledUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(enabled: boolean): Promise<WhatsAppChannelConfig> {
    return this.repo.setChannelEnabled(enabled);
  }
}

export class ListWhatsAppConsentUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(query: WhatsAppPageQuery = {}): Promise<WhatsAppPage<WhatsAppConsentRow>> {
    return this.repo.listConsent(query);
  }
}

export class ListWhatsAppOutboundUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(filters: WhatsAppOutboundListFilters = {}): Promise<WhatsAppPage<WhatsAppOutboundRow>> {
    return this.repo.listOutbound(filters);
  }
}

export class ListWhatsAppRateHitsUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(limit?: number): Promise<WhatsAppRateHit[]> { return this.repo.listRateHits(limit); }
}

export class ListWhatsAppRecentMatchesUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(limit?: number): Promise<WhatsAppMatchSentRow[]> { return this.repo.listRecentMatches(limit); }
}

export class ListWhatsAppConversationsUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(limit?: number): Promise<WhatsAppConversationRow[]> { return this.repo.listConversations(limit); }
}

export class ResendWhatsAppOutboundUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(outboundId: string): Promise<string> { return this.repo.resend(outboundId); }
}

export class BlockWhatsAppUserUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(userId: string): Promise<void> { return this.repo.blockUser(userId); }
}

export class ListWhatsAppReviewsUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(filters: WhatsAppReviewListFilters = {}): Promise<WhatsAppPage<WhatsAppReviewItem>> {
    return this.repo.listReviews(filters);
  }
}

/** Approving publishes the bot post for its owner; rejecting leaves the draft to them. */
export class ResolveWhatsAppReviewUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(reviewId: string, decision: WhatsAppReviewDecision): Promise<WhatsAppReviewDecision> {
    if (decision !== 'approved' && decision !== 'rejected') {
      return Promise.reject(new WhatsAppAdminError('invalid_decision'));
    }
    return this.repo.resolveReview(reviewId, decision);
  }
}

export class ListWhatsAppTemplatesUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(): Promise<WhatsAppTemplateRow[]> { return this.repo.listTemplates(); }
}

/** Staff: the current send limits, shown in the console before any change. */
export class GetWhatsAppSendLimitsUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(): Promise<WhatsAppSendLimits> { return this.repo.getSendLimits(); }
}

/** Super admin: changes some send limits; refuses an empty patch or a value out of range. */
export class SetWhatsAppSendLimitsUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(patch: WhatsAppSendLimitsPatch): Promise<WhatsAppSendLimits> {
    const given = Object.values(patch).filter((value) => value !== undefined);
    const invalid = invalidWhatsAppSendLimitFields(patch);
    if (given.length === 0 || invalid.length > 0) {
      return Promise.reject(new WhatsAppAdminError('invalid_limits', invalid.join(',') || 'empty'));
    }
    return this.repo.setSendLimits(patch);
  }
}

/** Super admin: records a template's Meta state (approved makes it sendable). */
export class SetWhatsAppTemplateStatusUseCase {
  constructor(private readonly repo: IWhatsAppAdminRepository) {}
  execute(input: SetWhatsAppTemplateStatusInput): Promise<void> {
    if (!isWhatsAppTemplateMetaStatus(input.metaStatus)) {
      return Promise.reject(new WhatsAppAdminError('invalid_status'));
    }
    return this.repo.setTemplateStatus(input);
  }
}
