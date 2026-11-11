// dispatch-notification — pure part: the text of a push and its per-platform message.
//
// Text is rendered here, in Hebrew, from strings.he.generated.json — a generated copy of the
// app's locale module, so the app and the push share one source. Server-side rendering is
// the only option that works on both platforms through the Expo push service: its message
// format has no localisation keys, and Android data-only localisation would need a
// background task. The platform fields come from the kind's row of the registry
// (kinds.generated.ts), never from a per-kind list kept in this file.
import { NOTIFICATION_KINDS } from './kinds.generated.ts';
import strings from './strings.he.generated.json' with { type: 'json' };
import type { AndroidMessage, IosMessage, ProviderMessage, Push, PushToken } from './types.ts';

export interface KindSpec {
  readonly category: 'critical' | 'social';
  readonly bypassPreferences: boolean;
  readonly bypassQuietHours: boolean;
  readonly sendsPush: boolean;
  readonly groupWindowSeconds: number | null;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly groupedBodyKey: string | null;
  readonly textArgs: readonly string[];
}

const KINDS: Readonly<Record<string, KindSpec>> = NOTIFICATION_KINDS;
const STRINGS: Readonly<Record<string, string>> = strings;
/** APNs limit of `apns-collapse-id`, in bytes; the keys are ASCII. */
const MAX_COLLAPSE_ID = 64;

/** A push that can never be sent as it is (unknown kind, missing text). Not retried. */
export class PayloadError extends Error {
  constructor(readonly code: 'unknown_kind' | 'missing_text', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'PayloadError';
  }
}

export function kindSpec(kind: string): KindSpec | undefined {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
}

/** Whether the text of this push needs the preview of `args.message_id`. */
export function previewMessageId(push: Push): string | null {
  const spec = kindSpec(push.data.kind);
  const id = push.args.message_id;
  return spec?.textArgs.includes('messagePreview') && typeof id === 'string' ? id : null;
}

function template(key: string): string {
  if (!Object.hasOwn(STRINGS, key)) throw new PayloadError('missing_text', key);
  return STRINGS[key];
}

/** An auxiliary text with its own placeholders; an unknown one is left as written. */
function fill(key: string, values: Readonly<Record<string, string>>): string {
  return template(key).replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name] : match));
}

function interpolate(key: string, args: Readonly<Record<string, string>>): string {
  return template(key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!Object.hasOwn(args, name)) throw new PayloadError('missing_text', `${key} {{${name}}}`);
    return args[name];
  });
}

/** Separator between the pieces of `details` and before the first one. */
export const DETAILS_SEPARATOR = ' · ';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/**
 * D26: `postTitle` and `details` from the arguments the database adds to a notification about a
 * post (migration 0027: post_title, when_label, seats, route_from, route_to). `details` is empty
 * or starts with the separator, so a text writes `({{postTitle}}{{details}})`. The app renders
 * the same pieces (apps/mobile/src/lib/notifications/notificationText.ts).
 */
export function richTextArgs(args: Readonly<Record<string, unknown>>): { postTitle: string; details: string } {
  const pieces: string[] = [];
  const when = text(args.when_label);
  if (when) pieces.push(when);
  const seats = Number(args.seats);
  if (Number.isInteger(seats) && seats > 1) pieces.push(fill('notifications.detailsSeats', { seats: String(seats) }));
  const from = text(args.route_from);
  const to = text(args.route_to);
  if (from && to) pieces.push(fill('notifications.detailsRoute', { from, to }));
  return {
    postTitle: text(args.post_title) ?? template('notifications.postTitleFallback'),
    details: pieces.map((piece) => DETAILS_SEPARATOR + piece).join(''),
  };
}

/** Title and body of a push. A grouped notification uses the kind's grouped body. */
export function renderText(push: Push, preview: string | null | undefined): { title: string; body: string } {
  const spec = kindSpec(push.data.kind);
  if (!spec) throw new PayloadError('unknown_kind', push.data.kind);
  const count = Math.max(1, Math.trunc(Number(push.data.group_count) || 1));
  const actor = push.args.actor_display_name;
  const args = {
    actorName: typeof actor === 'string' && actor.trim() !== '' ? actor : template('notifications.actorNameFallback'),
    count: String(count),
    othersCount: String(count - 1),
    messagePreview: preview ? preview : template('notifications.messagePreviewFallback'),
    ...richTextArgs(push.args),
  };
  const grouped = count > 1 && spec.groupedBodyKey !== null && push.body_key === spec.bodyKey;
  return {
    title: interpolate(push.title_key, args),
    body: interpolate(grouped ? spec.groupedBodyKey! : push.body_key, args),
  };
}

/** 53-bit string hash (cyrb53): stable across runs, enough to keep long keys apart. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The group key as a provider collapse id: unchanged when it fits, else hash + tail. */
export function collapseId(key: string): string {
  if (key.length <= MAX_COLLAPSE_ID) return key;
  const hash = hash53(key);
  return `${hash}:${key.slice(key.length - (MAX_COLLAPSE_ID - hash.length - 1))}`;
}

/** What the app gets on tap: ids only. Text and names stay out of `data`. */
function tapData(push: Push): Record<string, unknown> {
  const args: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(push.args)) {
    if (key === 'actor_display_name') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') args[key] = value;
  }
  return { ...push.data, args };
}

/**
 * The message of one device. Time-critical = the kind passes quiet hours (D95): only those
 * get `high` priority and, on iOS, the `time-sensitive` interruption level (which needs the
 * Time Sensitive Notifications entitlement; without it iOS shows the push as `active`).
 */
function messageFor(token: PushToken, push: Push, spec: KindSpec, text: { title: string; body: string }): ProviderMessage | null {
  const base = {
    to: token.token,
    title: text.title,
    body: text.body,
    data: tapData(push),
    priority: spec.bypassQuietHours ? 'high' as const : 'default' as const,
    ...(push.collapse_key ? { collapseId: collapseId(push.collapse_key) } : {}),
  };
  if (token.platform === 'android') {
    const android: AndroidMessage = {
      ...base,
      platform: 'android',
      channelId: spec.category,
      ...(push.collapse_key ? { tag: collapseId(push.collapse_key) } : {}),
    };
    return android;
  }
  if (token.platform === 'ios') {
    const entity = push.data.entity;
    const ios: IosMessage = {
      ...base,
      platform: 'ios',
      ...(spec.category === 'critical' ? { sound: 'default' as const } : {}),
      badge: Math.max(0, Math.trunc(Number(push.badge) || 0)),
      interruptionLevel: spec.bypassQuietHours ? 'time-sensitive' : 'active',
      threadId: entity ? `${entity.type}:${entity.id}` : spec.category,
      categoryId: spec.category,
    };
    return ios;
  }
  // `web`: the Expo push service has no web delivery; such a device is not pushed to.
  return null;
}

export interface BuiltMessage {
  readonly deviceId: string;
  readonly message: ProviderMessage;
}

/** One message per device of the push; devices of an unsupported platform are left out. */
export function buildMessages(push: Push, preview?: string | null): BuiltMessage[] {
  const spec = kindSpec(push.data.kind);
  if (!spec) throw new PayloadError('unknown_kind', push.data.kind);
  const text = renderText(push, preview);
  const built: BuiltMessage[] = [];
  for (const token of push.tokens) {
    const message = messageFor(token, push, spec, text);
    if (message) built.push({ deviceId: token.device_id, message });
  }
  return built;
}
