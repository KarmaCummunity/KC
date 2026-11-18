// Animals world (docs/spec/05_giving_worlds.md §5.9, D125), two users, all four kinds (#1027).
// An adoption or foster offer takes the item handoff (kc_private.handoff_flow_of: 'request'), so
// its journey is the items shape: publish → found in the world feed and the main feed → chat on
// the post → reserve → confirm → hand over → rate. A request (looking to adopt, looking for
// boarding) takes no handoff: a member answers it in the chat on the post, where its journey ends.
import { test, expect } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp } from '../lib/app';
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

// Looking to adopt: a request, answered in the chat on the post.
defineWorldJourney({
  world: 'animals',
  kindSlug: 'adoption_request',
  publish: 'plain',
  titleHe: 'מחפשים לאמץ כלב',
  details: () => ({ species: 'dog', size: 'small' }),
});

// Looking for boarding / pet-sitting: the other request, with the care fields of the foster offer.
defineWorldJourney({
  world: 'animals',
  kindSlug: 'foster_request',
  publish: 'plain',
  titleHe: 'מחפשים שמירה על חתול לסוף שבוע',
  details: () => ({ species: 'cat', care_mode: 'pet_sitting', location_mode: 'owner_home' }),
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
