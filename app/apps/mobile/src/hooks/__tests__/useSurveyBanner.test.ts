// FR-SETTINGS-016 AC6 + KC#1058 — the banner offers the PMF survey first, skips snoozed surveys.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const { store, checkPrompt } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  checkPrompt: vi.fn(async ({ slug }: { slug: string }) => ({ show: true, slug })),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));
vi.mock('../../lib/container', () => ({ container: { checkSurveyPrompt: { execute: checkPrompt } } }));
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../store/authStore', () => ({ useAuthStore: vi.fn() }));

import { findEligibleSlug } from '../useSurveyBanner';

beforeEach(() => {
  store.clear();
  checkPrompt.mockClear();
  checkPrompt.mockImplementation(async ({ slug }: { slug: string }) => ({ show: true, slug }));
});

describe('findEligibleSlug', () => {
  it('offers the PMF survey first when the user qualifies', async () => {
    await expect(findEligibleSlug(4)).resolves.toBe('pmf-sean-ellis');
    expect(checkPrompt).toHaveBeenCalledTimes(1);
    expect(checkPrompt).toHaveBeenCalledWith({ slug: 'pmf-sean-ellis', sessionCount: 4 });
  });

  it('falls back to the UX survey when the PMF survey is not eligible', async () => {
    checkPrompt.mockImplementation(async ({ slug }: { slug: string }) => ({
      show: slug === 'ux-experience',
      slug,
    }));
    await expect(findEligibleSlug(4)).resolves.toBe('ux-experience');
  });

  it('skips a survey snoozed in the last 7 days without asking the server', async () => {
    store.set('kc-survey-snooze-pmf-sean-ellis', new Date().toISOString());
    await expect(findEligibleSlug(4)).resolves.toBe('ux-experience');
    expect(checkPrompt).not.toHaveBeenCalledWith(expect.objectContaining({ slug: 'pmf-sean-ellis' }));
  });

  it('returns null when no survey is eligible', async () => {
    checkPrompt.mockImplementation(async ({ slug }: { slug: string }) => ({ show: false, slug }));
    await expect(findEligibleSlug(1)).resolves.toBeNull();
  });
});
