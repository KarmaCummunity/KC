/**
 * The offer photo rule on kc-dev (D132, KC#1937): an offer in a photo world needs at least one
 * photo, on create and on edit; requests stay photo-optional.
 *
 * Mapped to spec:
 * - FR-POST-002 AC4: the create form refuses a photo-less "give" post and says why under the photo picker.
 * - FR-POST-002 AC5: the server refuses to publish a photo-world offer that has no photo
 *   (`offer_photo_required`), and lets a request through without one.
 * - FR-POST-019 AC1a: an edit can't leave a live offer without a photo (`replace_post_media`),
 *   and the last photo row can't be deleted directly either.
 *
 * Rides and every other world stay photo-optional: proven at the DB level (supabase/tests/044).
 * The listing form's refusal (food) is covered by qa/marketplace.spec.ts; this file covers the items form.
 * The server half runs as user C, so it never spends user A's hourly `post_create` window,
 * which the rest of the suite needs (#2444). Every post it writes is removed at the end.
 */
import { test, expect } from '@playwright/test';
import { cleanupE2eContent, rest, runTag, sessionFor, uploadPostPhoto } from '../../lib/api';
import { gotoApp } from '../../lib/app';
import { USER_A, USER_C } from '../../lib/env';
import { createDraftAs, type PostToPublish, type WrittenPost } from '../../lib/publish';

/** Server error code of the rule (`kc_private.post_require_offer_photo`). */
const OFFER_PHOTO_REQUIRED = /offer_photo_required/;
/** Hebrew copy of `createPostValidation.missingPhoto`, shown under the photo picker. */
const MISSING_PHOTO_HE = 'יש להוסיף לפחות תמונה אחת לפני פרסום.';
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/** One offer per write path of the app: a draft row (items, animals) and the food RPC. */
const PHOTO_WORLD_OFFERS: readonly Omit<PostToPublish, 'title'>[] = [
  { world: 'items', kindSlug: 'item_offer', publish: 'plain', details: () => ({}) },
  { world: 'animals', kindSlug: 'adoption_offer', publish: 'plain', details: () => ({ species: 'dog' }) },
  {
    world: 'food',
    kindSlug: 'food_offer',
    publish: 'food',
    details: () => ({ expires_at: new Date(Date.now() + TWO_DAYS_MS).toISOString(), allergens: [], kosher: null }),
  },
];

/** Drafts this file created; a member may delete only a draft directly (posts_delete_owner_draft). */
const draftsToDelete: WrittenPost[] = [];

async function draftAsUserC(offer: Omit<PostToPublish, 'title'>, titleHe: string): Promise<WrittenPost> {
  const draft = await createDraftAs(USER_C, { ...offer, title: `${runTag()} ${titleHe}` });
  draftsToDelete.push(draft);
  return draft;
}

/** The post's status, re-read through the REST API as its owner. */
async function statusOf(post: WrittenPost): Promise<string | undefined> {
  const [row] = await rest<{ status: string }[]>(post.token, `posts?select=status&id=eq.${post.id}`);
  return row?.status;
}

/** Ids of the post's photo rows, as its owner sees them. */
async function photoIdsOf(post: WrittenPost): Promise<string[]> {
  const rows = await rest<{ id: string }[]>(post.token, `post_media?select=id&post_id=eq.${post.id}`);
  return rows.map((r) => r.id);
}

/** Calls `publish_post` on a draft as its owner. */
function publish(post: WrittenPost): Promise<unknown> {
  return rest(post.token, 'rpc/publish_post', { method: 'POST', body: { p_post_id: post.id } });
}

test.describe.serial('offer photo rule (D132)', () => {
  for (const offer of PHOTO_WORLD_OFFERS) {
    test(`server refuses to publish an offer with no photo (${offer.world})`, async () => {
      const draft = await draftAsUserC(offer, 'הצעה בלי תמונה');
      await expect(publish(draft)).rejects.toThrow(OFFER_PHOTO_REQUIRED);
      // The refusal is the whole transaction: the post stays an unpublished draft.
      expect(await statusOf(draft)).toBe('draft');
    });
  }

  test('server publishes an items request with no photo', async () => {
    const draft = await draftAsUserC(
      { world: 'items', kindSlug: 'item_request', publish: 'plain', details: () => ({}) },
      'מחפש/ת מדף ספרים',
    );
    await publish(draft);
    expect(await statusOf(draft)).toBe('open');
  });

  test("an edit can't remove the last photo of a live offer", async () => {
    const offer = await draftAsUserC(PHOTO_WORLD_OFFERS[0]!, 'כיסא עץ עם תמונה');
    const key = await uploadPostPhoto(offer.token, offer.userId);
    await rest(offer.token, 'rpc/replace_post_media', {
      method: 'POST',
      body: { p_post_id: offer.id, p_media: [{ storage_key: key, mime_type: 'image/png', size_bytes: 1 }] },
    });
    await publish(offer);
    expect(await statusOf(offer)).toBe('open');
    const [photoId] = await photoIdsOf(offer);
    expect(photoId, 'the published offer has its photo').toBeTruthy();

    // The edit form's one write: an empty gallery is refused and nothing changes.
    await expect(
      rest(offer.token, 'rpc/replace_post_media', { method: 'POST', body: { p_post_id: offer.id, p_media: [] } }),
    ).rejects.toThrow(OFFER_PHOTO_REQUIRED);
    // Deleting the last photo row directly is refused by the table's own trigger.
    await expect(
      rest(offer.token, `post_media?id=eq.${photoId}`, { method: 'DELETE' }),
    ).rejects.toThrow(OFFER_PHOTO_REQUIRED);
    expect(await photoIdsOf(offer)).toEqual([photoId]);
  });

  test('the create form refuses a give post with no photo and says why under the photo picker', async ({ page }, info) => {
    const title = `${runTag()} מדף ספרים בלי תמונה`;
    await gotoApp(page, '/create');
    await expect(page.getByTestId('create-post-screen')).toBeVisible();
    await page.getByTestId('create-direction-give').click();
    await page.getByTestId('create-post-title').fill(title);
    await page.getByTestId('create-header-publish').click();

    const photos = page.getByTestId('create-post-photos');
    await expect(photos.getByText(MISSING_PHOTO_HE)).toBeVisible();
    await expect(page).toHaveURL(/\/create/);
    // Visual proof of the validation for the issue's closure rule, kept in the Playwright report.
    await info.attach('create-offer-photo-required', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // Refused on the device: nothing reached the server.
    const { session } = await sessionFor(USER_A);
    const rows = await rest<{ id: string }[]>(
      session.access_token as string,
      `posts?select=id&title=eq.${encodeURIComponent(title)}`,
    );
    expect(rows).toEqual([]);
  });

  test.afterAll(async () => {
    // Drafts are deleted directly; published posts go through `delete_post` (cleanupE2eContent).
    for (const draft of draftsToDelete) {
      if ((await statusOf(draft).catch(() => undefined)) !== 'draft') continue;
      await rest(draft.token, `posts?id=eq.${draft.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await cleanupE2eContent(USER_C);
  });
});
