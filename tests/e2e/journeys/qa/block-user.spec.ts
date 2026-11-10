import { test, expect } from '@playwright/test';
import { USER_A } from '../../lib/env';
import { rest, sessionFor } from '../../lib/api';
import { dismissGates } from '../../lib/app';

/** Apple 1.2: a user can block (and unblock) another user from their profile. Non-destructive: ends unblocked. */
const TARGET_EMAIL = process.env.E2E_BLOCK_TARGET_EMAIL ?? 'user3@seed.kc.test';

test('block and unblock a user from the profile menu', async ({ page }) => {
  const { session: target } = await sessionFor({ email: TARGET_EMAIL, password: USER_A.password });
  const [row] = await rest<{ share_handle: string }[]>(
    target.access_token,
    `users?select=share_handle&user_id=eq.${target.user.id}`,
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
