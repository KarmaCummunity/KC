import { describe, expect, it } from 'vitest';
import { validateRideDraft, type RideDraftInput } from '../validateRideDraft';
import { RideError } from '../RideError';

describe('validateRideDraft bounds and edge cases', () => {
  const base: RideDraftInput = {
    mode: 'offer',
    originCityId: '5000',
    destCityId: '4000',
    originStreet: 'Street A',
    destStreet: 'Street B',
    departsAt: new Date(Date.now() + 3600_000).toISOString(),
    seatsAvailable: 3,
    description: null,
  };

  it('rejects invalid or too long origin street', () => {
    expect(() => validateRideDraft({ ...base, originStreet: '' })).toThrow(RideError);
    expect(() => validateRideDraft({ ...base, originStreet: '   ' })).toThrow(RideError);
    expect(() => validateRideDraft({ ...base, originStreet: 'x'.repeat(81) })).toThrow(RideError);
  });

  it('rejects invalid or too long destination street', () => {
    expect(() => validateRideDraft({ ...base, destStreet: '' })).toThrow(RideError);
    expect(() => validateRideDraft({ ...base, destStreet: '   ' })).toThrow(RideError);
    expect(() => validateRideDraft({ ...base, destStreet: 'x'.repeat(81) })).toThrow(RideError);
  });

  describe('cargo bounds', () => {
    it('accepts cargo disabled with no bounds set', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: false, maxVolumeL: null, maxWeightKg: null, allowedTypes: null },
        }),
      ).not.toThrow();
    });

    it('rejects cargo disabled when bounds are set', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: false, maxVolumeL: 50, maxWeightKg: null, allowedTypes: null },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: false, maxVolumeL: null, maxWeightKg: 10, allowedTypes: null },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: false, maxVolumeL: null, maxWeightKg: null, allowedTypes: ['furniture'] },
        }),
      ).toThrow(RideError);
    });

    it('rejects cargo enabled with invalid maxVolumeL or maxWeightKg', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: true, maxVolumeL: 0, maxWeightKg: 10, allowedTypes: ['furniture'] },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: true, maxVolumeL: 100, maxWeightKg: null, allowedTypes: ['furniture'] },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: true, maxVolumeL: 100, maxWeightKg: 0, allowedTypes: ['furniture'] },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: true, maxVolumeL: 100, maxWeightKg: 201, allowedTypes: ['furniture'] },
        }),
      ).toThrow(RideError);
    });

    it('rejects cargo enabled with empty or excessive allowedTypes', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: { enabled: true, maxVolumeL: 50, maxWeightKg: 10, allowedTypes: [] },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          cargo: {
            enabled: true,
            maxVolumeL: 50,
            maxWeightKg: 10,
            allowedTypes: ['furniture', 'small_packages', 'luggage', 'electronics', 'dry_food'] as never,
          },
        }),
      ).toThrow(RideError);
    });
  });

  describe('food bounds', () => {
    it('accepts food disabled with no bounds set', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: false, maxKg: null, chilled: null },
        }),
      ).not.toThrow();
    });

    it('rejects food disabled with bounds set', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: false, maxKg: 5, chilled: null },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: false, maxKg: null, chilled: true },
        }),
      ).toThrow(RideError);
    });

    it('rejects food enabled with invalid maxKg or missing chilled flag', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: true, maxKg: 0, chilled: false },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: true, maxKg: 51, chilled: false },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: true, maxKg: 10, chilled: null },
        }),
      ).toThrow(RideError);
    });

    it('accepts valid food enabled spec', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          food: { enabled: true, maxKg: 15, chilled: true },
        }),
      ).not.toThrow();
    });
  });

  describe('payment bounds', () => {
    it('rejects invalid payment model', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          // @ts-expect-error testing invalid model
          payment: { model: 'crypto', amountIls: 10 },
        }),
      ).toThrow(RideError);
    });

    it('rejects expense_share without valid positive amount', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          payment: { model: 'expense_share', amountIls: null as never },
        }),
      ).toThrow(RideError);
      expect(() =>
        validateRideDraft({
          ...base,
          payment: { model: 'expense_share', amountIls: 0 },
        }),
      ).toThrow(RideError);
    });

    it('accepts valid free payment', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          payment: { model: 'free', amountIls: null },
        }),
      ).not.toThrow();
    });
  });

  describe('requirements bounds', () => {
    it('rejects invalid gender requirement', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          // @ts-expect-error testing invalid gender
          requirements: { gender: 'robots_only', smokingAllowed: false, petsAllowed: false, verifiedOnly: false },
        }),
      ).toThrow(RideError);
    });

    it('accepts valid gender requirements', () => {
      expect(() =>
        validateRideDraft({
          ...base,
          requirements: { gender: 'men_only', smokingAllowed: false, petsAllowed: false, verifiedOnly: false },
        }),
      ).not.toThrow();
      expect(() =>
        validateRideDraft({
          ...base,
          requirements: { gender: 'any', smokingAllowed: false, petsAllowed: false, verifiedOnly: false },
        }),
      ).not.toThrow();
    });
  });
});
