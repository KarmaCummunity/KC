import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { coalesceChat, coalesceFollowStarted } from './coalesce.ts';
import { sendExpoPush, type ExpoMessage, type ExpoTicket } from './expoPushClient.ts';
import i18n from './i18n.json' with { type: 'json' };
import { type Handler, reportError, withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest } from '../_shared/serviceRoleGuard.ts';

interface OutboxRow {
  notification_id: string;
  user_id: string;
  category: 'critical' | 'social';
  kind: string;
  title_key: string;
  body_key: string;
  body_args: Record<string, string | number>;
  data: Record<string, unknown>;
  dedupe_key: string | null;
  bypass_preferences: boolean;
  created_at: string;
  dispatched_at: string | null;
  attempts: number;
  last_error: string | null;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'RETRY';
  table: string;
  record: OutboxRow;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function resolveString(key: string, args: Record<string, string | number>): string {
  const template = (i18n as Record<string, string>)[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(args[k] ?? ''));
}

function markDispatched(notificationId: string, error: string | null) {
  return supabase
    .from('notifications_outbox')
    .update({ dispatched_at: new Date().toISOString(), last_error: error })
    .eq('notification_id', notificationId);
}

function bumpAttempt(notificationId: string, error: string) {
  return supabase.rpc('notifications_bump_attempt', { p_id: notificationId, p_error: error });
}

const handler: Handler = async (req) => {
  // Auth: dashboard webhook passes the service-role bearer.
  if (!isServiceRoleRequest(req, SERVICE_ROLE_KEY)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  const row = payload.record;
  if (!row) return new Response('No record', { status: 400 });

  try {
    // Load recipient state.
    const { data: state, error: stateErr } = await supabase
      .from('users')
      .select('user_id, account_status, notification_preferences, devices(push_token, platform)')
      .eq('user_id', row.user_id)
      .maybeSingle();
    if (stateErr) throw stateErr;
    if (!state) {
      await markDispatched(row.notification_id, 'recipient_not_found');
      return new Response('OK', { status: 200 });
    }

    // FR-NOTIF-011 AC2: suspended users do not receive notifications.
    if (state.account_status && state.account_status !== 'active') {
      await markDispatched(row.notification_id, 'recipient_suspended');
      return new Response('OK', { status: 200 });
    }

    // Preference gate.
    const prefs = (state.notification_preferences as { critical?: boolean; social?: boolean } | null)
      ?? { critical: true, social: true };
    const allowed = row.bypass_preferences || prefs[row.category] === true;
    if (!allowed) {
      await markDispatched(row.notification_id, 'suppressed_by_preference');
      return new Response('OK', { status: 200 });
    }

    const tokens = ((state.devices ?? []) as { push_token: string }[])
      .map((d) => d.push_token).filter(Boolean);
    if (tokens.length === 0) {
      await markDispatched(row.notification_id, 'no_devices');
      return new Response('OK', { status: 200 });
    }

    // Coalescing.
    let titleKey = row.title_key;
    let bodyKey = row.body_key;
    let bodyArgs = row.body_args;

    if (row.kind === 'chat_message') {
      const chatId = (row.data as Record<string, string>).chat_id;
      const { count } = await supabase
        .from('notifications_outbox')
        .select('notification_id', { count: 'exact', head: true })
        .eq('user_id', row.user_id)
        .eq('kind', 'chat_message')
        .neq('notification_id', row.notification_id)
        .filter('data->>chat_id', 'eq', chatId)
        .gte('dispatched_at', new Date(Date.now() - 60_000).toISOString());
      const result = coalesceChat({
        priorCount: count ?? 0,
        senderName: String(bodyArgs.senderName ?? ''),
        messagePreview: String(bodyArgs.messagePreview ?? ''),
      });
      titleKey = result.titleKey;
      bodyKey = result.bodyKey;
      bodyArgs = { ...result.bodyArgs };
    } else if (row.kind === 'follow_started') {
      const { count } = await supabase
        .from('notifications_outbox')
        .select('notification_id', { count: 'exact', head: true })
        .eq('user_id', row.user_id)
        .eq('kind', 'follow_started')
        .neq('notification_id', row.notification_id)
        .gte('dispatched_at', new Date(Date.now() - 60 * 60_000).toISOString());
      const result = coalesceFollowStarted({
        priorCount: count ?? 0,
        followerName: String(bodyArgs.followerName ?? ''),
      });
      titleKey = result.titleKey;
      bodyKey = result.bodyKey;
      bodyArgs = { ...result.bodyArgs };
    }

    const title = resolveString(titleKey, bodyArgs);
    const body = resolveString(bodyKey, bodyArgs);

    const message: ExpoMessage = {
      to: tokens,
      title,
      body,
      data: { ...row.data, category: row.category, kind: row.kind, notification_id: row.notification_id },
      channelId: row.category,
      threadId: typeof (row.data as Record<string, string>).chat_id === 'string'
        ? `chat:${(row.data as Record<string, string>).chat_id}`
        : undefined,
      priority: row.category === 'critical' ? 'high' : 'normal',
      sound: row.category === 'critical' ? 'default' : null,
      badge: 1,
    };

    let tickets: ExpoTicket[] = [];
    try {
      tickets = await sendExpoPush([message], EXPO_ACCESS_TOKEN);
    } catch (err) {
      await reportError(err, {
        fn: 'dispatch-notification',
        req,
        tags: { stage: 'expo_push' },
        extra: { notification_id: row.notification_id },
      });
      await bumpAttempt(row.notification_id, String(err));
      return new Response('Retry later', { status: 200 });
    }

    // Handle per-token results (Expo returns one ticket per `to` entry).
    let allOk = true;
    let firstError: string | null = null;
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const token = tokens[i];
      if (!ticket || !token) continue;
      if (ticket.status === 'error') {
        allOk = false;
        firstError = ticket.details?.error ?? ticket.message ?? 'unknown_error';
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await supabase.from('devices').delete().eq('push_token', token);
        }
      }
    }

    if (allOk) {
      await markDispatched(row.notification_id, null);
    } else {
      await markDispatched(row.notification_id, firstError);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    await reportError(err, { fn: 'dispatch-notification', req, extra: { notification_id: row.notification_id } });
    await bumpAttempt(row.notification_id, String(err));
    return new Response('Internal Error', { status: 500 });
  }
};

Deno.serve(withObservability('dispatch-notification', handler));
