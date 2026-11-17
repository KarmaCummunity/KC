// Animals world (docs/spec/05_giving_worlds.md §5.9, D125): publish → found in the world feed and
// the main feed → chat on the post → reserve → confirm → hand over → rate, two users (#1027).
// An adoption or foster offer takes the item handoff (kc_private.handoff_flow_of: 'request'), so
// each journey is the items shape.
import { test, expect } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp } from '../lib/app';
import { cleanupE2eContent, runTag, sessionFor } from '../lib/api';
import { USER_A, USER_B } from '../lib/env';
import { feedShows } from '../lib/postDiscovery';
import { publishPostAs } from '../lib/publish';
import { defineWorldJourney } from '../lib/worldJourney';

// Handing an animal over for adoption.
defineWorldJourney({
  world: 'animals',
  kindSlug: 'adoption_offer',
  publish: 'plain',
  titleHe: 'כלבה בת שנתיים מחפשת בית',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  // The animals fields live in posts.details; species is the one the create form requires.
  details: () => ({ species: 'dog', age_group: 'adult', sex: 'female', vaccinated: true }),
});

// Boarding / pet-sitting offered: the same handoff, its own required fields (species, care mode).
defineWorldJourney({
  world: 'animals',
  kindSlug: 'foster_offer',
  publish: 'plain',
  titleHe: 'פנסיון לחתולים לשבוע',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  details: () => ({ species: 'cat', care_mode: 'full_boarding', location_mode: 'my_home', duration_days: 7 }),
});

// Looking to adopt (a request): it takes no handoff, so the journey is publish and discovery.
test.describe.serial('animals (adoption_request): looking to adopt', () => {
  test('user A asks to adopt; user B finds the request in the animals feed and the main feed', async () => {
    const { id, title } = await publishPostAs(USER_A, {
      world: 'animals',
      kindSlug: 'adoption_request',
      publish: 'plain',
      title: `${runTag()} מחפשים לאמץ כלב`,
      details: () => ({ species: 'dog', size: 'small' }),
    });
    const { session } = await sessionFor(USER_B);
    const token = session.access_token as string;
    await expect.poll(() => feedShows(token, id, title, 'animals'), { timeout: 30_000, message: 'animals feed' }).toBe(true);
    await expect.poll(() => feedShows(token, id, title, null), { timeout: 30_000, message: 'main feed' }).toBe(true);
  });

  test.afterAll(async () => {
    await cleanupE2eContent(USER_A);
  });
});

// he/en RTL (#1027): the animals world reads left to right in English with every label translated.
test('the animals world in English: LTR and no raw translation keys', async ({ page }) => {
  await gotoApp(page, '/settings/language');
  await page.getByText('English', { exact: true }).click();
  await page.waitForLoadState('networkidle');
  try {
    await gotoApp(page, '/donations/animals');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', { timeout: 20_000 });
    await expectNoRawI18nKeys(page);
  } finally {
    // Restore Hebrew for the rest of the suite, whatever the checks found.
    await gotoApp(page, '/settings/language');
    await page.getByText('עברית', { exact: true }).click();
    await page.waitForLoadState('networkidle');
  }
});
