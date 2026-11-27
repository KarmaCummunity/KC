import { expect, it } from 'vitest';
import { toExpoMessage } from '../expoTransport';
import { buildMessages, collapseId, kindSpec, PayloadError, previewMessageId, renderText } from '../pushMessages';
import type { AndroidMessage, IosMessage } from '../pushTypes';
import strings from '../strings.he.generated.json';
import { device, ENTITY_ID, KIND_ENTRIES, MESSAGE_ID, pushFor } from './pushTestKit';

// Every kind of the registry (kinds.generated.ts) must yield a valid Android message and a
// valid iOS message. The table is the generated list, so a kind added in SQL is tested —
// and fails here if a piece is missing — without touching this file.

const STRINGS: Record<string, string> = strings;
const PREVIEW = 'see you at five';
/** Fields of the Expo message format this worker deliberately does not use. */
const UNUSED_FIELDS = ['mutableContent', 'contentAvailable', '_contentAvailable', 'ttl', 'expiration', 'subtitle', 'richContent'];

function split(kind: string, groupCount: number, preview: string | null = PREVIEW) {
  const push = pushFor(kind, { groupCount, tokens: [device(1, 'android'), device(2, 'ios'), device(3, 'web')] });
  const built = buildMessages(push, preview);
  expect(built.map((b) => b.deviceId), 'one message per supported device; web is skipped').toEqual(['device-1', 'device-2']);
  return { push, android: built[0]!.message as AndroidMessage, ios: built[1]!.message as IosMessage };
}

it('the registry is not empty and every kind names texts that exist', () => {
  expect(KIND_ENTRIES.length >= 57).toBe(true);
  for (const [kind, spec] of KIND_ENTRIES) {
    for (const key of [spec.titleKey, spec.bodyKey, spec.groupedBodyKey]) {
      if (key !== null) expect(STRINGS[key], `${kind}: ${key} has no text`).toBeTruthy();
    }
    expect(spec.groupedBodyKey !== null, `${kind}: grouped body iff the kind groups`).toEqual(spec.groupWindowSeconds !== null);
  }
});

for (const [kind, spec] of KIND_ENTRIES) {
  const timeCritical = spec.bypassQuietHours;
  const needsPreview = spec.textArgs.includes('messagePreview');

  it(`${kind}: text renders with every argument resolved`, () => {
    for (const groupCount of spec.groupWindowSeconds === null ? [1] : [1, 4]) {
      const { title, body } = renderText(pushFor(kind, { groupCount }), PREVIEW);
      for (const text of [title, body]) {
        expect(text.trim().length > 0, 'not empty').toBe(true);
        expect(text.includes('{{'), `unresolved argument in "${text}"`).toBe(false);
        expect(text.includes('undefined') || text.includes('null')).toBe(false);
      }
      expect(`${title}${body}`.includes(PREVIEW), 'message text appears only where the kind asks for the preview').toEqual(needsPreview);
      if (groupCount > 1 && spec.textArgs.some((a) => a === 'count' || a === 'othersCount')) {
        expect(/[34]/.test(body), 'a grouped body shows the count').toBe(true);
      }
    }
    // A missing actor name and a missing preview fall back to locale text, not to a hole.
    const anonymous = renderText(pushFor(kind, { args: { message_id: MESSAGE_ID } }), null);
    expect(`${anonymous.title}${anonymous.body}`.includes('{{')).toBe(false);
    expect(anonymous.title.trim().length > 0 && anonymous.body.trim().length > 0).toBe(true);
  });

  it(`${kind}: Android message`, () => {
    for (const groupCount of spec.groupWindowSeconds === null ? [1] : [1, 4]) {
      const { push, android } = split(kind, groupCount);
      expect(android.platform).toEqual('android');
      expect(android.to).toEqual('ExponentPushToken[secret-1]');
      expect(android.channelId, 'channel = the category of the kind').toEqual(spec.category);
      expect(android.priority, 'high priority only for time-critical kinds').toEqual(timeCritical ? 'high' : 'default');
      if (push.collapse_key) {
        expect(android.tag, 'a grouping kind replaces the shown notification').toEqual(android.collapseId);
        expect(android.tag!.length <= 64).toBe(true);
      } else {
        expect('tag' in android || 'collapseId' in android, 'a kind that never groups stands alone').toBe(false);
      }
      const wire = toExpoMessage(android);
      for (const field of ['badge', 'interruptionLevel', 'threadId', 'categoryId', 'sound', 'platform', ...UNUSED_FIELDS]) {
        expect(field in wire, `${field} is not an Android field`).toBe(false);
      }
    }
  });

  it(`${kind}: iOS message`, () => {
    const { push, ios } = split(kind, 1);
    expect(ios.platform).toEqual('ios');
    expect(ios.to).toEqual('ExponentPushToken[secret-2]');
    expect(ios.badge, 'badge = the unread count from the database').toEqual(7);
    expect(ios.interruptionLevel).toEqual(timeCritical ? 'time-sensitive' : 'active');
    expect(ios.priority).toEqual(timeCritical ? 'high' : 'default');
    expect(ios.threadId, 'thread = the entity, so its notifications group').toEqual(`chat:${ENTITY_ID}`);
    expect(ios.categoryId).toEqual(spec.category);
    expect(ios.sound).toEqual(spec.category === 'critical' ? 'default' : undefined);
    expect(ios.collapseId).toEqual(push.collapse_key ?? undefined);
    const wire = toExpoMessage(ios);
    for (const field of ['channelId', 'tag', 'platform', ...UNUSED_FIELDS]) expect(field in wire, `${field} is not an iOS field`).toBe(false);
  });

  it(`${kind}: tap data carries ids only`, () => {
    const { android, ios } = split(kind, 1);
    expect(android.data).toEqual(ios.data);
    const data = android.data as Record<string, unknown>;
    expect(data.kind).toEqual(kind);
    expect(data.category).toEqual(spec.category);
    expect(data.notification_id).toEqual(`n-${kind}`);
    expect(data.entity).toEqual({ type: 'chat', id: ENTITY_ID });
    expect((data.args as Record<string, unknown>).post_id).toEqual(ENTITY_ID);
    const json = JSON.stringify(data);
    expect(json.includes('Dana') || json.includes(PREVIEW), 'no name and no message text in data').toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(toExpoMessage(ios))).length < 4096, 'under the provider payload limit').toBe(true);
  });
}

