import type {
  WhatsAppAdminOverview,
  WhatsAppChannelConfig,
  WhatsAppConsentRow,
  WhatsAppConversationRow,
  WhatsAppMatchSentRow,
  WhatsAppOutboundRow,
  WhatsAppPage,
  WhatsAppRateHit,
  WhatsAppReviewDecision,
  WhatsAppReviewItem,
  WhatsAppReviewStatus,
  WhatsAppSendLimits,
  WhatsAppSendLimitsPatch,
  WhatsAppTemplateMetaStatus,
  WhatsAppTemplateRow,
} from '@kc/domain';

/** A keyset-paged request: the `nextCursor` of the previous page, or none for the first. */
export type WhatsAppPageQuery = {
  readonly cursor?: string;
  readonly limit?: number;
};

export type WhatsAppOutboundListFilters = WhatsAppPageQuery & {
  /** One outbound status; all of them when left out. */
  readonly status?: string;
};

export type WhatsAppReviewListFilters = WhatsAppPageQuery & {
  /** Defaults to `pending` on the server. */
  readonly status?: WhatsAppReviewStatus;
};

export type SetWhatsAppTemplateStatusInput = {
  readonly templateName: string;
  readonly languageCode: string;
  readonly metaStatus: WhatsAppTemplateMetaStatus;
  readonly metaTemplateId?: string;
};

/** The admin WhatsApp console (api_whatsapp_admin_*). Moderator and above, except the two
 *  configuration writers (send limits, template status), which are super admin. */
export interface IWhatsAppAdminRepository {
  getChannel(): Promise<WhatsAppChannelConfig>;
  setChannelEnabled(enabled: boolean): Promise<WhatsAppChannelConfig>;
  overview(): Promise<WhatsAppAdminOverview>;
  listConsent(query: WhatsAppPageQuery): Promise<WhatsAppPage<WhatsAppConsentRow>>;
  listOutbound(filters: WhatsAppOutboundListFilters): Promise<WhatsAppPage<WhatsAppOutboundRow>>;
  listRateHits(limit?: number): Promise<WhatsAppRateHit[]>;
  listRecentMatches(limit?: number): Promise<WhatsAppMatchSentRow[]>;
  listConversations(limit?: number): Promise<WhatsAppConversationRow[]>;
  resend(outboundId: string): Promise<string>;
  blockUser(userId: string): Promise<void>;
  listReviews(filters: WhatsAppReviewListFilters): Promise<WhatsAppPage<WhatsAppReviewItem>>;
  resolveReview(reviewId: string, decision: WhatsAppReviewDecision): Promise<WhatsAppReviewDecision>;
  listTemplates(): Promise<WhatsAppTemplateRow[]>;
  setSendLimits(patch: WhatsAppSendLimitsPatch): Promise<WhatsAppSendLimits>;
  setTemplateStatus(input: SetWhatsAppTemplateStatusInput): Promise<void>;
}
