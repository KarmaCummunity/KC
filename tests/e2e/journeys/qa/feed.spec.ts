import { test, expect } from '@playwright/test';
import { gotoApp, trackApiErrors } from '../../lib/app';
import type { Page } from '@playwright/test';

async function pickFromDialog(page: Page, opener: string, query: string) {
  await page.getByRole('button', { name: opener }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill(query);
  await dialog.getByRole('button', { name: new RegExp(query) }).first().click();
  await expect(dialog).toHaveCount(0);
}
import { cleanupE2eContent, rest, runTag, sessionFor } from '../../lib/api';
import { USER_A } from '../../lib/env';

test('feed renders posts with no failed API calls', async ({ page }) => {
  const errors = trackApiErrors(page);
  await gotoApp(page, '/');
  await expect(page.getByTestId('feed-screen')).toBeVisible();
  await expect(page.getByTestId('feed-post-card').first().or(page.getByTestId('feed-empty-state'))).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('create a "request" post (no photo) from the composer', async ({ page }) => {
  const title = `${runTag()} מחפש/ת מדף ספרים`;
  await gotoApp(page, '/create');
  await expect(page.getByTestId('create-post-screen')).toBeVisible();
  await page.getByText('לבקש חפץ', { exact: true }).click();
  await page.getByTestId('create-post-title').fill(title);
  await pickFromDialog(page, 'בחר עיר', 'תל אביב');
  await pickFromDialog(page, 'בחרו רחוב', 'דיזנגוף');
  await page.getByRole('textbox', { name: 'מס׳' }).fill('10');
  await page.getByText('ספרים', { exact: true }).first().click();
  await page.getByText('פרסם', { exact: true }).last().click();
  await expect(page).not.toHaveURL(/\/create$/, { timeout: 30_000 });
  const { session } = await sessionFor(USER_A);
  const rows = await rest<{ post_id: string }[]>(
    session.access_token as string,
    `posts?select=post_id&title=eq.${encodeURIComponent(title)}`,
  );
  expect(rows.length).toBe(1);
});

test('like and comment on a post', async ({ page }) => {
  const { session } = await sessionFor(USER_A);
  const me = (session.user as { id: string }).id;
  const [post] = await rest<{ post_id: string }[]>(
    session.access_token as string,
    `posts?select=post_id&status=eq.open&owner_id=neq.${me}&order=created_at.desc&limit=1`,
  );
  test.skip(!post, 'no open post from another user on kc-dev');
  await gotoApp(page, `/post/${post!.post_id}`);
  await page.getByText('אהבתי', { exact: true }).first().click();
  await expect(page.getByText(/[1-9]\d* רגשות/)).toBeVisible();

  const comment = `${runTag()} תודה רבה!`;
  await page.getByPlaceholder('כתוב תגובה…').fill(comment);
  await page.getByText('פרסם תגובה', { exact: true }).click();
  await expect(page.getByText(comment)).toBeVisible();
});

test.afterAll(async () => {
  await cleanupE2eContent(USER_A);
});
