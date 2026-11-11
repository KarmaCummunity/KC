// FR-HOUSING-015, 018, 019, 020 — client mirror of the housing stay rules (0602–0603).
import { describe, expect, it } from 'vitest';
import {
  guestStayActions,
  hostBookingActions,
  housingNights,
  housingOfferTerms,
  housingToday,
  isLateHousingCancel,
  validateStayRequest,
} from '../housingStayRules';
import type { HousingGuestStay, HousingHostBooking, HousingStayRequestInput } from '../HousingStay';

const TODAY = '2030-03-10';
const terms = { minNights: 1, maxNights: 3, childrenOk: true, capacity: 4 };
const request = (over: Partial<HousingStayRequestInput> = {}): HousingStayRequestInput => ({
  listingId: 'l1',
  checkInDate: '2030-03-12',
  checkOutDate: '2030-03-14',
  adults: 2,
  minors: 0,
  message: 'Walking the trail, need a bed',
  minorsGuardianAck: false,
  ...over,
});

describe('housingNights', () => {
  it('counts the nights between check-in and check-out days', () => {
    expect(housingNights('2030-03-12', '2030-03-14')).toBe(2);
    expect(housingNights('2030-02-28', '2030-03-01')).toBe(1);
  });
  it('rejects malformed or impossible days', () => {
    expect(housingNights('2030-02-30', '2030-03-01')).toBeNull();
    expect(housingNights('12/03/2030', '2030-03-14')).toBeNull();
  });
});

describe('housingToday', () => {
  it('is the Israel day, which can differ from the UTC day', () => {
    // 22:30 UTC on 9 March is already 10 March in Israel (UTC+2 in winter).
    expect(housingToday(new Date('2030-03-09T22:30:00Z'))).toBe('2030-03-10');
    expect(housingToday(new Date('2030-03-09T12:00:00Z'))).toBe('2030-03-09');
  });
});

describe('housingOfferTerms', () => {
  it('reads the host terms and falls back on missing keys', () => {
    expect(housingOfferTerms({ min_nights: 2, max_nights: 5, children_ok: true, capacity: 3 }))
      .toEqual({ minNights: 2, maxNights: 5, childrenOk: true, capacity: 3 });
    expect(housingOfferTerms({})).toEqual({ minNights: 1, maxNights: 30, childrenOk: false, capacity: 1 });
  });
});

describe('validateStayRequest', () => {
  it('accepts a request inside every rule', () => {
    expect(validateStayRequest(request(), terms, TODAY)).toBeNull();
  });
  it('refuses past dates and check-ins beyond 180 days', () => {
    expect(validateStayRequest(request({ checkInDate: '2030-03-09' }), terms, TODAY)).toBe('housing_dates_invalid');
    expect(validateStayRequest(request({ checkInDate: '2030-09-07', checkOutDate: '2030-09-08' }), terms, TODAY))
      .toBe('housing_dates_invalid');
  });
  it('enforces the host night limits, at least one night', () => {
    expect(validateStayRequest(request({ checkOutDate: '2030-03-12' }), terms, TODAY)).toBe('housing_nights_out_of_range');
    expect(validateStayRequest(request({ checkOutDate: '2030-03-16' }), terms, TODAY)).toBe('housing_nights_out_of_range');
  });
  it('caps the party by the place and by 8', () => {
    expect(validateStayRequest(request({ adults: 5 }), terms, TODAY)).toBe('housing_capacity_exceeded');
    expect(validateStayRequest(request({ adults: 0 }), terms, TODAY)).toBe('housing_capacity_exceeded');
  });
  it('lets children come only where welcome, and only with a guardian', () => {
    expect(validateStayRequest(request({ minors: 1 }), { ...terms, childrenOk: false }, TODAY)).toBe('housing_policy_mismatch');
    expect(validateStayRequest(request({ minors: 1 }), terms, TODAY)).toBe('housing_minor_unaccompanied');
    expect(validateStayRequest(request({ minors: 1, minorsGuardianAck: true }), terms, TODAY)).toBeNull();
  });
  it('needs a message of 1–500 characters', () => {
    expect(validateStayRequest(request({ message: '   ' }), terms, TODAY)).toBe('housing_message_required');
    expect(validateStayRequest(request({ message: 'x'.repeat(501) }), terms, TODAY)).toBe('housing_message_required');
  });
});

