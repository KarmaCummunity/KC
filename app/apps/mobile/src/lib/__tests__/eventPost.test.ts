// G1 step 5 (D31) — the event section's labels and actions: register vs request per policy, the
// organizer's actions per registration state, roster counts and the closed-registration check.
import { describe, expect, it } from 'vitest';
import { eventHasStarted, registerActionLabelKey, rosterActionsFor, summarizeEventRoster } from '../eventPost';

describe('registerActionLabelKey', () => {
  it('asks to join a manual event and registers to the others', () => {
    expect(registerActionLabelKey('manual')).toBe('eventPost.registration.requestToJoin');
    expect(registerActionLabelKey('automatic')).toBe('eventPost.registration.register');
    expect(registerActionLabelKey('verified_only')).toBe('eventPost.registration.register');
  });
});

describe('rosterActionsFor', () => {
  it('decides a waiting registration and removes a confirmed one', () => {
    expect(rosterActionsFor('reserved')).toEqual(['approve', 'decline']);
    expect(rosterActionsFor('confirmed')).toEqual(['remove']);
  });

  it('offers nothing on a finished registration', () => {
    expect(rosterActionsFor('cancelled')).toEqual([]);
    expect(rosterActionsFor('handed_over')).toEqual([]);
  });
});

describe('summarizeEventRoster', () => {
  it('counts confirmed and waiting registrations only', () => {
    const rows = [{ status: 'confirmed' }, { status: 'reserved' }, { status: 'confirmed' }, { status: 'cancelled' }];
    expect(summarizeEventRoster(rows)).toEqual({ confirmed: 2, waiting: 1 });
    expect(summarizeEventRoster([])).toEqual({ confirmed: 0, waiting: 0 });
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
