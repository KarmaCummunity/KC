/**
 * Two-user giving journey per active world (G40, docs/architecture/target.md §5.1).
 *
 * One journey shape, one fixture per world: user A publishes a post the same way the app
 * does (a draft + photo + `publish_post` for items, `create_post_with_details` for food, on
 * the production baseline D-228), user B claims it from the post page, A
 * confirms, A hands it over (listing closes, karma is written), B rates. A request kind
 * takes no handoff, so its journey is the first half: publish, discovery, the chat. UI steps
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
import { publishPostAs } from './publish';
import { anchoredChatHolds, feedShows, messageOwnerFromPost, seen } from './postDiscovery';
import { STORAGE_B, USER_A, USER_B } from './env';

export interface WorldJourney {
  /** Marketplace world slug — the fixture that plugs a world into this journey. */
  readonly world: 'items' | 'food' | 'animals';
  /** `post_kinds.slug` of the "offer" kind the post is published under. */
  readonly kindSlug: string;
  /**
   * How the app publishes this kind: `plain` is a draft, its photo and `publish_post` (an offer
   * needs a photo); `food` is `create_post_with_details` with the food detail row.
   */
  readonly publish: 'plain' | 'food';
  /** Hebrew title stem; the run tag is prepended so cleanup can find the row. */
  readonly titleHe: string;
  /**
   * The recipient's first action on the listing page: testID + Hebrew label fallback, and
   * the handoff status it produces — items and animal adoption reserve and wait for the owner (`reserved`),
   * the food quick claim is confirmed at once (`confirmed`, 0383; no owner approval step).
   * Omitted for a kind that takes no handoff (a request, `kc_private.handoff_flow_of` is null):
   * a member answers it in the chat on the post, so its journey ends at the chat step.
   */
  readonly claim?: { readonly testId: string; readonly label: string; readonly resultsIn: 'reserved' | 'confirmed' };
  /** The detail row the create form would collect (food: `expires_at`, `allergens`, `kosher`). */
  readonly details: () => Record<string, unknown>;
}

