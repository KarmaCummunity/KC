// The WhatsApp console (M22) has no backend in the production baseline: every adapter method
// must reject with BackendUnavailableError naming the old RPC, so the screen degrades.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseWhatsAppAdminRepository } from '../SupabaseWhatsAppAdminRepository';

async function expectUnavailable(call: Promise<unknown>, object: string): Promise<void> {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BackendUnavailableError);
  expect(error).toMatchObject({ object, kind: 'function' });
}

describe('SupabaseWhatsAppAdminRepository', () => {
  it('the WhatsApp console (M22) reports every call as unavailable', async () => {
    const repo = new SupabaseWhatsAppAdminRepository();
    await expectUnavailable(repo.getChannel(), 'rpc:api_whatsapp_admin_get_channel');
    await expectUnavailable(repo.setChannelEnabled(true), 'rpc:api_whatsapp_admin_set_channel_enabled');
    await expectUnavailable(repo.overview(), 'rpc:api_whatsapp_admin_overview');
    await expectUnavailable(repo.listConsent(), 'rpc:api_whatsapp_admin_list_consent');
    await expectUnavailable(repo.listOutbound({}), 'rpc:api_whatsapp_admin_list_outbound');
    await expectUnavailable(repo.listRateHits(), 'rpc:api_whatsapp_admin_list_rate_hits');
    await expectUnavailable(repo.listRecentMatches(), 'rpc:api_whatsapp_admin_list_recent_matches');
    await expectUnavailable(repo.listConversations(), 'rpc:api_whatsapp_admin_list_conversations');
    await expectUnavailable(repo.resend('o1'), 'rpc:api_whatsapp_admin_resend');
    await expectUnavailable(repo.blockUser('u1'), 'rpc:api_whatsapp_admin_block_user');
  });
});
