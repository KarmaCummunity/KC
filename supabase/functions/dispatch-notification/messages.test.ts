// Every kind of the registry (kinds.generated.ts) must yield a valid Android message and a
// valid iOS message. The table is the generated list, so a kind added in SQL is tested —
// and fails here if a piece is missing — without touching this file.
import { assert, assertEquals, assertFalse, assertThrows } from 'jsr:@std/assert@1';
import { toExpoMessage } from './expoTransport.ts';
import { buildMessages, collapseId, kindSpec, PayloadError, previewMessageId, renderText } from './messages.ts';
import strings from './strings.he.generated.json' with { type: 'json' };
import { device, ENTITY_ID, KIND_ENTRIES, MESSAGE_ID, pushFor } from './testKit.ts';
import type { AndroidMessage, IosMessage } from './types.ts';

const STRINGS: Record<string, string> = strings;
const PREVIEW = 'see you at five';
/** Fields of the Expo message format this worker deliberately does not use. */
const UNUSED_FIELDS = ['mutableContent', 'contentAvailable', '_contentAvailable', 'ttl', 'expiration', 'subtitle', 'richContent'];

function split(kind: string, groupCount: number, preview: string | null = PREVIEW) {
  const push = pushFor(kind, { groupCount, tokens: [device(1, 'android'), device(2, 'ios'), device(3, 'web')] });
  const built = buildMessages(push, preview);
  assertEquals(built.map((b) => b.deviceId), ['device-1', 'device-2'], 'one message per supported device; web is skipped');
  return { push, android: built[0].message as AndroidMessage, ios: built[1].message as IosMessage };
}

Deno.test('the registry is not empty and every kind names texts that exist', () => {
  assert(KIND_ENTRIES.length >= 57);
  for (const [kind, spec] of KIND_ENTRIES) {
    for (const key of [spec.titleKey, spec.bodyKey, spec.groupedBodyKey]) {
      if (key !== null) assert(STRINGS[key], `${kind}: ${key} has no text`);
    }
    assertEquals(spec.groupedBodyKey !== null, spec.groupWindowSeconds !== null, `${kind}: grouped body iff the kind groups`);
  }
});

for (const [kind, spec] of KIND_ENTRIES) {
  const timeCritical = spec.bypassQuietHours;
  const needsPreview = spec.textArgs.includes('messagePreview');

  Deno.test(`${kind}: text renders with every argument resolved`, () => {
    for (const groupCount of spec.groupWindowSeconds === null ? [1] : [1, 4]) {
      const { title, body } = renderText(pushFor(kind, { groupCount }), PREVIEW);
      for (const text of [title, body]) {
        assert(text.trim().length > 0, 'not empty');
        assertFalse(text.includes('{{'), `unresolved argument in "${text}"`);
        assertFalse(text.includes('undefined') || text.includes('null'));
      }
      assertEquals(`${title}${body}`.includes(PREVIEW), needsPreview, 'message text appears only where the kind asks for the preview');
      if (groupCount > 1 && spec.textArgs.some((a) => a === 'count' || a === 'othersCount')) {
        assert(/[34]/.test(body), 'a grouped body shows the count');
      }
    }
    // A missing actor name and a missing preview fall back to locale text, not to a hole.
    const anonymous = renderText(pushFor(kind, { args: { message_id: MESSAGE_ID } }), null);
    assertFalse(`${anonymous.title}${anonymous.body}`.includes('{{'));
    assert(anonymous.title.trim().length > 0 && anonymous.body.trim().length > 0);
  });

  Deno.test(`${kind}: Android message`, () => {
    for (const groupCount of spec.groupWindowSeconds === null ? [1] : [1, 4]) {
      const { push, android } = split(kind, groupCount);
      assertEquals(android.platform, 'android');
      assertEquals(android.to, 'ExponentPushToken[secret-1]');
      assertEquals(android.channelId, spec.category, 'channel = the category of the kind');
      assertEquals(android.priority, timeCritical ? 'high' : 'default', 'high priority only for time-critical kinds');
      if (push.collapse_key) {
        assertEquals(android.tag, android.collapseId, 'a grouping kind replaces the shown notification');
        assert(android.tag!.length <= 64);
      } else {
        assertFalse('tag' in android || 'collapseId' in android, 'a kind that never groups stands alone');
      }
      const wire = toExpoMessage(android);
      for (const field of ['badge', 'interruptionLevel', 'threadId', 'categoryId', 'sound', 'platform', ...UNUSED_FIELDS]) {
        assertFalse(field in wire, `${field} is not an Android field`);
      }
    }
  });

  Deno.test(`${kind}: iOS message`, () => {
    const { push, ios } = split(kind, 1);
    assertEquals(ios.platform, 'ios');
    assertEquals(ios.to, 'ExponentPushToken[secret-2]');
    assertEquals(ios.badge, 7, 'badge = the unread count from the database');
    assertEquals(ios.interruptionLevel, timeCritical ? 'time-sensitive' : 'active');
    assertEquals(ios.priority, timeCritical ? 'high' : 'default');
    assertEquals(ios.threadId, `chat:${ENTITY_ID}`, 'thread = the entity, so its notifications group');
    assertEquals(ios.categoryId, spec.category);
    assertEquals(ios.sound, spec.category === 'critical' ? 'default' : undefined);
    assertEquals(ios.collapseId, push.collapse_key ?? undefined);
    const wire = toExpoMessage(ios);
    for (const field of ['channelId', 'tag', 'platform', ...UNUSED_FIELDS]) assertFalse(field in wire, `${field} is not an iOS field`);
  });

  Deno.test(`${kind}: tap data carries ids only`, () => {
    const { android, ios } = split(kind, 1);
    assertEquals(android.data, ios.data);
    const data = android.data as Record<string, unknown>;
    assertEquals(data.kind, kind);
    assertEquals(data.category, spec.category);
    assertEquals(data.notification_id, `n-${kind}`);
    assertEquals(data.entity, { type: 'chat', id: ENTITY_ID });
    assertEquals((data.args as Record<string, unknown>).post_id, ENTITY_ID);
    const json = JSON.stringify(data);
    assertFalse(json.includes('Dana') || json.includes(PREVIEW), 'no name and no message text in data');
    assert(new TextEncoder().encode(JSON.stringify(toExpoMessage(ios))).length < 4096, 'under the provider payload limit');
  });
}