interface HandoffRow {
  id: string;
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

/** The handoff row as `user` sees it (participant-only RLS); `null` when none exists. */
async function handoffAs(user: Credentials, postId: string): Promise<HandoffRow | null> {
  const { token } = await tokenFor(user);
  const [row] = await rest<HandoffRow[]>(token, `post_handoffs?select=id,status,owner_id,recipient_id&post_id=eq.${postId}&order=created_at.desc&limit=1`);
  return row ?? null;
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

/**
 * After a handoff action: the server row (read as `user`, through RLS) reaches `status`
 * first, then the listing page shows it. On a slow dev backend the action's own refetch can
 * lag behind the write, so the page gets one reload instead of a longer blind wait; an action
 * that never reaches the server still fails, with a message that says so.
 */
async function expectHandoffStatus(
  page: Page,
  path: string,
  user: Credentials,
  postId: string,
  status: keyof typeof STATUS_LABEL_HE,
): Promise<HandoffRow> {
  await expect
    .poll(async () => (await handoffAs(user, postId))?.status ?? 'no handoff row', {
      timeout: 60_000,
      message: `handoff on ${postId} reaches '${status}' on the server`,
    })
    .toBe(status);
  const label = STATUS_LABEL_HE[status];
  try {
    await expect(handoffStatus(page)).toContainText(label, { timeout: 10_000 });
  } catch {
    await gotoApp(page, path);
    await expect(handoffStatus(page)).toContainText(label, { timeout: 30_000 });
  }
  return (await handoffAs(user, postId))!;
}

/** Registers the serial two-user journey for one world. */
export function defineWorldJourney(journey: WorldJourney): void {
  // The title says which shape runs: the full handoff of an offer, or the chat-only half of a request.
  const shape = journey.claim ? 'giving' : 'request';
  test.describe.serial(`${journey.world} (${journey.kindSlug}): two-user ${shape} journey`, () => {
    let listingId = '';
    let title = '';
    let handoffId = '';
    const listingPath = () => `/post/${listingId}`;

    test('user A publishes a listing (the RPC the create form calls) and sees it', async ({ page }) => {
      ({ id: listingId, title } = await publishPostAs(USER_A, { ...journey, title: `${runTag()} ${journey.titleHe}` }));
      await gotoApp(page, listingPath());
      await expect(page.getByText(title).first()).toBeVisible();
      await expect(handoffStatus(page)).toHaveCount(0);
    });

    // FR-FEED-001, D165: every world's posts reach its own feed and the main feed (#1027).
    test('user B finds it in the world feed and in the main feed', async () => {
      expect(listingId, 'listing from the publish step').not.toBe('');
      // Two polls of up to a minute each: a busy kc-dev may fail a few reads before one answers.
      test.setTimeout(150_000);
      const { token } = await tokenFor(USER_B);
      await expect
        .poll(() => seen(() => feedShows(token, listingId, title, journey.world)), { timeout: 60_000, message: `${journey.world} feed shows the post` })
        .toBe('yes');
      await expect
        .poll(() => seen(() => feedShows(token, listingId, title, null)), { timeout: 60_000, message: 'main feed shows the post' })
        .toBe('yes');
    });

    // FR-CHAT-014: a member contacts the owner from the post; the chat is anchored on it (#1027).
    test('user B messages the owner from the post page; the owner reads it in the chat on the post', async ({ browser }) => {
      expect(listingId, 'listing from the publish step').not.toBe('');
      test.setTimeout(150_000);
      // The two members share one chat across all their posts, so the text names this post:
      // a message from an earlier journey or attempt can never satisfy the check.
      const text = `${runTag()} ${journey.world} chat on ${listingId}`;
      const b = await openAs(browser, STORAGE_B);
      await gotoApp(b.page, listingPath());
      await messageOwnerFromPost(b.page, text);
      const { token } = await tokenFor(USER_A);
      await expect
        .poll(() => seen(() => anchoredChatHolds(token, listingId, text)), {
          timeout: 60_000,
          message: 'the owner reads the message in the chat anchored on the post',
        })
        .toBe('yes');
      await b.ctx.close();
    });

    test.afterAll(async () => {
      await cleanupE2eContent(USER_A);
    });

    // A kind without a handoff ends here: publish, discovery and the chat are its whole journey.
    const claim = journey.claim;
    if (!claim) return;
    const claimed = claim.resultsIn;

    test(`user B claims it from the listing page; the handoff is ${claimed} for B`, async ({ browser }) => {
      expect(listingId, 'listing from the publish step').not.toBe('');
      test.setTimeout(150_000);
      const b = await openAs(browser, STORAGE_B);
      await gotoApp(b.page, listingPath());
      await expect(b.page.getByText(title).first()).toBeVisible();
      await action(b.page, claim.testId, claim.label).click();
      const row = await expectHandoffStatus(b.page, listingPath(), USER_B, listingId, claimed);
      await b.ctx.close();

      const { userId: bId } = await tokenFor(USER_B);
      expect(row?.status).toBe(claimed);
      expect(row?.recipient_id).toBe(bId);
      handoffId = row!.id;
    });

    if (claimed === 'reserved') {
      test('user A confirms the reservation', async ({ page }) => {
        expect(handoffId, 'handoff from the claim step').not.toBe('');
        page.on('dialog', (dialog) => void dialog.accept());
        await gotoApp(page, listingPath());
        test.setTimeout(150_000);
        await action(page, 'giving-handoff-confirm', 'אישור שריון').click();
        await expectHandoffStatus(page, listingPath(), USER_A, listingId, 'confirmed');
      });
    }

    test('user A marks it handed over: the listing closes and karma is written', async ({ page }) => {
      // The karma consumer is a once-a-minute job: allow it a full cycle plus the run itself,
      // after up to 100 s for the handover to show (server poll + one reload).
      test.setTimeout(240_000);
      page.on('dialog', (dialog) => void dialog.accept());
      await gotoApp(page, listingPath());
      await action(page, 'giving-handoff-complete', 'סומן כנמסר').click();
      await expectHandoffStatus(page, listingPath(), USER_A, listingId, 'handed_over');

      const { token, userId: aId } = await tokenFor(USER_A);
      const [post] = await rest<{ status: string }[]>(token, `posts?select=status&id=eq.${listingId}`);
      // A delivered handoff closes the post as `closed_delivered` (the post status machine).
      expect(post?.status).toBe('closed_delivered');
      // The giver's karma is written by the event consumer; allow it a moment.
      await expect
        .poll(
          async () =>
            (await rest<{ points: number }[]>(
              token,
              `karma_ledger?select=points&user_id=eq.${aId}&event_type=eq.handoff_giver&subject=eq.${encodeURIComponent(`handoff:${handoffId}:giver`)}`,
            )).length,
          { timeout: 100_000, message: 'giver karma ledger row for this handoff' },
        )
        .toBe(1);
      // Both sides may now rate (spec 07 §7.7); the form sits on the listing page.
      await expect(page.getByTestId('handoff-rating-form')).toBeVisible();
    });

    test('user B rates the handoff; the rating is stored for the rater', async ({ browser }) => {
      const b = await openAs(browser, STORAGE_B);
      await gotoApp(b.page, listingPath());
      await b.page.getByTestId('handoff-rating-star-5').click();
      await b.page.getByTestId('handoff-rating-submit').click();
      // The page keeps showing the form after a rating (the handoff stays 'handed_over'), so the
      // assertion is the stored row, not the form going away.
      const { token } = await tokenFor(USER_B);
      await expect
        .poll(
          async () =>
            (await rest<{ stars: number }[]>(token, `post_ratings?select=stars&handoff_id=eq.${handoffId}`)).map((r) => r.stars),
          { timeout: 20_000 },
        )
        .toEqual([5]);
      await b.ctx.close();
    });
  });
}
