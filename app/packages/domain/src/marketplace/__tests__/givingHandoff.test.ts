import { describe, it, expect } from 'vitest';
import {
  canTransitionGivingHandoff,
  validateGivingHandoffTransition,
  validateHandoffFeedback,
  isGivingHandoffStatus,
  isValidPickupMode,
  isValidHandoffRating,
  GivingHandoffError,
} from '../givingHandoff';

describe('giving handoff domain model', () => {
  describe('type predicates', () => {
    it('recognizes valid handoff statuses', () => {
      expect(isGivingHandoffStatus('reserved')).toBe(true);
      expect(isGivingHandoffStatus('confirmed')).toBe(true);
      expect(isGivingHandoffStatus('handed_over')).toBe(true);
      expect(isGivingHandoffStatus('cancelled')).toBe(true);
      expect(isGivingHandoffStatus('no_show')).toBe(true);
      expect(isGivingHandoffStatus('open')).toBe(false);
      expect(isGivingHandoffStatus(null)).toBe(false);
      expect(isGivingHandoffStatus(123)).toBe(false);
    });

    it('recognizes valid pickup modes', () => {
      expect(isValidPickupMode('pickup')).toBe(true);
      expect(isValidPickupMode('delivery')).toBe(true);
      expect(isValidPickupMode('shipping')).toBe(false);
      expect(isValidPickupMode('')).toBe(false);
      expect(isValidPickupMode(null)).toBe(false);
    });

    it('validates 1-5 star ratings', () => {
      expect(isValidHandoffRating(1)).toBe(true);
      expect(isValidHandoffRating(3)).toBe(true);
      expect(isValidHandoffRating(5)).toBe(true);
      expect(isValidHandoffRating(0)).toBe(false);
      expect(isValidHandoffRating(6)).toBe(false);
      expect(isValidHandoffRating(4.5)).toBe(false);
      expect(isValidHandoffRating('5')).toBe(false);
      expect(isValidHandoffRating(null)).toBe(false);
    });
  });

  describe('canTransitionGivingHandoff', () => {
    it('allows owner to confirm a reservation (select recipient)', () => {
      expect(canTransitionGivingHandoff('reserved', 'confirmed', 'owner')).toBe(true);
      expect(canTransitionGivingHandoff('reserved', 'confirmed')).toBe(true);
    });

    it('forbids recipient from confirming a reservation', () => {
      expect(canTransitionGivingHandoff('reserved', 'confirmed', 'recipient')).toBe(false);
    });

    it('allows both owner and recipient to cancel a reserved handoff', () => {
      expect(canTransitionGivingHandoff('reserved', 'cancelled', 'owner')).toBe(true);
      expect(canTransitionGivingHandoff('reserved', 'cancelled', 'recipient')).toBe(true);
    });

    it('forbids jumping directly from reserved to handed_over without confirmation', () => {
      expect(canTransitionGivingHandoff('reserved', 'handed_over', 'owner')).toBe(false);
      expect(canTransitionGivingHandoff('reserved', 'handed_over', 'recipient')).toBe(false);
    });

    it('allows completing a confirmed handoff', () => {
      expect(canTransitionGivingHandoff('confirmed', 'handed_over', 'owner')).toBe(true);
      expect(canTransitionGivingHandoff('confirmed', 'handed_over', 'recipient')).toBe(true);
    });

    it('allows cancelling a confirmed handoff', () => {
      expect(canTransitionGivingHandoff('confirmed', 'cancelled', 'owner')).toBe(true);
      expect(canTransitionGivingHandoff('confirmed', 'cancelled', 'recipient')).toBe(true);
    });

    it('forbids any transition from terminal states', () => {
      for (const terminal of ['handed_over', 'cancelled', 'no_show'] as const) {
        expect(canTransitionGivingHandoff(terminal, 'confirmed')).toBe(false);
        expect(canTransitionGivingHandoff(terminal, 'reserved')).toBe(false);
        expect(canTransitionGivingHandoff(terminal, 'handed_over')).toBe(false);
        expect(canTransitionGivingHandoff(terminal, 'cancelled')).toBe(false);
      }
    });

    it('forbids transitioning to the same status', () => {
      expect(canTransitionGivingHandoff('reserved', 'reserved')).toBe(false);
      expect(canTransitionGivingHandoff('confirmed', 'confirmed')).toBe(false);
    });
  });

  describe('validateGivingHandoffTransition', () => {
    it('accepts valid request -> select recipient transition', () => {
      expect(() => validateGivingHandoffTransition('reserved', 'confirmed', 'owner')).not.toThrow();
    });

    it('accepts valid confirmed -> handed_over complete transition', () => {
      expect(() => validateGivingHandoffTransition('confirmed', 'handed_over', 'owner')).not.toThrow();
      expect(() => validateGivingHandoffTransition('confirmed', 'handed_over', 'recipient')).not.toThrow();
    });

    it('throws handoff_not_confirmed if trying to complete from reserved', () => {
      expect(() => validateGivingHandoffTransition('reserved', 'handed_over', 'owner')).toThrowError(
        GivingHandoffError,
      );
      try {
        validateGivingHandoffTransition('reserved', 'handed_over', 'owner');
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('handoff_not_confirmed');
      }
    });

    it('throws owner_only if recipient tries to confirm reservation', () => {
      try {
        validateGivingHandoffTransition('reserved', 'confirmed', 'recipient');
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('owner_only');
      }
    });

    it('throws invalid_status on transition from terminal states', () => {
      try {
        validateGivingHandoffTransition('handed_over', 'confirmed');
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_status');
      }
      try {
        validateGivingHandoffTransition('cancelled', 'handed_over');
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_status');
      }
    });

    it('handles cancellation and invalid intermediate transitions', () => {
      expect(() => validateGivingHandoffTransition('reserved', 'cancelled', 'owner')).not.toThrow();
      expect(() => validateGivingHandoffTransition('confirmed', 'cancelled', 'recipient')).not.toThrow();

      expect(() => validateGivingHandoffTransition('reserved', 'no_show')).toThrowError(GivingHandoffError);
      expect(() => validateGivingHandoffTransition('confirmed', 'reserved')).toThrowError(GivingHandoffError);
      expect(() => validateGivingHandoffTransition('confirmed', 'no_show')).toThrowError(GivingHandoffError);
      // @ts-expect-error test unsupported from status
      expect(() => validateGivingHandoffTransition('unknown_status', 'confirmed')).toThrowError(GivingHandoffError);
    });
  });

  describe('validateHandoffFeedback', () => {
    it('succeeds for handed_over handoff with valid rating and note', () => {
      expect(() => validateHandoffFeedback('handed_over', 5, 'Thank you!')).not.toThrow();
      expect(() => validateHandoffFeedback('handed_over', 1, null)).not.toThrow();
      expect(() => validateHandoffFeedback('handed_over', 3, undefined)).not.toThrow();
      expect(() => validateHandoffFeedback('handed_over', 4, 'a'.repeat(300))).not.toThrow();
    });

    it('throws if handoff is not in handed_over status', () => {
      try {
        validateHandoffFeedback('reserved', 5);
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_status');
      }
      try {
        validateHandoffFeedback('confirmed', 5);
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_status');
      }
    });

    it('throws invalid_rating for rating out of 1-5 range', () => {
      try {
        validateHandoffFeedback('handed_over', 0);
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_rating');
      }
      try {
        validateHandoffFeedback('handed_over', 6);
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('invalid_rating');
      }
    });

    it('throws comment_too_long if comment exceeds 300 characters', () => {
      const longComment = 'a'.repeat(301);
      try {
        validateHandoffFeedback('handed_over', 5, longComment);
      } catch (e) {
        expect((e as GivingHandoffError).code).toBe('comment_too_long');
      }
    });
  });
});
