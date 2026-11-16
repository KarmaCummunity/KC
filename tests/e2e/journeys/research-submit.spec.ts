// FR-RESEARCH-001..003 — the public market-research form, end to end, as a visitor without an
// account: open the shared link, rate all 11 questions, send, land on the thank-you page.
// The answers table is readable by no client role, so "stored" is proven at the gateway: the
// `public-research-submit` function answers 200 with the id of the inserted row, for a request
// whose honeypot is empty (a filled honeypot is the only path that returns an id without a row).
// Needs the content seed on kc-dev (the survey `alt-platforms-research`, 11 questions).
import { test, expect, type Page, type Request } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp, trackApiErrors } from '../lib/app';

// A shared link is opened by people who are not signed in (FR-RESEARCH-001 AC2).
test.use({ storageState: { cookies: [], origins: [] } });

const SURVEY_SLUG = 'alt-platforms-research';
/** Campaign tag of the rows this journey writes (`source` column); FR-RESEARCH-001 AC4. */
const SOURCE = 'e2e-journey';
const SURVEY_PATH = `/research/${SURVEY_SLUG}?src=${SOURCE}`;
const QUESTION_COUNT = 11;
const SUBMIT_URL = /\/functions\/v1\/public-research-submit$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the page posts to the gateway (see `SupabasePublicResearchRepository`). */
type SubmitBody = {
  slug: string;
  source?: string;
  honeypot: string;
  answers: Record<string, { rating: number; answer_text: string | null }>;
};

const progress = (page: Page, current: number) =>
  page.getByText(`שאלה ${current} מתוך ${QUESTION_COUNT}`, { exact: true });
const rating = (page: Page, value: number) => page.getByRole('button', { name: `דירוג ${value}`, exact: true });
const nextButton = (page: Page) => page.getByRole('button', { name: 'שאלה הבאה' });

test('a visitor without an account answers the survey and the response is stored', async ({ page }) => {
  const apiErrors = trackApiErrors(page);
  await gotoApp(page, SURVEY_PATH);

  // The link stays on the form: no redirect to sign-in for a signed-out visitor.
  await expect(progress(page, 1)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/research/${SURVEY_SLUG}`);
  await expectNoRawI18nKeys(page);

  // "Next" stays disabled until the question is rated (the rating is the required part).
  await expect(nextButton(page)).toBeDisabled();

  let submitRequest: Request | undefined;
  page.on('request', (request) => {
    if (SUBMIT_URL.test(request.url()) && request.method() === 'POST') submitRequest = request;
  });

  for (let question = 1; question <= QUESTION_COUNT; question += 1) {
    await expect(progress(page, question)).toBeVisible();
    // A different rating per question, so a swapped or dropped answer shows in the payload.
    await rating(page, ((question - 1) % 7) + 1).click();
    if (question === 1) {
      await page.getByRole('textbox').first().fill('[e2e] automated journey answer');
    }
    if (question < QUESTION_COUNT) await nextButton(page).click();
  }

  // The last question turns "Next" into the send button.
  const submitResponse = page.waitForResponse((r) => SUBMIT_URL.test(r.url()) && r.request().method() === 'POST');
  await nextButton(page).click();
  const response = await submitResponse;

  expect(response.status(), await response.text()).toBe(200);
  expect(((await response.json()) as { responseId: string }).responseId).toMatch(UUID);

  const sent = submitRequest?.postDataJSON() as SubmitBody;
  expect(sent.slug).toBe(SURVEY_SLUG);
  expect(sent.source).toBe(SOURCE);
  expect(sent.honeypot).toBe('');
  const ratings = Object.values(sent.answers).map((answer) => answer.rating);
  expect(ratings.sort((a, b) => a - b)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7]);

  // FR-RESEARCH-001 AC5: the visitor lands on the thank-you page.
  await expect(page).toHaveURL(/\/research\/thanks$/);
  await expect(page.getByText('תודה. ברצינות.')).toBeVisible();
  expect(apiErrors, 'failed Supabase calls during the journey').toEqual([]);

  // FR-RESEARCH-001 AC7: a sent survey leaves no draft behind, so the form starts clean again.
  await gotoApp(page, SURVEY_PATH);
  await expect(progress(page, 1)).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();
});

test('answers given so far survive a reload of the form', async ({ page }) => {
  await gotoApp(page, SURVEY_PATH);
  await expect(progress(page, 1)).toBeVisible();

  await rating(page, 5).click();
  await nextButton(page).click();
  await expect(progress(page, 2)).toBeVisible();
  await rating(page, 2).click();

  // FR-RESEARCH-001 AC7: the draft (answers and the open question) is restored after a reload.
  await page.reload();
  await expect(progress(page, 2)).toBeVisible();
  await expect(nextButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'שאלה קודמת' }).click();
  await expect(progress(page, 1)).toBeVisible();
  await expect(nextButton(page)).toBeEnabled();
});
