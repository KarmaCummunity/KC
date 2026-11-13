// D26 rich notifications: the post title, time, seats and route the database adds to a
// notification (migration 0027) reach the push text.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { DETAILS_SEPARATOR, renderText, richTextArgs } from './messages.ts';
import strings from './strings.he.generated.json' with { type: 'json' };
import { pushFor } from './testKit.ts';

const STRINGS: Record<string, string> = strings;
const RIDE = { post_title: 'Haifa to Tel Aviv', when_label: '12.11 08:30', seats: 2, route_from: 'Haifa', route_to: 'Tel Aviv' };

Deno.test('rich arguments: title, then time, seats and route, each after the separator', () => {
  const { postTitle, details } = richTextArgs(RIDE);
  assertEquals(postTitle, 'Haifa to Tel Aviv');
  const pieces = details.split(DETAILS_SEPARATOR);
  assertEquals(pieces[0], '', 'details starts with the separator');
  assertEquals(pieces[1], '12.11 08:30');
  assertEquals(pieces[2], STRINGS['notifications.detailsSeats'].replace('{{seats}}', '2'));
  assertEquals(pieces[3], STRINGS['notifications.detailsRoute'].replace('{{from}}', 'Haifa').replace('{{to}}', 'Tel Aviv'));
});

Deno.test('rich arguments: one seat, half a route and no title fall back cleanly', () => {
  const { postTitle, details } = richTextArgs({ seats: 1, route_from: 'Haifa', post_title: '  ' });
  assertEquals(postTitle, STRINGS['notifications.postTitleFallback']);
  assertEquals(details, '');
});

Deno.test('a ride booking push names the ride, its time, seats and route', () => {
  const { body } = renderText(pushFor('ride_booking_requested', { args: { actor_display_name: 'Dana', ...RIDE } }), null);
  for (const part of ['Dana', 'Haifa to Tel Aviv', '12.11 08:30', 'Tel Aviv']) assert(body.includes(part), part);
  assertFalse(body.includes('{{'));
});

Deno.test('a knowledge booking has its own wording, not the item handoff one', () => {
  const knowledge = renderText(pushFor('knowledge_booking_requested', { args: { post_title: 'Guitar lesson' } }), null);
  const item = renderText(pushFor('giving_handoff_requested', { args: { post_title: 'Guitar lesson' } }), null);
  assert(knowledge.body.includes('Guitar lesson'));
  assert(knowledge.title !== item.title && knowledge.body !== item.body);
});
