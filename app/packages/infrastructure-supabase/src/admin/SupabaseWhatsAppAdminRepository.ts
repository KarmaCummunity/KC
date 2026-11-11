// #1090 — WhatsApp bot admin console.
//
// The WhatsApp bot waits for the `integrations` module, which the production baseline reserves
// but leaves empty (docs/db/app-migration-map.md, M22; design Q4). The adapter therefore makes
// no call: every method reports the capability as missing with `BackendUnavailableError`, and
// the admin portal hides the WhatsApp section (apps/mobile/src/lib/parkedFeatures.ts). The
// previous RPC adapter is in git history.
import type { IWhatsAppAdminRepository, WhatsAppOutboundListFilters } from '@kc/application';
import {
  BackendUnavailableError,
  type WhatsAppAdminOverview,
  type WhatsAppChannelConfig,
  type WhatsAppConsentRow,
  type WhatsAppConversationRow,
  type WhatsAppMatchSentRow,
  type WhatsAppOutboundRow,
  type WhatsAppRateHit,
} from '@kc/domain';

const unavailable = (rpc: string): Promise<never> =>
  Promise.reject(new BackendUnavailableError(`rpc:${rpc}`, 'function'));

type CountedRows<T> = { rows: T[]; totalCount: number };

export class SupabaseWhatsAppAdminRepository implements IWhatsAppAdminRepository {
  getChannel(): Promise<WhatsAppChannelConfig> {
    return unavailable('api_whatsapp_admin_get_channel');
  }

  setChannelEnabled(_enabled: boolean): Promise<WhatsAppChannelConfig> {
    return unavailable('api_whatsapp_admin_set_channel_enabled');
  }

  overview(): Promise<WhatsAppAdminOverview> {
    return unavailable('api_whatsapp_admin_overview');
  }

  listConsent(_limit?: number, _offset?: number): Promise<CountedRows<WhatsAppConsentRow>> {
    return unavailable('api_whatsapp_admin_list_consent');
  }

  listOutbound(_filters: WhatsAppOutboundListFilters): Promise<CountedRows<WhatsAppOutboundRow>> {
    return unavailable('api_whatsapp_admin_list_outbound');
  }

  listRateHits(_limit?: number): Promise<WhatsAppRateHit[]> {
    return unavailable('api_whatsapp_admin_list_rate_hits');
  }

  listRecentMatches(_limit?: number): Promise<WhatsAppMatchSentRow[]> {
    return unavailable('api_whatsapp_admin_list_recent_matches');
  }

  listConversations(_limit?: number): Promise<WhatsAppConversationRow[]> {
    return unavailable('api_whatsapp_admin_list_conversations');
  }

  resend(_outboundId: string): Promise<string> {
    return unavailable('api_whatsapp_admin_resend');
  }

  blockUser(_userId: string): Promise<void> {
    return unavailable('api_whatsapp_admin_block_user');
  }
}
