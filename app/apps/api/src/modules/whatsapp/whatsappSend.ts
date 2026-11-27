// Drains the outbound WhatsApp queue through Meta's Cloud API (issue #938). Nothing is
// sent while the channel is disabled or no Graph token is configured.
//
// Ported from `supabase/functions/whatsapp-sender/handler.ts`.

import type { JobReport } from '../../platform/jobs/scheduledJob';
import { type FetchFn, type MetaConfig, sendMessage } from './metaClient';
import { type RpcFn, runSenderBatch } from './outboundBatch';

export interface ChannelConfig {
  readonly is_enabled: boolean;
  readonly phone_number_id: string | null;
  readonly graph_api_version: string | null;
}

/**
 * Reads the channel settings through `api_whatsapp_channel_config` (the table is in the
 * `integrations` schema, which no port reaches). A failed read counts as disabled.
 */
export async function loadChannelConfig(rpc: RpcFn): Promise<ChannelConfig | null> {
  const { data, error } = await rpc('api_whatsapp_channel_config', {});
  if (error || !data || typeof data !== 'object') return null;
  const row = data as Partial<ChannelConfig>;
  return { is_enabled: row.is_enabled === true, phone_number_id: row.phone_number_id ?? null, graph_api_version: row.graph_api_version ?? null };
}

export interface SendDeps {
  readonly rpc: RpcFn;
  /** The Graph API token. A secret; null: nothing is sent. */
  readonly token: string | null;
  /** Overrides the channel's own phone number id when set. */
  readonly phoneNumberId: string | null;
  /** Overrides the channel's own Graph API version when set. */
  readonly graphVersion: string | null;
  readonly fetchFn?: FetchFn;
}

const DEFAULT_BATCH = 20;
const MAX_BATCH = 100;
const DEFAULT_GRAPH_VERSION = 'v21.0';

/**
 * Sends one batch.
 * @param batch How many messages to claim (20 by default, 1 to 100).
 * @returns `{ claimed, sent, retried, failed }`, or `{ skipped }` when the channel is off or not configured.
 */
export async function sendQueuedWhatsApp(batch: unknown, deps: SendDeps): Promise<JobReport> {
  const channel = await loadChannelConfig(deps.rpc);
  if (!channel?.is_enabled) return { skipped: 'channel_disabled' };
  const phoneNumberId = deps.phoneNumberId || channel.phone_number_id || '';
  if (!deps.token || !phoneNumberId) return { skipped: 'not_configured' };

  const config: MetaConfig = { token: deps.token, phoneNumberId, graphVersion: deps.graphVersion || channel.graph_api_version || DEFAULT_GRAPH_VERSION };
  const summary = await runSenderBatch({
    rpc: deps.rpc,
    send: (message) => sendMessage(config, message, deps.fetchFn),
    batch: Math.min(Math.max(Number(batch) || DEFAULT_BATCH, 1), MAX_BATCH),
  });
  return { ...summary };
}
