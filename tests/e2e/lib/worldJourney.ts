/**
 * Two-user giving journey per active world (G40, docs/architecture/target.md §5.1).
 *
 * One journey shape, one fixture per world: user A publishes a listing the same
 * way the create form does (the `create_marketplace_listing` RPC, so the test is
 * not coupled to form widgets), user B claims it from the listing page, A
 * confirms, A hands it over (listing closes, karma is written), B rates. UI steps
 * run in the browser as each user; every state change is re-read through the
 * REST API as the acting user, so RLS is exercised as in the app.
 *
 * Locators prefer the stable testIDs shipped with this suite and fall back to
 * the Hebrew labels, so the journey also runs against a dev deployment that
 * predates the testIDs.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { gotoApp } from './app';
import { cleanupE2eContent, rest, runTag, sessionFor } from './api';
import { STORAGE_B, USER_A, USER_B } from './env';

export interface WorldJourney {
  /** Marketplace world slug — the fixture that plugs a world into this journey. */
  readonly world: 'items' | 'food';
  /** `listing_kinds.slug` of the "give" kind the listing is published under. */
  readonly kindSlug: string;
  /** Hebrew title stem; the run tag is prepended so cleanup can find the row. */
  readonly titleHe: string;
  /**
   * The recipient's first action on the listing page: testID + Hebrew label fallback, and
   * the handoff status it produces — items reserve and wait for the owner (`reserved`),
   * the food quick claim is confirmed at once (`confirmed`, 0383; no owner approval step).
   */
  readonly claim: { readonly testId: string; readonly label: string; readonly resultsIn: 'reserved' | 'confirmed' };
  /** Kind-specific details the create form would collect (e.g. food expiry). */
  readonly details: () => Record<string, unknown>;
}

interface HandoffRow {
  handoff_id: string;
  status: 'reserved' | 'confirmed' | 'handed_over' | 'cancelled' | 'no_show';
  owner_id: string;
  recipient_id: string;
}

type Credentials = { email: string; password: string };

/** `givingHandoff.statusLabel.*` (he) — what the listing page prints after each step. */
const STATUS_LABEL_HE = { reserved: 'משוריין', confirmed: 'אושר', handed_over: 'נמסר' } as const;

async function tokenFor(user: Credentials): Promise<{ token: string; userId: string }> {
  const { session } = await sessionFor(user);
  return { token: session.access_token as string, userId: (session.user as { id: string }).id };
}

/** Publishes as `user` through the same RPC the create form calls. Returns the listing id. */
async function publishAs(user: Credentials, journey: WorldJourney): Promise<{ listingId: string; title: string }> {
  const { token } = await tokenFor(user);
  const [kind] = await rest<{ kind_id: string }[]>(
    token,
    `listing_kinds?select=kind_id&world_slug=eq.${journey.world}&slug=eq.${journey.kindSlug}&limit=1`,
  );
  if (!kind) throw new Error(`listing kind ${journey.world}/${journey.kindSlug} is missing on kc-dev`);
  const [city] = await rest<{ city_id: string }[]>(token, 'cities?select=city_id&limit=1');
  const title = `${runTag()} ${journey.titleHe}`;
  const listingId = await rest<string>(token, 'rpc/create_marketplace_listing', {
    method: 'POST',
    body: {
      p_kind_id: kind.kind_id,
      p_title: title,
      p_summary: null,
      p_details: journey.details(),
      p_direction: 'give',
      p_city_id: city?.city_id ?? null,
    },
  });
  if (typeof listingId !== 'string') throw new Error(`create_marketplace_listing returned ${JSON.stringify(listingId)}`);
  return { listingId, title };
}

