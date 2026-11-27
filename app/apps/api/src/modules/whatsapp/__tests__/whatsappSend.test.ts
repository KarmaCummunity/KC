import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../metaClient';
import type { RpcFn } from '../outboundBatch';
import { type ChannelConfig, loadChannelConfig, type SendDeps, sendQueuedWhatsApp } from '../whatsappSend';

const ENABLED: ChannelConfig = { is_enabled: true, phone_number_id: null, graph_api_version: 'v21.0' };

/** Dependencies with one queued template message; `channel` is what the settings function answers. */
function setup(over: Partial<SendDeps> = {}, channel: ChannelConfig | null = ENABLED) {
  const fetchCalls: string[] = [];
  const claims: unknown[] = [];
  const rpc: RpcFn = (name, args) => {
    if (name === 'api_whatsapp_channel_config') return Promise.resolve({ data: channel, error: null });
    if (name === 'api_whatsapp_outbound_claim') {
      claims.push(args.p_batch);
      const row = { outbound_id: 'o1', kind: 'template', to_wa_id: '972500000001', language: 'he', template_name: 'match_found_v1', body: null, payload: { world_label_he: 'items-he' } };
      return Promise.resolve({ data: [row], error: null });
    }
    return Promise.resolve({ data: args.p_ok ? 'sent' : 'queued', error: null });
  };
  const fetchFn: FetchFn = (url) => {
    fetchCalls.push(url);
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }));
  };
  const deps: SendDeps = { rpc, token: 'fake-token', phoneNumberId: '555', graphVersion: null, fetchFn, ...over };
  return { run: (batch?: unknown) => sendQueuedWhatsApp(batch, deps), fetchCalls, claims };
}

describe('sendQueuedWhatsApp', () => {
  it('sends nothing while the channel is disabled (the default) or its settings cannot be read', async () => {
    const disabled = setup({}, { is_enabled: false, phone_number_id: null, graph_api_version: null });
    const unreadable = setup({}, null);

    expect(await disabled.run()).toEqual({ skipped: 'channel_disabled' });
    expect(await unreadable.run()).toEqual({ skipped: 'channel_disabled' });
    expect([...disabled.fetchCalls, ...unreadable.fetchCalls, ...disabled.claims]).toEqual([]);
  });

  it('sends nothing without a token or a phone number id', async () => {
    const noToken = setup({ token: null });
    const noNumber = setup({ phoneNumberId: null });

    expect(await noToken.run()).toEqual({ skipped: 'not_configured' });
    expect(await noNumber.run()).toEqual({ skipped: 'not_configured' });
    expect([...noToken.fetchCalls, ...noNumber.fetchCalls]).toEqual([]);
  });

  it('claims and sends through the Graph API when enabled and configured', async () => {
    const { run, fetchCalls } = setup();

    expect(await run()).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(fetchCalls).toEqual(['https://graph.facebook.com/v21.0/555/messages']);
  });

  it('uses the channel\'s own phone number id and API version when the server sets none', async () => {
    const { run, fetchCalls } = setup({ phoneNumberId: null }, { is_enabled: true, phone_number_id: 'pn-1', graph_api_version: 'v22.0' });

    await run();

    expect(fetchCalls).toEqual(['https://graph.facebook.com/v22.0/pn-1/messages']);
  });

  it('claims the requested number of messages, 20 by default, between 1 and 100', async () => {
    const { run, claims } = setup();

    for (const batch of [undefined, 5, 500, -3, 'many']) await run(batch);

    expect(claims).toEqual([20, 5, 100, 1, 20]);
  });
});

describe('loadChannelConfig', () => {
  it('reads the settings through api_whatsapp_channel_config, never the table', async () => {
    const seen: string[] = [];
    const settings = { is_enabled: true, phone_number_id: 'pn-1', graph_api_version: 'v21.0' };

    const loaded = await loadChannelConfig((name) => {
      seen.push(name);
      return Promise.resolve({ data: settings, error: null });
    });

    expect(loaded).toEqual(settings);
    expect(seen).toEqual(['api_whatsapp_channel_config']);
  });

  it('counts a failed read as no settings, and anything but `true` as disabled', async () => {
    const failing: RpcFn = () => Promise.resolve({ data: null, error: { message: 'boom' } });
    const partial: RpcFn = () => Promise.resolve({ data: { is_enabled: 'yes' }, error: null });

    expect(await loadChannelConfig(failing)).toBeNull();
    expect(await loadChannelConfig(partial)).toEqual({ is_enabled: false, phone_number_id: null, graph_api_version: null });
  });
});
