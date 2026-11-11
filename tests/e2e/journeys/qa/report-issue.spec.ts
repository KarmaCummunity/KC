import { test, expect } from '@playwright/test';
import { USER_A } from '../../lib/env';
import { rest, runTag, sessionFor } from '../../lib/api';
import { gotoApp } from '../../lib/app';

/**
 * FR-MOD-002 (#2096): report a problem from Settings, end to end. A too-short description keeps
 * Send disabled; a valid report opens the support thread, shows the report there and is stored
 * as a message in that thread. Leaves one tagged report in user A's support thread on kc-dev.
 */
test('report a problem opens the support thread with the report', async ({ page }) => {
  const description = `${runTag()} report-a-problem journey check`;

  await gotoApp(page, '/settings/report-issue');
  await expect(page.getByTestId('report-issue-screen')).toBeVisible({ timeout: 30_000 });

  const field = page.getByTestId('report-issue-description');
  const submit = page.getByTestId('report-issue-submit');
  await field.fill('too short');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('report-issue-category-Bug').click();
  await field.fill(description);
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await submit.click();

  // The screen is replaced by the support thread, which shows the report.
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByText(description).first()).toBeVisible({ timeout: 30_000 });

  // The report is stored once, as a message of that thread (readable by its participant).
  const chatId = page.url().match(/\/chat\/([0-9a-f-]{36})/)![1];
  const { session } = await sessionFor(USER_A);
  const rows = await rest<{ message_id: string }[]>(
    session.access_token,
    `messages?select=message_id&chat_id=eq.${chatId}&body=eq.${encodeURIComponent(`[Bug] ${description}`)}`,
  );
  expect(rows).toHaveLength(1);
});
