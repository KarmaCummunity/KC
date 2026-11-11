import { describe, it, expect } from 'vitest';
import he from '../../../i18n/locales/he';
import { DETAILS_SEPARATOR, notificationText, richTextArgs } from '../notificationText';

/** Strict i18next-like translate over the Hebrew bundle. */
const t = (key: string, args: Record<string, string | number> = {}) => {
  const template = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], he);
  if (typeof template !== 'string') throw new Error(`missing ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!(name in args)) throw new Error(`${key}: ${name}`);
    return String(args[name]);
  });
};

const RIDE = { post_title: 'Haifa to Tel Aviv', when_label: '12.11 08:30', seats: 3, route_from: 'Haifa', route_to: 'Tel Aviv' };

describe('rich notification text (D26)', () => {
  it('builds details from time, seats and route, each after the separator', () => {
    const { postTitle, details } = richTextArgs(RIDE, t);
    expect(postTitle).toBe('Haifa to Tel Aviv');
    expect(details.split(DETAILS_SEPARATOR)).toEqual([
      '',
      '12.11 08:30',
      t('notifications.detailsSeats', { seats: 3 }),
      t('notifications.detailsRoute', { from: 'Haifa', to: 'Tel Aviv' }),
    ]);
  });

  it('falls back to a generic title and no details when the post is unknown', () => {
    expect(richTextArgs(undefined, t)).toEqual({ postTitle: t('notifications.postTitleFallback'), details: '' });
    expect(richTextArgs({ seats: 1, route_to: 'Haifa' }, t).details).toBe('');
  });

  it('a ride booking in the centre names the ride, its time and its route', () => {
    const { body } = notificationText(
      {
        kind: 'ride_booking_requested',
        titleKey: 'notifications.rideBookingRequestedTitle',
        bodyKey: 'notifications.rideBookingRequestedBody',
        groupCount: 1,
        actorDisplayName: 'Dana',
        args: RIDE,
      },
      t,
    );
    for (const part of ['Dana', 'Haifa to Tel Aviv', '12.11 08:30', 'Tel Aviv']) expect(body).toContain(part);
  });
});
