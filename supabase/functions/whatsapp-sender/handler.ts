// whatsapp-sender — Issue #938. Drains integrations.whatsapp_outbound_messages through Meta Cloud API.
// The `whatsapp_send` scheduled job invokes it every minute with the service role.
// No-ops while the channel is disabled or no Graph token is configured.

import { type FetchFn, type MetaConfig, sendMessage } from '../_shared/whatsapp/meta.ts';
import { type RpcFn, runSenderBatch } from '../_shared/whatsapp/sender.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

export type ChannelConfig = { is_enabled: boolean; phone_number_id: string | null; graph_api_version: string | null };

/**
 * Reads the channel settings through `api_whatsapp_channel_config` (the table lives in the
 * `integrations` schema, which the API does not expose). A failed read counts as disabled.
 */
export async function loadChannelConfigViaRpc(rpc: RpcFn): Promise<ChannelConfig | null> {
  const { data, error } = await rpc('api_whatsapp_channel_config', {});
  if (error || !data || typeof data !== 'object') return null;
  const row = data as Partial<ChannelConfig>;
  return {
    is_enabled: row.is_enabled === true,
    phone_number_id: row.phone_number_id ?? null,
    graph_api_version: row.graph_api_version ?? null,
  };
}

export type SenderDeps = {
  /** The only accepted bearer token (`SUPABASE_SERVICE_ROLE_KEY`). */
  serviceKey: string;
  rpc: RpcFn;
  /** Returns the channel settings (or null); see loadChannelConfigViaRpc. */
  loadChannelConfig: () => Promise<ChannelConfig | null>;
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  fetchFn?: FetchFn;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createSenderHandler(deps: SenderDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (!isServiceRoleRequest(req, deps.serviceKey)) return serviceRoleRequiredResponse();
    const opts = (await req.json().catch(() => ({}))) as { batch?: number };

    const channel = await deps.loadChannelConfig();
    if (!channel?.is_enabled) return json({ ok: true, skipped: 'channel_disabled' });
    const phoneNumberId = deps.phoneNumberId || channel.phone_number_id || '';
    if (!deps.token || !phoneNumberId) return json({ ok: true, skipped: 'not_configured' });

    const cfg: MetaConfig = {
      token: deps.token,
      phoneNumberId,
      graphVersion: deps.graphVersion || channel.graph_api_version || 'v21.0',
    };
    try {
      const summary = await runSenderBatch({
        rpc: deps.rpc,
        send: (msg) => sendMessage(cfg, msg, deps.fetchFn),
        batch: Math.min(Math.max(Number(opts.batch) || 20, 1), 100),
      });
      return json({ ok: true, ...summary });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}
