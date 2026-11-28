import { expect, it } from 'vitest';
import { DETAILS_SEPARATOR, renderText, richTextArgs } from '../pushMessages';
import strings from '../strings.he.generated.json';
import { pushFor } from './pushTestKit';

// D26 rich notifications: the post title, time, seats and route the database adds to a
// notification (migration 0027) reach the push text.

const STRINGS: Record<string, string> = strings;
const RIDE = { post_title: 'Haifa to Tel Aviv', when_label: '12.11 08:30', seats: 2, route_from: 'Haifa', route_to: 'Tel Aviv' };

it('rich arguments: title, then time, seats and route, each after the separator', () => {
  const { postTitle, details } = richTextArgs(RIDE);
  expect(postTitle).toEqual('Haifa to Tel Aviv');
  const pieces = details.split(DETAILS_SEPARATOR);
  expect(pieces[0], 'details starts with the separator').toEqual('');
  expect(pieces[1]).toEqual('12.11 08:30');
  expect(pieces[2]).toEqual(STRINGS['notifications.detailsSeats']!.replace('{{seats}}', '2'));
  expect(pieces[3]).toEqual(STRINGS['notifications.detailsRoute']!.replace('{{from}}', 'Haifa').replace('{{to}}', 'Tel Aviv'));
});

it('rich arguments: one seat, half a route and no title fall back cleanly', () => {
  const { postTitle, details } = richTextArgs({ seats: 1, route_from: 'Haifa', post_title: '  ' });
  expect(postTitle).toEqual(STRINGS['notifications.postTitleFallback']);
  expect(details).toEqual('');
});

it('a ride booking push names the ride, its time, seats and route', () => {
  const { body } = renderText(pushFor('ride_booking_requested', { args: { actor_display_name: 'Dana', ...RIDE } }), null);
  for (const part of ['Dana', 'Haifa to Tel Aviv', '12.11 08:30', 'Tel Aviv']) expect(body.includes(part), part).toBe(true);
  expect(body.includes('{{')).toBe(false);
});

it('a knowledge booking has its own wording, not the item handoff one', () => {
  const knowledge = renderText(pushFor('knowledge_booking_requested', { args: { post_title: 'Guitar lesson' } }), null);
  const item = renderText(pushFor('giving_handoff_requested', { args: { post_title: 'Guitar lesson' } }), null);
  expect(knowledge.body.includes('Guitar lesson')).toBe(true);
  expect(knowledge.title !== item.title && knowledge.body !== item.body).toBe(true);
});
