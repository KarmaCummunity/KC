import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { expectNoRawI18nKeys, gotoApp, trackApiErrors } from '../../lib/app';
import { cleanupE2eContent, rest, runTag, sessionFor } from '../../lib/api';
import { STORAGE_B, USER_A } from '../../lib/env';

async function anyOpenItemListing(): Promise<{ listing_id: string; title: string }> {
  const { session } = await sessionFor(USER_A);
  const me = (session.user as { id: string }).id;
  const [row] = await rest<{ listing_id: string; title: string }[]>(
    session.access_token as string,
    `marketplace_listing_card?select=listing_id,title&world_slug=eq.items&owner_id=neq.${me}&limit=1`,
  );
  if (!row) throw new Error('no items listings on kc-dev');
  return row;
}

/**
 * Fills the unified create form for a food offer (FR-POST-001 AC6): the food category, offer,
 * title, food type, expiry (date sheet → web `datetime-local` input) and city.
 */
async function fillFoodOfferForm(page: Page, title: string) {
  await gotoApp(page, '/create?category=food');
  await page.getByTestId('create-direction-give').click();
  await page.getByTestId('listing-title').fill(title);
  await page.getByText('מבושל', { exact: true }).first().click();
  await page.getByTestId('listing-date-expires_at').click();
  await page.locator('input[type="datetime-local"]').fill('2030-01-01T12:00');
  await page.getByTestId('listing-date-expires_at-done').click();
  await page.getByRole('button', { name: 'בחר עיר' }).click();
  await page.getByPlaceholder('...חיפוש עיר').fill('לוד');
  await page.getByText('לוד', { exact: true }).first().click();
}

const publishButton = (page: Page) => page.getByTestId('listing-publish');
const addPhotoButton = (page: Page) => page.getByRole('button', { name: 'הוסיפו תמונה' }).first();

test('browse: the removed marketplace URL lands on the donations hub', async ({ page }) => {
  const errors = trackApiErrors(page);
  await gotoApp(page, '/donations/marketplace');
  await expect(page).toHaveURL(/\/donations\/?$/, { timeout: 15_000 });
  await expect(page.getByTestId('donation-tile-items')).toBeVisible();
  await page.waitForLoadState('networkidle');
  // World tiles must be human labels, not slugs like "items" / "ride_offer".
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\b(?:ride_offer|ride_request|app_design)\b/);
  expect(body).not.toMatch(/·\s*(?:give|request)\s*·/);
  await expectNoRawI18nKeys(page);
  expect(errors).toEqual([]);
});

test('search: the donations hub no longer offers a marketplace entry', async ({ page }) => {
  await gotoApp(page, '/donations');
  await expect(page.getByTestId('donation-tile-items')).toBeVisible();
  await expect(page.getByTestId('donation-tile-marketplace')).toHaveCount(0);
  await expect(page.getByText('שוק התרומות', { exact: true })).toHaveCount(0);
});

test('listing detail opens for an existing listing', async ({ page }) => {
  const errors = trackApiErrors(page);
  const target = await anyOpenItemListing();
  await gotoApp(page, `/donations/marketplace/${target.listing_id}`);
  await expect(page.getByText(target.title).first()).toBeVisible();
  await expect(page.getByText('המודעה לא נמצאה.')).toHaveCount(0);
  expect(errors.filter((e) => e.includes('get_marketplace_listing_detail'))).toEqual([]);
});

test('create form: five categories, request / offer, human labels (no raw schema keys)', async ({ page }) => {
  await gotoApp(page, '/create?category=food');
  await expect(page.getByTestId('unified-create-header')).toBeVisible();
  for (const id of ['items', 'rides', 'food', 'housing', 'time']) {
    await expect(page.getByTestId(`create-category-${id}`)).toBeVisible();
  }
  await page.getByTestId('create-direction-give').click();
  await expect(page.getByTestId('listing-field-food_type')).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\b(?:image url|image path|pickup mode|fulfillment mode|owner_approval|fcfs|linked listing id)\b/);
});

test.describe.serial('create + reserve', () => {
  let listingTitle = '';

  test('create a food offer WITHOUT a photo', async ({ page }) => {
    const title = `${runTag()} מגש פסטה ללא תמונה`;
    await fillFoodOfferForm(page, title);
    await publishButton(page).click();
    await expect(page).toHaveURL(/\/donations\/marketplace\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('create a food offer WITH a photo', async ({ page }) => {
    listingTitle = `${runTag()} עוגה עם תמונה`;
    await fillFoodOfferForm(page, listingTitle);
    const chooser = page.waitForEvent('filechooser');
    await addPhotoButton(page).click();
    await (await chooser).setFiles(path.join(HERE, '../../fixtures/item.png'));
    await expect(page.locator('img').last()).toBeVisible();
    await publishButton(page).click();
    await expect(page).toHaveURL(/\/donations\/marketplace\/[0-9a-f-]{36}$/, { timeout: 45_000 });
    await expect(page.getByText(listingTitle).first()).toBeVisible();
  });

  test('another user claims the food', async ({ browser }) => {
    test.skip(!listingTitle, 'create-with-photo did not run');
    const { session } = await sessionFor(USER_A);
    const [row] = await rest<{ listing_id: string }[]>(
      session.access_token as string,
      `marketplace_listing_card?select=listing_id&title=eq.${encodeURIComponent(listingTitle)}`,
    );
    test.skip(!row, 'listing was not created');
    const ctx = await browser.newContext({ storageState: STORAGE_B, locale: 'he-IL' });
    const page = await ctx.newPage();
    await gotoApp(page, `/donations/marketplace/${row!.listing_id}`);
    const claim = page.getByTestId('giving-handoff-claim').or(page.getByTestId('giving-handoff-reserve')).first();
    await claim.click();
    await expect(claim).toHaveCount(0, { timeout: 20_000 });
    await ctx.close();
  });
});

test.afterAll(async () => {
  await cleanupE2eContent(USER_A);
});
