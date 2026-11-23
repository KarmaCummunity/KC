import { test as setup, expect, type Page } from '@playwright/test';
import { BASE_URL, STORAGE_A, STORAGE_B, USER_A, USER_B } from '../lib/env';
import { cleanupE2eContent, rest, sessionFor } from '../lib/api';
import { dismissGates } from '../lib/app';
import { decidePostCreateBudget } from '../lib/postCreateBudget.mjs';

async function injectAndSave(page: Page, user: { email: string; password: string }, paths: string[]) {
  const { storageKey, session } = await sessionFor(user);
  await page.goto(`${BASE_URL}/`);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey,
    value: session,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await dismissGates(page);
  const feed = page.getByTestId('feed-screen');
  if (!(await feed.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await page.getByRole('tab', { name: 'בית' }).click().catch(() => {});
  }
  await expect(feed).toBeVisible({ timeout: 45_000 });
  for (const p of paths) await page.context().storageState({ path: p });
}

setup('session: seeded user A', async ({ page }) => {
  await injectAndSave(page, USER_A, [STORAGE_A, '.auth/user.json']);
});

setup('session: seeded user B', async ({ page }) => {
  await injectAndSave(page, USER_B, [STORAGE_B]);
});

// A run that crashed before its afterAll leaves its e2e posts open; enough of them hit the
// open-post cap and every later create fails with post_limit_exceeded (E2E 43641093178).
setup('clean up e2e posts left by earlier runs', async () => {
  for (const user of [USER_A, USER_B]) {
    const removed = await cleanupE2eContent(user);
    if (removed) console.log(`removed ${removed} leftover e2e post(s) of ${user.email}`);
  }
});

/**
 * Fail at the start when user A's hourly `post_create` window cannot cover one full suite
 * (#2444). Counts the member's own rows created in the last hour (owner SELECT sees every
 * status, including deleted). That over-counts slightly right after a window rolls over, which
 * is the safe direction: better a clear preflight stop than a bare `rate_limited` mid-run.
 */
setup('post_create budget: user A can cover one full suite', async () => {
  const { session } = await sessionFor(USER_A);
  const token = session.access_token as string;
  const me = (session.user as { id: string }).id;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await rest<{ id: string }[]>(
    token,
    `posts?select=id&owner_id=eq.${me}&created_at=gte.${encodeURIComponent(since)}&limit=100`,
  );
  const decision = decidePostCreateBudget({ used: rows.length, email: USER_A.email });
  if (!decision.ok) throw new Error(decision.message);
  console.log(`post_create budget for ${USER_A.email}: ${decision.remaining} left in the hour`);
});
