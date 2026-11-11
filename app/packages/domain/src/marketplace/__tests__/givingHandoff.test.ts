import { describe, it, expect } from 'vitest';
import {
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
