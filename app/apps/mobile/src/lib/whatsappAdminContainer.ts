// Composition of the WhatsApp bot use cases (M22 / L7): the admin console (#939) and the
// member's own link and match-alert switch (#1090), kept out of container.ts for its 300-line cap.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  SupabaseWhatsAppAdminRepository,
  SupabaseWhatsAppLinkRepository,
} from '@kc/infrastructure-supabase';
import {
  BlockWhatsAppUserUseCase,
  CreateWhatsAppLinkCodeUseCase,
  GetWhatsAppAdminOverviewUseCase,
  GetWhatsAppChannelUseCase,
  GetWhatsAppLinkStatusUseCase,
  ListWhatsAppConsentUseCase,
  ListWhatsAppConversationsUseCase,
  ListWhatsAppOutboundUseCase,
  ListWhatsAppRateHitsUseCase,
  ListWhatsAppRecentMatchesUseCase,
  ListWhatsAppReviewsUseCase,
  ListWhatsAppTemplatesUseCase,
  ResendWhatsAppOutboundUseCase,
  ResolveWhatsAppReviewUseCase,
  SetWhatsAppChannelEnabledUseCase,
  SetWhatsAppMatchConsentUseCase,
  GetWhatsAppSendLimitsUseCase,
  SetWhatsAppSendLimitsUseCase,
  SetWhatsAppTemplateStatusUseCase,
  UnlinkWhatsAppUseCase,
} from '@kc/application';

/** The WhatsApp console's use cases (api_whatsapp_admin_*). */
export function createWhatsAppAdminUseCases(supabase: SupabaseClient<Database>) {
  const repo = new SupabaseWhatsAppAdminRepository(supabase);
  return {
    getWhatsAppAdminOverview: new GetWhatsAppAdminOverviewUseCase(repo),
    getWhatsAppChannel: new GetWhatsAppChannelUseCase(repo),
    setWhatsAppChannelEnabled: new SetWhatsAppChannelEnabledUseCase(repo),
    listWhatsAppConsent: new ListWhatsAppConsentUseCase(repo),
    listWhatsAppOutbound: new ListWhatsAppOutboundUseCase(repo),
    listWhatsAppRateHits: new ListWhatsAppRateHitsUseCase(repo),
    listWhatsAppRecentMatches: new ListWhatsAppRecentMatchesUseCase(repo),
    listWhatsAppConversations: new ListWhatsAppConversationsUseCase(repo),
    resendWhatsAppOutbound: new ResendWhatsAppOutboundUseCase(repo),
    blockWhatsAppUser: new BlockWhatsAppUserUseCase(repo),
    listWhatsAppReviews: new ListWhatsAppReviewsUseCase(repo),
    resolveWhatsAppReview: new ResolveWhatsAppReviewUseCase(repo),
    listWhatsAppTemplates: new ListWhatsAppTemplatesUseCase(repo),
    getWhatsAppSendLimits: new GetWhatsAppSendLimitsUseCase(repo),
    setWhatsAppSendLimits: new SetWhatsAppSendLimitsUseCase(repo),
    setWhatsAppTemplateStatus: new SetWhatsAppTemplateStatusUseCase(repo),
  };
}

/** The member's WhatsApp link use cases (Settings → WhatsApp). */
export function createWhatsAppLinkUseCases(supabase: SupabaseClient<Database>) {
  const repo = new SupabaseWhatsAppLinkRepository(supabase);
  return {
    getWhatsAppLinkStatus: new GetWhatsAppLinkStatusUseCase(repo),
    createWhatsAppLinkCode: new CreateWhatsAppLinkCodeUseCase(repo),
    unlinkWhatsApp: new UnlinkWhatsAppUseCase(repo),
    setWhatsAppMatchConsent: new SetWhatsAppMatchConsentUseCase(repo),
  };
}
