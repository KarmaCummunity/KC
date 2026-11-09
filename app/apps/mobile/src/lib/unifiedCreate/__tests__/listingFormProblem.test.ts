// FR-POST-001 AC6 — which listing form field a publish problem is shown on.
import { describe, expect, it } from 'vitest';
import {
  detailField,
  fieldForHouseNumbers,
  fieldForRule,
  inlineProblemField,
  renderedListingFields,
} from '../listingFormProblem';

describe('fieldForRule', () => {
  it('a missing route points at the end that is missing', () => {
    expect(fieldForRule('ride_route_required', {})).toBe('ride:origin');
    expect(fieldForRule('ride_route_required', { origin_lat: 31.9, origin_lng: 34.8 })).toBe('ride:dest');
  });

  it('points every other world rule at the field the member fixes', () => {
    expect(fieldForRule('ride_departure_past', {})).toBe('ride:departure');
    expect(fieldForRule('food_expiry_required', {})).toBe('detail:expires_at');
    expect(fieldForRule('knowledge_slot_invalid', {})).toBe('detail:slot_starts_at');
    expect(fieldForRule('event_window_invalid', {})).toBe('detail:starts_at');
    expect(fieldForRule('routed_world_requires_external_body', {})).toBe('org');
    // D132 (KC#1937): a missing offer photo outlines the photo picker.
    expect(fieldForRule('offer_photo_required', {})).toBe('photos');
  });
});

describe('fieldForHouseNumbers', () => {
  it('points at the end whose house number is invalid', () => {
    expect(fieldForHouseNumbers({ origin: 'abc', dest: '9' })).toBe('ride:origin');
    expect(fieldForHouseNumbers({ origin: '12', dest: 'xyz' })).toBe('ride:dest');
  });
});

describe('renderedListingFields', () => {
  it('a ride shows its route and schedule fields instead of a title and a city', () => {
    const fields = renderedListingFields({ isRides: true, isOrgEvent: false, detailKeys: ['passengers'] });
    expect([...fields]).toEqual(['ride:origin', 'ride:dest', 'ride:departure', 'ride:recurrence', 'photos', 'detail:passengers']);
  });

  it('other worlds show title, city, the visible details and the organization of an event', () => {
    const fields = renderedListingFields({ isRides: false, isOrgEvent: true, detailKeys: ['starts_at'] });
    expect([...fields]).toEqual(['title', 'city', 'photos', 'org', 'detail:starts_at']);
  });
});

describe('inlineProblemField', () => {
  const rendered = new Set([detailField('food_type'), 'city' as const]);

  it('is the problem field when it is on screen', () => {
    expect(inlineProblemField({ message: 'm', field: 'city' }, rendered)).toBe('city');
  });

  it('is null for a field not on screen, a server error, or no problem', () => {
    expect(inlineProblemField({ message: 'm', field: 'org' }, rendered)).toBeNull();
    expect(inlineProblemField({ message: 'm', field: null }, rendered)).toBeNull();
    expect(inlineProblemField(null, rendered)).toBeNull();
  });
});
