import { describe, expect, it } from 'vitest';
import { canSubmitLegalConsent, legalUpdateDaysRemaining, MIN_SIGNUP_AGE } from '../legalConsentRules';

const pending = [{ docType: 'terms' as const }, { docType: 'privacy' as const }];
const allAccepted = { terms: true, privacy: true };

describe('canSubmitLegalConsent (#1450, 18+ at launch)', () => {
  it('uses 18 as the launch minimum age', () => {
    expect(MIN_SIGNUP_AGE).toBe(18);
  });
  it('blocks sign-up without the age confirmation even when all docs are accepted', () => {
    expect(canSubmitLegalConsent({ mode: 'signup', pending, accepted: allAccepted, ageConfirmed: false })).toBe(false);
  });
  it('allows sign-up once docs are accepted and age is confirmed', () => {
    expect(canSubmitLegalConsent({ mode: 'signup', pending, accepted: allAccepted, ageConfirmed: true })).toBe(true);
  });
  it('still requires every document at sign-up', () => {
    expect(canSubmitLegalConsent({ mode: 'signup', pending, accepted: { terms: true }, ageConfirmed: true })).toBe(false);
  });
  it('does not ask existing users to re-confirm age on a document update', () => {
    expect(canSubmitLegalConsent({ mode: 'update', pending, accepted: allAccepted, ageConfirmed: false })).toBe(true);
  });
});

describe('legalUpdateDaysRemaining', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 7);
  const effectiveDaysAgo = (days: number) => ({ currentEffectiveDate: new Date(now - days * day) });

  it('shows the full grace period when nothing is pending', () => {
    expect(legalUpdateDaysRemaining([], now)).toBe(7);
  });
  it('counts down from the earliest pending document', () => {
    expect(legalUpdateDaysRemaining([effectiveDaysAgo(1), effectiveDaysAgo(3)], now)).toBe(4);
  });
  it('never goes below zero once the grace period is over', () => {
    expect(legalUpdateDaysRemaining([effectiveDaysAgo(30)], now)).toBe(0);
  });
});
