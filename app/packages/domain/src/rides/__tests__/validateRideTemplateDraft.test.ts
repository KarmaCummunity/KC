import { describe, expect, it } from 'vitest';
import { validateRideTemplateDraft } from '../validateRideTemplateDraft';
import { RideError } from '../RideError';

const base = {
  mode: 'offer' as const,
  originCityId: '5000',
  destCityId: '4000',
  originStreet: 'a',
  destStreet: 'b',
  weekdayMask: 42,
  seatsAvailable: 3,
  description: null,
  lookaheadDays: 7,
};

describe('validateRideTemplateDraft', () => {
  it('accepts a valid draft', () => {
    expect(() => validateRideTemplateDraft(base)).not.toThrow();
  });

  it('rejects same route (same city + same street)', () => {
    expect(() =>
      validateRideTemplateDraft({
        ...base,
        destCityId: '5000',
        originStreet: 'a',
        destStreet: 'a',
      }),
    ).toThrow(RideError);
  });

  it('rejects empty origin street', () => {
    expect(() => validateRideTemplateDraft({ ...base, originStreet: '   ' })).toThrow(RideError);
  });

  it('rejects empty or whitespace-only dest street', () => {
    expect(() => validateRideTemplateDraft({ ...base, destStreet: '' })).toThrow(RideError);
    expect(() => validateRideTemplateDraft({ ...base, destStreet: '   ' })).toThrow(RideError);
  });

  it('rejects non-integer weekday mask', () => {
    expect(() => validateRideTemplateDraft({ ...base, weekdayMask: 4.5 })).toThrow(RideError);
  });

  it('rejects non-integer lookahead days', () => {
    expect(() => validateRideTemplateDraft({ ...base, lookaheadDays: 7.2 })).toThrow(RideError);
  });

  it('accepts description up to 500 chars', () => {
    expect(() => validateRideTemplateDraft({ ...base, description: 'x'.repeat(500) })).not.toThrow();
  });

  it('rejects offer with null seats', () => {
    expect(() => validateRideTemplateDraft({ ...base, seatsAvailable: null })).toThrow(RideError);
  });

  it('rejects request with seats provided', () => {
    expect(() =>
      validateRideTemplateDraft({ ...base, mode: 'request', seatsAvailable: 2 }),
    ).toThrow(RideError);
  });

  it('rejects weekday_mask 0 and 128', () => {
    expect(() => validateRideTemplateDraft({ ...base, weekdayMask: 0 })).toThrow(RideError);
    expect(() => validateRideTemplateDraft({ ...base, weekdayMask: 128 })).toThrow(RideError);
  });

  it('accepts weekday_mask 1 and 127 boundaries', () => {
    expect(() => validateRideTemplateDraft({ ...base, weekdayMask: 1 })).not.toThrow();
    expect(() => validateRideTemplateDraft({ ...base, weekdayMask: 127 })).not.toThrow();
  });

  it('rejects lookahead_days 0 and 31', () => {
    expect(() => validateRideTemplateDraft({ ...base, lookaheadDays: 0 })).toThrow(RideError);
    expect(() => validateRideTemplateDraft({ ...base, lookaheadDays: 31 })).toThrow(RideError);
  });

  it('rejects description longer than 500 chars', () => {
    expect(() =>
      validateRideTemplateDraft({ ...base, description: 'x'.repeat(501) }),
    ).toThrow(RideError);
  });
});