it('the preview is asked for exactly by the kinds whose text uses it', () => {
  for (const [kind, spec] of KIND_ENTRIES) {
    expect(previewMessageId(pushFor(kind)), kind).toEqual(spec.textArgs.includes('messagePreview') ? MESSAGE_ID : null);
  }
  expect(previewMessageId(pushFor('chat_message', { args: {} })), 'no message id, no preview').toEqual(null);
});

it('a chat push shows the preview, and a count once it groups', () => {
  expect(renderText(pushFor('chat_message'), PREVIEW)).toEqual({ title: 'Dana Levi', body: PREVIEW });
  const grouped = renderText(pushFor('chat_message', { groupCount: 3 }), PREVIEW);
  expect(grouped.body.startsWith('3 ') && grouped.body.endsWith(PREVIEW)).toBe(true);
  expect(renderText(pushFor('chat_message'), null).body).toEqual(STRINGS['notifications.messagePreviewFallback']);
});

it('an admin task push shows the task title, or a fallback without one', () => {
  const titled = pushFor('task_assigned', { args: { task_id: ENTITY_ID, task_title: 'Review reports' } });
  expect(renderText(titled, null).body).toEqual('Review reports');
  expect(renderText(pushFor('task_assigned', { args: {} }), null).body).toEqual(STRINGS['notifications.taskTitleFallback']);
});

it('a push that cannot be rendered is a PayloadError, never a half-built message', () => {
  expect(() => buildMessages(pushFor('no_such_kind'))).toThrow(PayloadError);
  expect(() => buildMessages(pushFor('no_such_kind'))).toThrow('unknown_kind');
  expect(() => buildMessages(pushFor('chat_message', { title_key: 'notifications.gone' }))).toThrow(PayloadError);
  expect(() => buildMessages(pushFor('chat_message', { title_key: 'notifications.gone' }))).toThrow('missing_text');
  expect(kindSpec('toString'), 'an inherited property is not a kind').toEqual(undefined);
});

it('a device without an entity threads by category; a bad badge becomes zero', () => {
  const push = pushFor('account_suspended', { badge: -3, data: { ...pushFor('account_suspended').data, entity: null } });
  const ios = buildMessages(push)[1]!.message as IosMessage;
  expect([ios.threadId, ios.badge]).toEqual(['critical', 0]);
});

it('collapse ids fit the provider limit and stay distinct', () => {
  const short = `chat_message:chat:${ENTITY_ID}`;
  expect(collapseId(short)).toEqual(short);
  const long = (kind: string) => collapseId(`${kind}:post_handoff:${ENTITY_ID}`);
  const a = long('event_registration_waitlist_promoted');
  const b = long('housing_booking_waitlist_promoted_x');
  expect(a.length <= 64 && b.length <= 64).toBe(true);
  expect(a !== b && a.endsWith(ENTITY_ID)).toBe(true);
  expect(a, 'stable between runs').toEqual(long('event_registration_waitlist_promoted'));
});
