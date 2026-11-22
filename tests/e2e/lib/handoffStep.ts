/**
 * The steps of a handoff on the listing page, as the two-user world journeys take them
 * (`worldJourney.ts`): open the page as a member, press an action, and read the outcome from the
 * server and from the page.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { gotoApp, trackApiErrors } from './app';
import { rest, sessionFor } from './api';

interface HandoffRow {
  id: string;
  status: 'reserved' | 'confirmed' | 'handed_over' | 'cancelled' | 'no_show';
  owner_id: string;
  recipient_id: string;
}

type Credentials = { email: string; password: string };

/** `givingHandoff.statusLabel.*` (he) — what the listing page prints after each step. */
const STATUS_LABEL_HE = { reserved: 'משוריין', confirmed: 'אושר', handed_over: 'נמסר' } as const;

export async function tokenFor(user: Credentials): Promise<{ token: string; userId: string }> {
  const { session } = await sessionFor(user);
  return { token: session.access_token as string, userId: (session.user as { id: string }).id };
}

/** The handoff row as `user` sees it (participant-only RLS); `null` when none exists. */
async function handoffAs(user: Credentials, postId: string): Promise<HandoffRow | null> {
  const { token } = await tokenFor(user);
  const [row] = await rest<HandoffRow[]>(token, `post_handoffs?select=id,status,owner_id,recipient_id&post_id=eq.${postId}&order=created_at.desc&limit=1`);
  return row ?? null;
}

/** What the app told the member while they acted: native alerts and failed Supabase calls. */
export interface PageTrouble {
  readonly alerts: string[];
  readonly apiErrors: string[];
}

/**
 * Accepts every native alert (the rating step thanks the user with one) and keeps its text. The
 * app reports a refused or failed action in an alert, so dropping the text hid why a step failed.
 */
export function watchTrouble(page: Page): PageTrouble {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.accept();
  });
  return { alerts, apiErrors: trackApiErrors(page) };
}

export async function openAs(browser: Browser, storageState: string): Promise<{ ctx: BrowserContext; page: Page; trouble: PageTrouble }> {
  const ctx = await browser.newContext({ storageState, locale: 'he-IL' });
  const page = await ctx.newPage();
  return { ctx, page, trouble: watchTrouble(page) };
}

/** A handoff button by testID, or by its Hebrew label on a deployment without the testIDs. */
export function action(page: Page, testId: string, label: string) {
  return page.getByTestId(testId).or(page.getByText(label, { exact: true })).first();
}

export function handoffStatus(page: Page) {
  return page.getByTestId('giving-handoff-status').or(page.getByText(/^סטטוס: /)).first();
}

/** A server-side failure (5xx, or a statement the database cancelled): the write may never have landed. */
const isTransient = (apiError: string) => /^5\d\d /.test(apiError) || apiError.includes('57014');

/** The step a member takes on the listing page, and where the suite reads its outcome. */
export interface HandoffStep {
  readonly page: Page;
  readonly path: string;
  readonly trouble: PageTrouble;
  /** The member who acts; the handoff row is read as them, through RLS. */
  readonly user: Credentials;
  readonly postId: string;
  /** The button of the action, located anew for every click. */
  readonly button: () => Locator;
  /** The status the action must produce. */
  readonly status: keyof typeof STATUS_LABEL_HE;
}

/**
 * Clicks a handoff action, then waits for the server row (read as the member, through RLS) to
 * reach the status, and for the listing page to show it.
 *
 * - A busy kc-dev can fail the write with a 5xx. The member would press again, so the step
 *   presses once more, and only when the app reported such a failure: the RPCs refuse a second
 *   application, and an action the server refused (4xx) still fails the step.
 * - The action's own refetch can lag behind the write, so the page gets one reload instead of a
 *   longer blind wait.
 * - A failure carries what the app reported, so the report names the refused or failed call.
 */
export async function takeHandoffStep(step: HandoffStep): Promise<HandoffRow> {
  const { page, path, trouble, user, postId, status } = step;
  const reached = (timeout: number) =>
    expect
      .poll(async () => (await handoffAs(user, postId))?.status ?? 'no handoff row', {
        timeout,
        message: `handoff on ${postId} reaches '${status}' on the server`,
      })
      .toBe(status);
  const label = STATUS_LABEL_HE[status];
  try {
    await step.button().click();
    try {
      await reached(30_000);
    } catch (firstFailure) {
      if (!trouble.apiErrors.some(isTransient)) throw firstFailure;
      await gotoApp(page, path);
      // The first write may have landed after all; then the button is gone and the poll decides.
      await step.button().click({ timeout: 10_000 }).catch(() => undefined);
      await reached(45_000);
    }
    try {
      await expect(handoffStatus(page)).toContainText(label, { timeout: 10_000 });
    } catch {
      await gotoApp(page, path);
      await expect(handoffStatus(page)).toContainText(label, { timeout: 45_000 });
    }
  } catch (failure) {
    const reported = [...trouble.alerts.map((a) => `alert: ${a}`), ...trouble.apiErrors].join('\n  ') || 'nothing';
    throw new Error(`${(failure as Error).message}\nThe app reported:\n  ${reported}`, { cause: failure });
  }
  return (await handoffAs(user, postId))!;
}
