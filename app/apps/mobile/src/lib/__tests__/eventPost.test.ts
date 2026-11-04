// G1 step 5 (D31) — the event section's labels and actions: register vs request per policy, the
// organizer's actions per registration state, roster counts and the closed-registration check.
import { describe, expect, it } from 'vitest';
import type { EventRegistration } from '@kc/domain';
import {
  eventHasStarted,
  groupEventRoster,
  registerActionLabelKey,
  rosterActionsFor,
  summarizeEventRoster,
} from '../eventPost';

describe('registerActionLabelKey', () => {
  it('asks to join a manual event and registers to the others', () => {
    expect(registerActionLabelKey('manual')).toBe('eventPost.registration.requestToJoin');
    expect(registerActionLabelKey('automatic')).toBe('eventPost.registration.register');
    expect(registerActionLabelKey('verified_only')).toBe('eventPost.registration.register');
  });
});

describe('rosterActionsFor', () => {
  it('before the start: decides a request and removes a confirmed or waitlisted registration', () => {
    expect(rosterActionsFor('reserved', false)).toEqual(['approve', 'decline']);
    expect(rosterActionsFor('confirmed', false)).toEqual(['remove']);
    expect(rosterActionsFor('waitlisted', false)).toEqual(['remove']);
    expect(rosterActionsFor('no_show', false)).toEqual([]);
  });

  it('from the start: marks a confirmed registrant and corrects an absence to attended (S13)', () => {
    expect(rosterActionsFor('confirmed', true)).toEqual(['attended', 'noshow']);
    expect(rosterActionsFor('no_show', true)).toEqual(['attended']);
  });

  it('offers nothing on a finished registration', () => {
    expect(rosterActionsFor('cancelled', true)).toEqual([]);
    expect(rosterActionsFor('handed_over', true)).toEqual([]);
  });
});

describe('groupEventRoster', () => {
  const row = (handoffId: string, status: EventRegistration['status'], reservedAt: string): EventRegistration => ({
    handoffId, recipientId: 'u', displayName: null, status, reservedAt, confirmedAt: null,
  });

  it('keeps the registrations in order and puts the waitlist earliest first', () => {
    const rows = [
      row('w2', 'waitlisted', '2026-11-02T00:00:00Z'),
      row('c1', 'confirmed', '2026-11-03T00:00:00Z'),
      row('w1', 'waitlisted', '2026-11-01T00:00:00Z'),
      row('r1', 'reserved', '2026-10-30T00:00:00Z'),
    ];
    const groups = groupEventRoster(rows);
    expect(groups.registrations.map((r) => r.handoffId)).toEqual(['c1', 'r1']);
    expect(groups.waitlist.map((r) => r.handoffId)).toEqual(['w1', 'w2']);
  });

  it('has an empty waitlist when nobody waits', () => {
    expect(groupEventRoster([row('c1', 'confirmed', '2026-11-03T00:00:00Z')]).waitlist).toEqual([]);
  });
});

describe('summarizeEventRoster', () => {
  it('counts confirmed, waiting and waitlisted registrations only', () => {
    const rows = [
      { status: 'confirmed' },
      { status: 'reserved' },
      { status: 'confirmed' },
      { status: 'cancelled' },
      { status: 'waitlisted' },
    ] as const;
    expect(summarizeEventRoster(rows)).toEqual({ confirmed: 2, waiting: 1, waitlisted: 1 });
    expect(summarizeEventRoster([])).toEqual({ confirmed: 0, waiting: 0, waitlisted: 0 });
  });
});

describe('eventHasStarted', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  it('is true from the start time on', () => {
    expect(eventHasStarted('2026-11-04T10:00:00Z', now)).toBe(true);
    expect(eventHasStarted('2026-11-04T09:00:00Z', now)).toBe(true);
  });
  it('is false before it starts', () => {
    expect(eventHasStarted('2026-11-04T11:00:00Z', now)).toBe(false);
  });
});