const START = '2030-03-12T14:00:00.000Z';
const END = '2030-03-14T08:00:00.000Z';
const at = (iso: string) => new Date(iso);
const hostBooking = (status: HousingHostBooking['status']): HousingHostBooking => ({
  handoffId: 'h1', guestId: 'g1', guestName: 'Guest', guestAvatarUrl: null, guestVerified: true,
  guestCompletedStays: 0, guestMemberSince: '2029-01-01T00:00:00Z', adults: 1, minors: 0, message: 'hi',
  status, reservedAt: '2030-03-10T10:00:00Z', confirmBy: null, ratedByMe: false,
  checkInDate: '2030-03-12', checkOutDate: '2030-03-14', startsAt: START, endsAt: END,
});

describe('hostBookingActions', () => {
  it('a waiting booking is approved or declined', () => {
    expect(hostBookingActions(hostBooking('reserved'), at('2030-03-10T12:00:00Z'))).toEqual(['approve', 'decline']);
  });
  it('a confirmed stay can be cancelled before check-in only', () => {
    expect(hostBookingActions(hostBooking('confirmed'), at('2030-03-11T12:00:00Z'))).toEqual(['cancel']);
  });
  it('completion opens at check-in; no-show from 3 h to 24 h after it', () => {
    expect(hostBookingActions(hostBooking('confirmed'), at('2030-03-12T15:00:00Z'))).toEqual(['complete']);
    expect(hostBookingActions(hostBooking('confirmed'), at('2030-03-12T18:00:00Z'))).toEqual(['complete', 'no_show']);
    expect(hostBookingActions(hostBooking('confirmed'), at('2030-03-21T09:00:00Z'))).toEqual([]);
  });
  it('a finished booking offers nothing', () => {
    expect(hostBookingActions(hostBooking('handed_over'), at('2030-03-14T09:00:00Z'))).toEqual([]);
    expect(hostBookingActions(hostBooking('cancelled'), at('2030-03-11T09:00:00Z'))).toEqual([]);
  });
});

describe('guestStayActions', () => {
  const stay = (over: Partial<HousingGuestStay>): HousingGuestStay => ({
    handoffId: 'h1', listingId: 'l1', listingTitle: 'Room', cityId: null, hostId: 'o1', hostName: 'Host',
    adults: 1, minors: 0, status: 'confirmed', cancelReason: null, reservedAt: '2030-03-10T10:00:00Z',
    confirmBy: null, canViewAddress: true, ratedByMe: false,
    checkInDate: '2030-03-12', checkOutDate: '2030-03-14', startsAt: START, endsAt: END, ...over,
  });
  it('a confirmed guest cancels before check-in and sees the address', () => {
    expect(guestStayActions(stay({}), at('2030-03-11T10:00:00Z'))).toEqual(['cancel', 'show_address']);
  });
  it('a waiting guest cannot see the address', () => {
    expect(guestStayActions(stay({ status: 'reserved', canViewAddress: false }), at('2030-03-11T10:00:00Z')))
      .toEqual(['cancel']);
  });
  it('a completed stay asks for a rating once', () => {
    expect(guestStayActions(stay({ status: 'handed_over', canViewAddress: false }), at('2030-03-15T10:00:00Z')))
      .toEqual(['rate']);
    expect(guestStayActions(stay({ status: 'handed_over', canViewAddress: false, ratedByMe: true }), at('2030-03-15T10:00:00Z')))
      .toEqual([]);
  });
});

describe('isLateHousingCancel', () => {
  it('is late within 24 h for a guest and within 48 h for a host', () => {
    const now = at('2030-03-11T00:00:00Z'); // 38 h before check-in
    expect(isLateHousingCancel(START, 'guest', now)).toBe(false);
    expect(isLateHousingCancel(START, 'host', now)).toBe(true);
  });
});
