import { SupabaseWhatsAppAdminRepository } from '@kc/infrastructure-supabase';
import {
  BlockWhatsAppUserUseCase,
  GetWhatsAppAdminOverviewUseCase,
  GetWhatsAppChannelUseCase,
  ListWhatsAppConsentUseCase,
  ListWhatsAppConversationsUseCase,
  ListWhatsAppOutboundUseCase,
  ListWhatsAppRateHitsUseCase,
  ListWhatsAppRecentMatchesUseCase,
  ResendWhatsAppOutboundUseCase,
  SetWhatsAppChannelEnabledUseCase,
} from '@kc/application';

/** The WhatsApp console's use cases; the adapter is parked until the integrations module (M22). */
export function createWhatsAppAdminUseCases() {
  const repo = new SupabaseWhatsAppAdminRepository();
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
  };
}
