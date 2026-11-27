import { test, expect, type Page } from '@playwright/test';
import { USER_A, USER_B } from '../../lib/env';
import { rest, runTag, sessionFor } from '../../lib/api';
import { gotoApp, trackApiErrors } from '../../lib/app';
import { publishPostAs } from '../../lib/publish';

/**
 * FR-MOD-001 (#2061): a member reports content from its menu, end to end, on kc-dev.
 *
 * The launch bug was a report that spun, then showed a generic error and saved nothing
 * (App Store Guideline 1.2 needs a working UGC report). These journeys prove both halves:
 * the sheet ends on its success notice, and the row exists in `public.reports`.
 *
 * Data left on kc-dev: one open report by user A per run on a fresh `[e2e …]` post of user B
 * (the post is deleted afterwards), and at most one open report by A on user B (one open
 * report per reporter and target, `reports_open_per_reporter_key`). Reports are resolved only
 * by staff, so nothing here can raise a false-report sanction unless someone dismisses them.
 */

/** Success notice title shared by the post, listing and user report sheets (he locale). */
const SUCCESS_TITLE = 'הדיווח נשלח';
/** "Already reported" title: the answer to a repeat user report while the first one is open. */
const DUPLICATE_TITLE = 'כבר דיווחת';

/** Open reports user A filed on one target, read through `reports_select_own`. */
async function openReportsByA(targetType: 'post' | 'user', targetId: string): Promise<{ reason: string }[]> {
  const { session } = await sessionFor(USER_A);
  return rest<{ reason: string }[]>(
    session.access_token as string,
    `reports?select=reason&status=eq.open&target_type=eq.${targetType}&target_id=eq.${targetId}`,
  );
}

/** Picks "Spam" in the open report sheet and sends it. */
async function sendSpamReport(page: Page) {
  await page.getByRole('radio', { name: 'ספאם', exact: true }).click();
  await page.getByRole('button', { name: 'שלחו דיווח', exact: true }).click();
}

/** Failed calls to the reports table: the generic-error path the bug went down. */
const reportFailures = (errors: string[]) => errors.filter((e) => e.includes('/rest/v1/reports'));

test('report a listing from the post menu saves the report', async ({ page }) => {
  test.setTimeout(150_000);
  // A fresh post each run: an open report blocks a second one on the same target, and the
  // reporter's own hide (FR-MOD-001 AC5) would then remove it from A's views anyway.
  const target = await publishPostAs(USER_B, {
    world: 'items',
    kindSlug: 'item_offer',
    title: `${runTag()} כיסא לבדיקת דיווח`,
    publish: 'plain',
    details: () => ({}),
  });
  const errors = trackApiErrors(page);

  try {
    await gotoApp(page, `/post/${target.id}`);
    await expect(page.getByText(target.title).first()).toBeVisible({ timeout: 45_000 });

    // The header ⋮ menu; its report row reads "report listing" on a listing, "report" otherwise.
    await page.getByRole('button', { name: 'תפריט פעולות', exact: true }).first().click();
    await page.getByRole('button', { name: /^(דיווח על מודעה|דווחו)$/ }).first().click();
    await sendSpamReport(page);

    await expect(page.getByText(SUCCESS_TITLE, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await openReportsByA('post', target.id)).map((r) => r.reason), { timeout: 30_000 })
      .toEqual(['Spam']);
    expect(reportFailures(errors)).toEqual([]);
  } finally {
    // Keep B's feed and open-post cap clean; a failed delete must not hide the real result.
    const { session } = await sessionFor(USER_B);
    await rest(session.access_token as string, 'rpc/delete_post', {
      method: 'POST',
      body: { p_post_id: target.id },
    }).catch(() => undefined);
  }
});

test('report a user from the profile menu never ends on a generic error', async ({ page }) => {
  const { session: b } = await sessionFor(USER_B);
  const targetId = (b.user as { id: string }).id;
  const [row] = await rest<{ share_handle: string }[]>(
    b.access_token as string,
    `users?select=share_handle&id=eq.${targetId}`,
  );
  expect(row?.share_handle).toBeTruthy();
  const errors = trackApiErrors(page);

  await gotoApp(page, `/user/${row!.share_handle}`);
  // The overflow trigger and its report row share one label; the row is the later one.
  const reportUser = page.getByRole('button', { name: 'דווחו על משתמש', exact: true });
  await reportUser.first().click();
  await expect(reportUser).toHaveCount(2);
  await reportUser.last().click();
  await sendSpamReport(page);

  // The first run saves; later runs meet A's still-open report and get the duplicate notice.
  // Either way the outcome is a mapped notice and an open report exists, never the generic error.
  const outcome = page
    .getByText(SUCCESS_TITLE, { exact: true })
    .or(page.getByText(DUPLICATE_TITLE, { exact: true }));
  await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await openReportsByA('user', targetId)).length, { timeout: 30_000 }).toBe(1);
  expect(reportFailures(errors).filter((e) => !e.includes('23505'))).toEqual([]);
});
