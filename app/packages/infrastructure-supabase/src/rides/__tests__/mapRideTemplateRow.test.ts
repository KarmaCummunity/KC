import { describe, expect, it } from 'vitest';
import { mapRideTemplateRow } from '../mapRideTemplateRow';

const SAMPLE_TEMPLATE_ROW = {
  template_id: 'tmpl_1',
  owner_id: 'u_owner',
  mode: 'offer',
  origin_city_id: '5000',
  dest_city_id: '4000',
  origin_street: 'Dizengoff',
  origin_street_number: '10',
  dest_street: 'HaNassi',
  dest_street_number: null,
  depart_time: '08:30:00',
  weekday_mask: 31,
  seats_available: 3,
  description: 'Daily commute',
  visibility: 'Public',
  status: 'active',
  lookahead_days: 14,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

describe('mapRideTemplateRow', () => {
  it('maps DB row columns to RideTemplate domain properties', () => {
    const mapped = mapRideTemplateRow(SAMPLE_TEMPLATE_ROW);

    expect(mapped).toEqual({
      templateId: 'tmpl_1',
      ownerId: 'u_owner',
      mode: 'offer',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'Dizengoff',
      originStreetNumber: '10',
      destStreet: 'HaNassi',
      destStreetNumber: null,
      departTime: '08:30:00',
      weekdayMask: 31,
      seatsAvailable: 3,
      description: 'Daily commute',
      visibility: 'Public',
      status: 'active',
      lookaheadDays: 14,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
  });
});
