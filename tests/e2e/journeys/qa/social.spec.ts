import { test, expect } from '@playwright/test';
import { gotoApp, expectNoRawI18nKeys, trackApiErrors } from '../../lib/app';
import { rest, runTag, sessionFor } from '../../lib/api';
import { STORAGE_B, USER_A, USER_B } from '../../lib/env';

test('chat: user A messages the owner of a post, user B sees it', async ({ page, browser }) => {
  const b = await sessionFor(USER_B);
  const bId = (b.session.user as { id: string }).id;
  const [post] = await rest<{ post_id: string }[]>(
    b.session.access_token as string,
    `posts?select=post_id&owner_id=eq.${bId}&status=eq.open&limit=1`,
  );
  test.skip(!post, 'user B has no open post on kc-dev');
  const text = `${runTag()} היי, זה עדיין זמין?`;
  await gotoApp(page, `/post/${post!.post_id}`);
  await page.getByText('שלח הודעה למפרסם').first().click();
  await expect(page).toHaveURL(/\/chat\//, { timeout: 20_000 });
  const input = page.getByPlaceholder('כתוב הודעה...');
  await input.fill(text);
  const send = page
    .getByTestId('chat-send')
    .or(page.locator('[aria-label="צרף תמונה"] + *'));
  await send.first().click();
  await expect(input).toHaveValue('');
  await expect(page.getByText(text)).toBeVisible();
  const chatPath = new URL(page.url()).pathname;

  const ctx = await browser.newContext({ storageState: STORAGE_B, locale: 'he-IL' });
  const pb = await ctx.newPage();
  await gotoApp(pb, '/chat');
  await expect(pb.getByTestId('chat-inbox-screen')).toBeVisible();
  await gotoApp(pb, chatPath);
  await expect(pb.getByText(text).first()).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test('notifications inbox renders', async ({ page }) => {
  const errors = trackApiErrors(page);
  await gotoApp(page, '/notifications/inbox');
  await expect(page.getByText('מרכז התראות')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('donations hub shows every giving world with translated titles', async ({ page }) => {
  const errors = trackApiErrors(page);
  await gotoApp(page, '/donations');
  for (const id of ['items', 'marketplace', 'time', 'money', 'food', 'rides', 'knowledge']) {
    await expect(page.getByTestId(`donation-tile-${id}`)).toBeVisible();
  }
  await page.waitForLoadState('networkidle');
  await expectNoRawI18nKeys(page);
  expect(errors).toEqual([]);
});

test('money world: an active hub lists verified nonprofits, a portal shows links (D60)', async ({ page }) => {
  const a = await sessionFor(USER_A);
  const [flag] = await rest<{ enabled: boolean }[]>(
    a.session.access_token as string,
    'app_flags?select=enabled&key=eq.world_money_enabled',
  );
  await gotoApp(page, '/donations/money');
  if (flag?.enabled) {
    await expect(page.getByText('עמותות מאומתות')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('אין עמותות מאומתות ברשימה עדיין.')).toHaveCount(0);
  } else {
    // Launch flag off: the world is shown as a portal (links + knowledge), never hidden.
    await expect(page.getByTestId('world-portal')).toBeVisible();
  }
});

test('he is RTL; switching to English flips to LTR', async ({ page }) => {
  await gotoApp(page, '/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await gotoApp(page, '/settings/language');
  await page.getByText('English', { exact: true }).click();
  await page.waitForLoadState('networkidle');
  await gotoApp(page, '/donations');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', { timeout: 20_000 });
  await expect(page.getByText('Donations').first()).toBeVisible();
  await expectNoRawI18nKeys(page);
  // restore Hebrew for the rest of the suite
  await gotoApp(page, '/settings/language');
  await page.getByText('עברית', { exact: true }).click();
  await page.waitForLoadState('networkidle');
});
