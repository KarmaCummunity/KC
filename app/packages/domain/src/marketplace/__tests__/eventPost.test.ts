// G1 step 5 (D31, 0563) — the event fields of an organization's event listing and its policy and
// registration-status guards.
import { describe, expect, it } from 'vitest';
import {
  canLeaveEventRegistration,
  EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_STATUSES,
  isActiveEventRegistrationStatus,
  isEventRegistrationStatus,
  isEventRegistrationPolicy,
  parseEventPostDetails,
} from '../eventPost';

const WINDOW = { starts_at: '2026-11-10T08:00:00Z', ends_at: '2026-11-10T10:00:00Z' };

describe('parseEventPostDetails', () => {
  it('reads every event field', () => {
    expect(
      parseEventPostDetails({
        ...WINDOW,
        org_id: '00000000-0000-0000-0000-000000000001',
        capacity: 40,
        registration_policy: 'manual',
        address: '  Herzl 1, Haifa ',
      }),
    ).toEqual({
      orgId: '00000000-0000-0000-0000-000000000001',
      startsAt: WINDOW.starts_at,
      endsAt: WINDOW.ends_at,
      capacity: 40,
      registrationPolicy: 'manual',
      address: 'Herzl 1, Haifa',
    });
  });

  it('leaves the optional fields empty when absent or malformed', () => {
    const parsed = parseEventPostDetails({ ...WINDOW, registration_policy: 'automatic', capacity: 2.5, address: ' ' });
    expect(parsed).toMatchObject({ orgId: null, capacity: null, address: null });
  });

  it('is null without a valid window or policy (not an event)', () => {
    expect(parseEventPostDetails({ duration_minutes: 60 })).toBeNull();
    expect(parseEventPostDetails({ ...WINDOW, registration_policy: 'open' })).toBeNull();
    expect(parseEventPostDetails({ starts_at: 'x', ends_at: WINDOW.ends_at, registration_policy: 'manual' })).toBeNull();
  });
});

describe('event guards', () => {
  it('knows the three registration policies only', () => {
    for (const policy of EVENT_REGISTRATION_POLICIES) expect(isEventRegistrationPolicy(policy)).toBe(true);
    expect(isEventRegistrationPolicy('open')).toBe(false);
    expect(isEventRegistrationPolicy(undefined)).toBe(false);
  });

  it('treats reserved, confirmed and waitlisted registrations as active (0564)', () => {
    expect(isActiveEventRegistrationStatus('reserved')).toBe(true);
    expect(isActiveEventRegistrationStatus('confirmed')).toBe(true);
    expect(isActiveEventRegistrationStatus('waitlisted')).toBe(true);
    expect(isActiveEventRegistrationStatus('handed_over')).toBe(false);
    expect(isActiveEventRegistrationStatus('no_show')).toBe(false);
    expect(isActiveEventRegistrationStatus('cancelled')).toBe(false);
    expect(isActiveEventRegistrationStatus(null)).toBe(false);
  });

  it('lets a registrant leave exactly while the registration is active', () => {
    for (const status of EVENT_REGISTRATION_STATUSES) {
      expect(canLeaveEventRegistration(status)).toBe(isActiveEventRegistrationStatus(status));
    }
    expect(canLeaveEventRegistration('a_newer_status')).toBe(false);
  });

  it('knows every registration state, attendance and the waitlist included', () => {
    for (const status of EVENT_REGISTRATION_STATUSES) expect(isEventRegistrationStatus(status)).toBe(true);
    expect(isEventRegistrationStatus('waitlisted')).toBe(true);
    expect(isEventRegistrationStatus('expired')).toBe(false);
  });
});
