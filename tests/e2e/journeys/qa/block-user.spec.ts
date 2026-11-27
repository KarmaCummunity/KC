import { test, expect } from '@playwright/test';
import { USER_A, USER_C } from '../../lib/env';
import { rest, runTag, sessionFor } from '../../lib/api';
import { dismissGates, gotoApp } from '../../lib/app';
import { publishPostAs } from '../../lib/publish';

/** Apple 1.2: a user can block (and unblock) another user from their profile. Non-destructive: ends unblocked. */
const TARGET_EMAIL = process.env.E2E_BLOCK_TARGET_EMAIL ?? 'user3@seed.kc.test';

test('block and unblock a user from the profile menu', async ({ page }) => {
  const { session: target } = await sessionFor({ email: TARGET_EMAIL, password: USER_A.password });
  const [row] = await rest<{ share_handle: string }[]>(
    target.access_token,
    `users?select=share_handle&id=eq.${target.user.id}`,
  );
  expect(row?.share_handle).toBeTruthy();

  page.on('dialog', (d) => void d.accept());
  await page.goto(`/user/${row!.share_handle}`);
  await dismissGates(page);

  const toggle = page.getByTestId('profile-block-toggle');
  const openMenu = () => page.getByRole('button', { name: 'דווחו על משתמש' }).first().click();

  await openMenu();
  await expect(toggle).toHaveText('חסימת משתמש');
  await toggle.click();
  await openMenu();
  await expect(toggle).toHaveText('ביטול חסימה', { timeout: 15_000 });
  await toggle.click();
  await openMenu();
  await expect(toggle).toHaveText('חסימת משתמש', { timeout: 15_000 });
});

/**
 * FR-MOD-003 / FR-MOD-004 (#2062): the reported failure was a block from a feed post's ⋮ menu
 * that showed no confirmation and saved nothing. User A blocks user C from C's fresh post:
 * the block is stored, C's post disappears for A (the server hides content across a block),
 * and the unblock from Settings → Blocked Users removes the row and brings the post back.
 * Ends unblocked even on failure, and C's post is deleted, so nightly runs repeat cleanly.
 */
test('block from a post menu hides the content; unblock from Blocked Users restores it', async ({ page }) => {
  test.setTimeout(150_000);
  const { session: a } = await sessionFor(USER_A);
  const aToken = a.access_token as string;
  const aId = (a.user as { id: string }).id;
  const { session: c } = await sessionFor(USER_C);
  const cId = (c.user as { id: string }).id;
  const blockPath = `blocks?blocker_id=eq.${aId}&blocked_id=eq.${cId}`;
  const blockRows = async () => (await rest<unknown[]>(aToken, `${blockPath}&select=blocked_id`)).length;
  // The post as A sees it through RLS: gone while a block stands between A and C.
  const visibleToA = async (postId: string) =>
    (await rest<unknown[]>(aToken, `posts?select=id&id=eq.${postId}`)).length;

  // Start unblocked: a run that died between block and unblock must not poison this one.
  await rest(aToken, blockPath, { method: 'DELETE' });
  const post = await publishPostAs(USER_C, {
    world: 'items',
    kindSlug: 'item_offer',
    title: `${runTag()} מנורה לבדיקת חסימה`,
    publish: 'plain',
    details: () => ({}),
  });
  // Web confirms (block, unblock) are window.confirm; their outcome toasts are window.alert.
  page.on('dialog', (d) => void d.accept());

  try {
    await gotoApp(page, `/post/${post.id}`);
    await expect(page.getByText(post.title).first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'תפריט פעולות', exact: true }).first().click();
    await page.getByTestId('post-menu-block-owner').click();

    await expect.poll(blockRows, { timeout: 30_000, message: 'A → C block row is stored' }).toBe(1);
    expect(await visibleToA(post.id)).toBe(0);

    await gotoApp(page, '/settings/blocked-users');
    const row = page.getByTestId(`blocked-user-row-${cId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`blocked-user-unblock-${cId}`).click();

    await expect(row).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(blockRows, { timeout: 30_000, message: 'A → C block row is removed' }).toBe(0);
    expect(await visibleToA(post.id)).toBe(1);
  } finally {
    // Never leave A blocking C (other journeys use both), and keep C's feed clean.
    await rest(aToken, blockPath, { method: 'DELETE' }).catch(() => undefined);
    await rest(c.access_token as string, 'rpc/delete_post', {
      method: 'POST',
      body: { p_post_id: post.id },
    }).catch(() => undefined);
  }
});
