// Matching — "Matches for you" on kc-dev (`my_matches`, production baseline).
import { test, expect } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp, trackApiErrors } from '../../lib/app';
import { rest, sessionFor } from '../../lib/api';
import { USER_A } from '../../lib/env';

type MatchRow = { match_id: string; my_post_id: string; other_post: { id: string } | null; score: number };

test('api: my_matches returns only my pairs; internals are not client-callable', async () => {
  const { session } = await sessionFor(USER_A);
  const token = session.access_token as string;
  const rows = await rest<MatchRow[]>(token, 'rpc/my_matches', { method: 'POST', body: { p_limit: 20 } });
  expect(Array.isArray(rows)).toBe(true);
  for (const r of rows) {
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.my_post_id).not.toEqual(r.other_post?.id);
  }
  await expect(
    rest(token, 'rpc/match_run_sweep', { method: 'POST', body: { p_batch: 1 } }),
  ).rejects.toThrow(/^(401|403|404)/);
  await expect(
    rest(token, 'rpc/api_match_llm_pending', { method: 'POST', body: { p_limit: 1 } }),
  ).rejects.toThrow(/^(401|403|404)/);
});

test('ui: /matches renders the list or the empty state without API errors', async ({ page }) => {
  const errors = trackApiErrors(page);
  await gotoApp(page, '/matches');
  await expect(page.getByTestId('matches-screen')).toBeVisible();
  const cards = page.locator('[data-testid^="match-card-"]');
  // The list loads after auth hydration — wait for either outcome instead of sampling once.
  await expect(cards.first().or(page.getByTestId('matches-empty'))).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoRawI18nKeys(page);
  expect(errors).toEqual([]);
});