Deno.test('the preview is asked for exactly by the kinds whose text uses it', () => {
  for (const [kind, spec] of KIND_ENTRIES) {
    assertEquals(previewMessageId(pushFor(kind)), spec.textArgs.includes('messagePreview') ? MESSAGE_ID : null, kind);
  }
  assertEquals(previewMessageId(pushFor('chat_message', { args: {} })), null, 'no message id, no preview');
});

Deno.test('a chat push shows the preview, and a count once it groups', () => {
  assertEquals(renderText(pushFor('chat_message'), PREVIEW), { title: 'Dana Levi', body: PREVIEW });
  const grouped = renderText(pushFor('chat_message', { groupCount: 3 }), PREVIEW);
  assert(grouped.body.startsWith('3 ') && grouped.body.endsWith(PREVIEW));
  assertEquals(renderText(pushFor('chat_message'), null).body, STRINGS['notifications.messagePreviewFallback']);
});

Deno.test('a push that cannot be rendered is a PayloadError, never a half-built message', () => {
  assertThrows(() => buildMessages(pushFor('no_such_kind')), PayloadError, 'unknown_kind');
  assertThrows(() => buildMessages(pushFor('chat_message', { title_key: 'notifications.gone' })), PayloadError, 'missing_text');
  assertEquals(kindSpec('toString'), undefined, 'an inherited property is not a kind');
});

Deno.test('a device without an entity threads by category; a bad badge becomes zero', () => {
  const push = pushFor('account_suspended', { badge: -3, data: { ...pushFor('account_suspended').data, entity: null } });
  const ios = buildMessages(push)[1].message as IosMessage;
  assertEquals([ios.threadId, ios.badge], ['critical', 0]);
});

Deno.test('collapse ids fit the provider limit and stay distinct', () => {
  const short = `chat_message:chat:${ENTITY_ID}`;
  assertEquals(collapseId(short), short);
  const long = (kind: string) => collapseId(`${kind}:post_handoff:${ENTITY_ID}`);
  const a = long('event_registration_waitlist_promoted');
  const b = long('housing_booking_waitlist_promoted_x');
  assert(a.length <= 64 && b.length <= 64);
  assert(a !== b && a.endsWith(ENTITY_ID));
  assertEquals(a, long('event_registration_waitlist_promoted'), 'stable between runs');
});
