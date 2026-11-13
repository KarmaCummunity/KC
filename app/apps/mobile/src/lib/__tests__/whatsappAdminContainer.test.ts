import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@kc/infrastructure-supabase';
import { createWhatsAppAdminUseCases, createWhatsAppLinkUseCases } from '../whatsappAdminContainer';

function fakeClient() {
  const rpc = vi.fn(async () => ({ data: { linked: false, is_pro: true }, error: null }));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe('whatsappAdminContainer', () => {
  it('instantiates all WhatsApp admin use cases wired with the repository', () => {
    const container = createWhatsAppAdminUseCases(fakeClient().client);
    for (const key of [
      'getWhatsAppAdminOverview', 'getWhatsAppChannel', 'setWhatsAppChannelEnabled', 'listWhatsAppConsent',
      'listWhatsAppOutbound', 'listWhatsAppRateHits', 'listWhatsAppRecentMatches', 'listWhatsAppConversations',
      'resendWhatsAppOutbound', 'blockWhatsAppUser', 'listWhatsAppReviews', 'resolveWhatsAppReview',
      'listWhatsAppTemplates', 'setWhatsAppSendLimits', 'setWhatsAppTemplateStatus',
    ] as const) {
      expect(container[key]).toBeDefined();
    }
  });

  it('wires the member link use cases to the client, not to direct calls in the screen', async () => {
    const { client, rpc } = fakeClient();
    const link = createWhatsAppLinkUseCases(client);
    expect(await link.getWhatsAppLinkStatus.execute()).toMatchObject({ linked: false, isPro: true });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_my_link_status');
    expect(link.createWhatsAppLinkCode).toBeDefined();
    expect(link.unlinkWhatsApp).toBeDefined();
    expect(link.setWhatsAppMatchConsent).toBeDefined();
  });
});
