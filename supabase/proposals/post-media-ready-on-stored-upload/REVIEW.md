# Proposal: mark a member's stored post photo `ready` on insert (KC#2316)

Status: **proposal only, needs privacy and lifecycle review.** Not in `supabase/migrations/`, not applied
anywhere except a throwaway local PostgreSQL used to run `test.sql`.

## What it does

An `AFTER INSERT` trigger on `public.post_media` moves a row `pending → ready` (FSM role `system`, one
write) when **all** hold:

- the insert is the owner's own (`auth.uid() = owner_id`); server paths (WhatsApp bot, jobs) are untouched;
- `kind = 'image'`, bucket `post-images`;
- `storage.objects` has that key with `metadata.mimetype = mime_type` and `metadata.size = size_bytes`.

No download, decode, storage write, schedule or backfill. Existing `pending` rows stay `pending`.

## Measured (local PostgreSQL 16 + PostGIS + pgTAP, `scripts/run-baseline-tests.sh`)

- `test.sql` without the trigger: 6 of 12 assertions fail (the regression it targets).
- `test.sql` with the trigger: 14 of 14 pass. `044_post_media_sizes`, `044_offer_photo_rule`,
  `099_post_share_card` and `106_whatsapp_bot_post_photos` still pass with it applied.

## Why it is not safe as a DB-only change (open review items)

| Concern | Status with this proposal |
| --- | --- |
| (a) EXIF/GPS in the original (NFR-PRIV-002, FR-POST-005 AC4) | **Not solved.** The database cannot read the bytes. Our app re-encodes on the device (EXIF dropped), but a modified client can upload a JPEG that still carries GPS, and the row would become `ready` at once. The daily `strip-exif` job runs up to ~24 h later and rewrites the object in place. |
| (b) Visibility (hidden, removed, deleted, draft, blocked) | Unchanged. `ready` media is still read only through the post's own RLS, `post_cards`, `post_detail` and `post_share_card`. `test.sql` asserts that the media of a draft and of an `OnlyMe` post stay out of other members' reads and out of the share card; `099_post_share_card` covers moderated, suspended-owner and followers-only posts. |
| (c) Bucket and storage policy | Partly. Writes are restricted to the owner's folder (storage RLS), with an 8 MB limit and `image/jpeg`/`image/png` checked against the **declared** content type. The bytes are not checked: HTML or SVG uploaded as `image/jpeg`, or a decompression bomb inside 8 MB, would pass. The trigger adds only metadata equality checks. |
| (d) Historical rows | No backfill, no mass change (asserted). Existing rows stay invisible to other members until a reviewed process handles them. |

Note: the `post-images` bucket is already public. Anyone who knows an object's URL can fetch it whatever
its `processing_status`. The `pending` gate only keeps the key out of other members' reads. Keys contain
two random UUIDs, so the gate stops discovery but does not restrict access.

## What the branch's app-side workaround does NOT fix

The branch adds an **owner-only** fallback (`app/packages/infrastructure-supabase/src/posts/ownPendingCovers.ts`).
A member's own feed and profile cards show their still-pending first photo, read with their own
RLS rights. **It changes nothing for anyone else.** While media stays `pending`, other viewers'
feed cards, the post page and the WhatsApp/link share preview still show **no photo**. The
public-eligibility gap (what makes pending media `ready` and publicly visible, safely) remains
**OPEN** and is gated on the privacy and lifecycle review below. The workaround does not complete KC#2316.

## Related app change: storage transforms are now opt-in

- **Was on by default (measured from code):** before this branch, `app/apps/mobile/src/lib/imageUrl.ts`
  (`transformsDisabled` + `wantsTransform`, lines 27-39 at `origin/dev` c3873b02) returned true whenever a width was passed,
  unless `EXPO_PUBLIC_USE_STORAGE_TRANSFORM=0`. The feed and the post detail always pass a width, and no
  file in the repo sets the flag.
- **Paid add-on (Supabase docs, fetched 2026-11-20):** "Image Resizing is currently enabled for Pro Plan
  and above" (https://supabase.com/docs/guides/storage/serving/image-transformations); "$5 per 1,000
  origin images. You are only charged for usage exceeding your subscription plan's quota", Pro quota 100
  (https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations).
- **Unverified:** which plan kc-dev and kc-prod are on, and what the render endpoint returns on a plan
  without transforms. The docs do not say, and nothing remote was called from this branch.

## What would make it safe (owner decisions)

1. A server step that **writes a new sanitized derivative** (never overwrites the original). It checks the
   size before downloading, caps pixel dimensions before decoding, handles only new rows, and is
   lifecycle-aware (skips posts that were deleted or locked meanwhile). Readers then use the derivative.
2. Or an explicit product/privacy decision that the device re-encode is enough for launch, with the
   residual risk above accepted in `docs/spec/90_decisions_log.md`.
