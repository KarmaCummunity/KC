import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWhatsAppAdminUseCases } from '../whatsappAdminContainer';

describe('whatsappAdminContainer', () => {
  it('instantiates all WhatsApp admin use cases wired with the repository', () => {
    const mockSupabase = {} as unknown as SupabaseClient;
    const container = createWhatsAppAdminUseCases(mockSupabase);

    expect(container).toBeDefined();
    expect(container.getWhatsAppAdminOverview).toBeDefined();
    expect(container.getWhatsAppChannel).toBeDefined();
    expect(container.setWhatsAppChannelEnabled).toBeDefined();
    expect(container.listWhatsAppConsent).toBeDefined();
    expect(container.listWhatsAppOutbound).toBeDefined();
    expect(container.listWhatsAppRateHits).toBeDefined();
    expect(container.listWhatsAppRecentMatches).toBeDefined();
    expect(container.listWhatsAppConversations).toBeDefined();
    expect(container.resendWhatsAppOutbound).toBeDefined();
    expect(container.blockWhatsAppUser).toBeDefined();
  });
});