/** The handoff row as `user` sees it (participant-only RLS); `null` when none exists. */
async function handoffAs(user: Credentials, listingId: string): Promise<HandoffRow | null> {
  const { token } = await tokenFor(user);
  const rows = await rest<HandoffRow[]>(
    token,
    `giving_handoffs?select=handoff_id,status,owner_id,recipient_id&listing_id=eq.${listingId}&order=reserved_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

async function openAs(browser: Browser, storageState: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState, locale: 'he-IL' });
  const page = await ctx.newPage();
  // The rating step thanks the user with a native alert; accept it instead of leaving it open.
  page.on('dialog', (dialog) => void dialog.accept());
  return { ctx, page };
}

/** A handoff button by testID, or by its Hebrew label on a deployment without the testIDs. */
function action(page: Page, testId: string, label: string) {
  return page.getByTestId(testId).or(page.getByText(label, { exact: true })).first();
}

function handoffStatus(page: Page) {
  return page.getByTestId('giving-handoff-status').or(page.getByText(/^סטטוס: /)).first();
}

/** Registers the serial two-user journey for one world. */
export function defineWorldJourney(journey: WorldJourney): void {
  test.describe.serial(`${journey.world}: two-user giving journey`, () => {
    let listingId = '';
    let title = '';
    let handoffId = '';
    const listingPath = () => `/donations/marketplace/${listingId}`;

    test('user A publishes a listing (the RPC the create form calls) and sees it', async ({ page }) => {
      ({ listingId, title } = await publishAs(USER_A, journey));
      await gotoApp(page, listingPath());
      await expect(page.getByText(title).first()).toBeVisible();
      await expect(handoffStatus(page)).toHaveCount(0);
    });

    const claimed = journey.claim.resultsIn;
    const claimedLabel = STATUS_LABEL_HE[claimed];

    test(`user B claims it from the listing page; the handoff is ${claimed} for B`, async ({ browser }) => {
      expect(listingId, 'listing from the publish step').not.toBe('');
      const b = await openAs(browser, STORAGE_B);
      await gotoApp(b.page, listingPath());
      await action(b.page, journey.claim.testId, journey.claim.label).click();
      await expect(handoffStatus(b.page)).toContainText(claimedLabel, { timeout: 20_000 });
      await b.ctx.close();

      const row = await handoffAs(USER_B, listingId);
      const { userId: bId } = await tokenFor(USER_B);
      expect(row?.status).toBe(claimed);
      expect(row?.recipient_id).toBe(bId);
      handoffId = row!.handoff_id;
    });

    if (claimed === 'reserved') {
      test('user A confirms the reservation', async ({ page }) => {
        expect(handoffId, 'handoff from the claim step').not.toBe('');
        page.on('dialog', (dialog) => void dialog.accept());
        await gotoApp(page, listingPath());
        await action(page, 'giving-handoff-confirm', 'אישור שריון').click();
        await expect(handoffStatus(page)).toContainText(STATUS_LABEL_HE.confirmed, { timeout: 20_000 });
        expect((await handoffAs(USER_A, listingId))?.status).toBe('confirmed');
      });
    }

    test('user A marks it handed over: the listing closes and karma is written', async ({ page }) => {
      page.on('dialog', (dialog) => void dialog.accept());
      await gotoApp(page, listingPath());
      await action(page, 'giving-handoff-complete', 'סומן כנמסר').click();
      await expect(handoffStatus(page)).toContainText(STATUS_LABEL_HE.handed_over, { timeout: 20_000 });

      const { token, userId: aId } = await tokenFor(USER_A);
      expect((await handoffAs(USER_A, listingId))?.status).toBe('handed_over');
      const [card] = await rest<{ status: string }[]>(token, `marketplace_listing_card?select=status&listing_id=eq.${listingId}`);
      expect(card?.status).toBe('closed');
      const karma = await rest<{ points_delta: number }[]>(
        token,
        `karma_ledger?select=points_delta&user_id=eq.${aId}&ref_id=eq.${handoffId}&event_type=eq.giving_handoff_giver`,
      );
      expect(karma.length, 'giver karma ledger row for this handoff').toBe(1);
      // Both sides may now rate (spec 07 §7.7); the form sits on the listing page.
      await expect(page.getByTestId('handoff-rating-form')).toBeVisible();
    });

    test('user B rates the handoff; the rating is stored for the rater', async ({ browser }) => {
      const b = await openAs(browser, STORAGE_B);
      await gotoApp(b.page, listingPath());
      await b.page.getByTestId('handoff-rating-star-5').click();
      await b.page.getByTestId('handoff-rating-submit').click();
      // Once B has rated, the handoff no longer surfaces for B (get_listing_handoff), so the form goes away.
      await expect(b.page.getByTestId('handoff-rating-form')).toHaveCount(0, { timeout: 20_000 });
      await b.ctx.close();

      const { token } = await tokenFor(USER_B);
      const ratings = await rest<{ rating: number }[]>(token, `giving_handoff_ratings?select=rating&handoff_id=eq.${handoffId}`);
      expect(ratings.map((r) => r.rating)).toEqual([5]);
    });

    test.afterAll(async () => {
      await cleanupE2eContent(USER_A);
    });
  });
}
