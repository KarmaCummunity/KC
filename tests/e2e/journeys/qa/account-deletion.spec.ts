import { test, expect } from '@playwright/test';
import { SUPABASE_URL, USER_A, USER_B, USER_D, anonKey } from '../../lib/env';
import { dismissGates } from '../../lib/app';
import { cleanupE2eContent, forgetSession, rest, runTag, sessionFor } from '../../lib/api';
import { publishPostAs } from '../../lib/publish';

/**
 * FR-SETTINGS-012 / FR-AUTH-016 (D108): deactivate from Settings, sign in again to the restore
 * screen, restore, and keep the member's content. Runs as user4 (USER_D) — the seeded spare —
 * and ends with the account restored so the nightly suite can run it every night.
 * Override with E2E_DELETE_ACCOUNT_EMAIL only for a one-off spare; never user1/user2.
 */
const EMAIL = process.env.E2E_DELETE_ACCOUNT_EMAIL ?? USER_D.email;
const PASSWORD = process.env.E2E_DELETE_ACCOUNT_PASSWORD ?? USER_D.password;
/** Seed display name for user4 (`supabase/seed/e2e/load.sql`); override with the spare's name. */
const DISPLAY_NAME = process.env.E2E_DELETE_ACCOUNT_DISPLAY_NAME ?? 'E2E Member 4';

test.describe('account deletion (30-day restore)', () => {
  test.skip(
    EMAIL === USER_A.email || EMAIL === USER_B.email || /^user[12]@/.test(EMAIL),
    'never delete the suite users',
  );
  test.use({ storageState: { cookies: [], origins: [] } });

  const title = `${runTag()} account-deletion keep`;
  let postId = '';

  test.beforeAll(async () => {
    const published = await publishPostAs(
      { email: EMAIL, password: PASSWORD },
      {
        world: 'items',
        kindSlug: 'item_offer',
        title,
        publish: 'plain',
        details: () => ({}),
      },
    );
    postId = published.id;
  });

  test.afterAll(async () => {
    // If the journey left the account pending deletion, restore before cleanup so user4 stays usable.
    forgetSession(EMAIL);
    try {
      const { session } = await sessionFor({ email: EMAIL, password: PASSWORD });
      await rest(session.access_token as string, 'rpc/restore_account', { method: 'POST', body: {} }).catch(
        () => undefined,
      );
    } catch {
      // already active or sign-in failed — cleanup below is best-effort
    }
    forgetSession(EMAIL);
    await cleanupE2eContent({ email: EMAIL, password: PASSWORD });
  });

  test('deletes from Settings, lands on restore after sign-in, restores with content kept', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(EMAIL);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await dismissGates(page);
    await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });

    await page.goto('/settings');
    await page.getByText('מחיקת חשבון', { exact: true }).click();
    await expect(page.getByText('החשבון יושבת ל-30 יום', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'המשך', exact: true }).click();
    // App confirms by typing the display name (FR-SETTINGS-012 AC1); out of scope if that drifts.
    await page.getByPlaceholder('שם התצוגה שלך').fill(DISPLAY_NAME);
    await page.getByRole('button', { name: 'מחיקת החשבון', exact: true }).click();
    await expect(page.getByText('חשבונך נמחק')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/sign-in|auth/, { timeout: 30_000 });

    // Replaces the pre-D108 assertion that sign-in failed with 400 ("auth user is gone"):
    // the identity stays, so password grant succeeds and the app offers restore.
    forgetSession(EMAIL);
    const key = await anonKey();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status, 'D108: identity stays during the grace period').toBe(200);

    await page.evaluate(() => localStorage.clear());
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(EMAIL);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();

    await expect(page).toHaveURL(/restore-account/, { timeout: 30_000 });
    await expect(page.getByText('החשבון שלך מושבת')).toBeVisible();
    // Purge date is interpolated into the restore body (FR-AUTH-016 AC2).
    await expect(page.getByText(/אפשר לשחזר אותו במלואו עד .+\./)).toBeVisible();

    await page.getByRole('button', { name: 'לשחזר את החשבון', exact: true }).click();
    await expect(page).not.toHaveURL(/restore-account/, { timeout: 30_000 });

    const feed = page.getByTestId('feed-screen');
    if (!(await feed.isVisible({ timeout: 8_000 }).catch(() => false))) {
      await page.getByRole('tab', { name: 'בית' }).click().catch(() => {});
    }
    await expect(feed).toBeVisible({ timeout: 30_000 });

    forgetSession(EMAIL);
    const { session } = await sessionFor({ email: EMAIL, password: PASSWORD });
    const rows = await rest<{ id: string; status: string; title: string }[]>(
      session.access_token as string,
      `posts?select=id,status,title&id=eq.${postId}`,
    );
    expect(rows).toEqual([{ id: postId, status: 'open', title }]);

    await page.goto(`/post/${postId}`);
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });
  });
});
