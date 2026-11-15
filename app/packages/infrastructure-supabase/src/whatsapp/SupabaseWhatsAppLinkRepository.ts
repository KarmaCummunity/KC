// #1090 — the member's WhatsApp bot link and match-alert switch over the member RPCs of the
// migration `whatsapp_linking_and_bot_tools`: api_whatsapp_my_link_status,
// api_whatsapp_create_link_code (Pro only, `pro_required`), api_whatsapp_unlink_me and
// api_whatsapp_set_match_consent. Refusals map to `WhatsAppLinkError` by their stable message.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IWhatsAppLinkRepository } from '@kc/application';
import {
  WHATSAPP_LINK_ERROR_CODES,
  WhatsAppLinkError,
  type WhatsAppLinkCode,
  type WhatsAppLinkErrorCode,
  type WhatsAppLinkStatus,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import { asRecord } from '../admin/backOfficePaging';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

const KNOWN: ReadonlySet<string> = new Set(WHATSAPP_LINK_ERROR_CODES);

export function toWhatsAppLinkError(err: BackendErrorLike): WhatsAppLinkError {
  const message = (err.message ?? '').trim();
  if (KNOWN.has(message)) return new WhatsAppLinkError(message as WhatsAppLinkErrorCode);
  return new WhatsAppLinkError('unknown', message || 'whatsapp link call failed');
}

function unwrap<T>(rpc: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(`rpc:${rpc}`, result.error) ?? toWhatsAppLinkError(result.error);
}

export function mapLinkStatus(data: Json): WhatsAppLinkStatus {
  const r = asRecord(data) ?? {};
  const linked = r.linked === true;
  return {
    linked,
    waIdMasked: linked && typeof r.wa_id_masked === 'string' ? r.wa_id_masked : null,
    isPro: r.is_pro === true,
    consentOptedIn: r.consent_opted_in === true,
    phoneOptedOut: r.phone_opted_out === true,
  };
}

export function mapLinkCode(data: Json): WhatsAppLinkCode {
  const r = asRecord(data) ?? {};
  const code = typeof r.code === 'string' ? r.code : '';
  const expires = typeof r.expires_at === 'string' ? new Date(r.expires_at) : null;
  if (!/^\d{6}$/.test(code) || !expires || Number.isNaN(expires.getTime())) {
    throw new WhatsAppLinkError('unknown', 'api_whatsapp_create_link_code returned no code');
  }
  return { code, expiresAt: expires };
}

export class SupabaseWhatsAppLinkRepository implements IWhatsAppLinkRepository {
  constructor(private readonly client: Client) {}

  async getMyStatus(): Promise<WhatsAppLinkStatus> {
    return mapLinkStatus(unwrap('api_whatsapp_my_link_status', await this.client.rpc('api_whatsapp_my_link_status')));
  }

  async createLinkCode(): Promise<WhatsAppLinkCode> {
    return mapLinkCode(unwrap('api_whatsapp_create_link_code', await this.client.rpc('api_whatsapp_create_link_code')));
  }

  async unlink(): Promise<void> {
    unwrap('api_whatsapp_unlink_me', await this.client.rpc('api_whatsapp_unlink_me'));
  }

  async setMatchConsent(optedIn: boolean): Promise<WhatsAppLinkStatus> {
    const data = unwrap('api_whatsapp_set_match_consent',
      await this.client.rpc('api_whatsapp_set_match_consent', { p_opted_in: optedIn }));
    return mapLinkStatus(data);
  }
}
