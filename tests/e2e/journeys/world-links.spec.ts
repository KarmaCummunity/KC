// FR-FEED-020 AC2 — links and knowledge of a giving world: the feed of a world ends with a short
// list of its links and a button to the world's "links and knowledge" screen; a link-only world
// (medical) lists the organizations it works through. The content comes from the content seed
// (supabase/seed/content): community links, `external_bodies`, `world_links`, `knowledge_topics`.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp, trackApiErrors } from '../lib/app';

/** The footer sits under a virtualized feed: scroll until the list has rendered it. */
async function scrollUntilVisible(page: Page, target: Locator): Promise<void> {
  for (let step = 0; step < 15; step += 1) {
    if (await target.isVisible().catch(() => false)) break;
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(300);
  }
  await target.scrollIntoViewIfNeeded();
}

test('a world feed ends with its links, and the button opens the links and knowledge screen', async ({ page }) => {
  const apiErrors = trackApiErrors(page);
  await gotoApp(page, '/donations/food');

  // End of the feed: the short list and the button.
  const preview = page.getByTestId('world-links-preview');
  await page.getByTestId('world-feed-list').hover();
  await scrollUntilVisible(page, preview);
  await expect(preview).toBeVisible();
  await expect(preview.getByText('קישורים וידע', { exact: true })).toBeVisible();
  const rows = preview.getByTestId('world-links-preview-row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(3);

  // The dedicated screen: the full community list, right to left.
  await preview.getByTestId('world-links-open-all').click();
  await expect(page).toHaveURL(/\/donations\/food\/links/);
  const screen = page.getByTestId('world-links-screen-food');
  await expect(screen).toBeVisible();
  await expect(screen.getByText('עמותות וקישורים')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectNoRawI18nKeys(page);
  expect(apiErrors).toEqual([]);
});

test('the knowledge world lists its knowledge topics on the links and knowledge screen', async ({ page }) => {
  const apiErrors = trackApiErrors(page);
  await gotoApp(page, '/donations/knowledge/links');
  const topics = page.getByTestId('world-content-topics');
  await expect(topics).toBeVisible();
  await expect(topics.getByText('נושאי ידע')).toBeVisible();
  await expect(topics.getByTestId('world-content-topic-programming')).toBeVisible();
  expect(apiErrors).toEqual([]);
});

test('a link-only world lists the organizations it works through', async ({ page }) => {
  const apiErrors = trackApiErrors(page);
  await gotoApp(page, '/donations/category/medical');
  const bodies = page.getByTestId('world-content-bodies');
  await expect(bodies).toBeVisible();
  await expect(bodies.getByTestId('world-content-body-mda')).toContainText('מגן דוד אדום');
  // The medical world also points to the rides world ("medical ride").
  await expect(page.getByTestId('world-content-link-medical_ride')).toBeVisible();
  expect(apiErrors).toEqual([]);
});

// The items world has no community list: its screen is the curated content alone. (The empty
// state of a world with nothing at all is covered by the component's unit test.)
test('a world without a community list shows its related worlds, which open that world', async ({ page }) => {
  await gotoApp(page, '/donations/items/links');
  await expect(page.getByTestId('world-links-screen-items')).toBeVisible();
  await expect(page.getByTestId('world-content-empty')).toHaveCount(0);
  await page.getByTestId('world-content-link-needs_transport').click();
  await expect(page).toHaveURL(/\/donations\/rides/);
});
