// The admin WhatsApp console (#939, M22 / L7): what the api_whatsapp_admin_* RPCs return.
// Phone numbers are always masked by the server. Long lists are keyset-paged: a page carries
// the opaque cursor that continues after its last row.

/** One page of a keyset-paged console list; `nextCursor` is null on the last page. */
export interface WhatsAppPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
}

export type WhatsAppChannelConfig = {
  isEnabled: boolean;
  phoneNumberId: string | null;
  graphApiVersion: string | null;
  updatedAt: Date | null;
  /** The staff member who last switched the channel. */
  updatedBy: string | null;
};

export type WhatsAppAdminOverview = {
  channelEnabled: boolean;
  since: Date;
  outboundQueued: number;
  outboundSent: number;
  outboundFailed: number;
  outboundSkipped: number;
  consentOptedIn: number;
  consentOptedOut: number;
  sessions7d: number;
  matchesSent7d: number;
  rateHits7d: number;
  /** Bot posts waiting in the review queue. */
  reviewPending: number;
};

export type WhatsAppConsentRow = {
  identityId: string;
  userId: string | null;
  waIdMasked: string | null;
  consentStatus: string;
  optedIn: boolean;
  optedInAt: Date | null;
  optedOutAt: Date | null;
  preferredLanguage: string | null;
  lastInboundAt: Date | null;
  updatedAt: Date;
};

export type WhatsAppOutboundRow = {
  outboundId: string;
  userId: string | null;
  waIdMasked: string | null;
  kind: string;
  templateName: string | null;
  language: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
};

export type WhatsAppRateHit = {
  bucket: string;
  windowStart: Date;
  expiresAt: Date | null;
  hits: number;
};

export type WhatsAppMatchSentRow = {
  outboundId: string;
  userId: string | null;
  waIdMasked: string | null;
  templateName: string | null;
  language: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  sentAt: Date | null;
};

export type WhatsAppConversationRow = {
  sessionId: string;
  waIdMasked: string | null;
  userId: string | null;
  state: string;
  postId: string | null;
  confidence: number | null;
  updatedAt: Date;
  createdAt: Date;
};

/** A bot post waiting for (or given) a staff decision. */
export type WhatsAppReviewItem = {
  reviewId: string;
  sessionId: string | null;
  postId: string | null;
  postTitle: string | null;
  postStatus: string | null;
  ownerId: string | null;
  reason: string;
  status: string;
  confidence: number | null;
  reviewerId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

/** A message template and its Meta approval state. */
export type WhatsAppTemplateRow = {
  templateName: string;
  languageCode: string;
  category: string;
  bodyPreview: string;
  params: readonly string[];
  registryVersion: number;
  isApproved: boolean;
  metaStatus: string;
  metaTemplateId: string | null;
  updatedAt: Date;
};
