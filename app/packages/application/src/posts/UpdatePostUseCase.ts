/** FR-POST-008 + FR-POST-009: edit an existing post; visibility may change freely (D-32). */
import type { IPostRepository, UpdatePostInput } from '../ports/IPostRepository';
import type { Post } from '@kc/domain';
import { TITLE_MAX_CHARS, DESCRIPTION_MAX_CHARS, MAX_MEDIA_ASSETS } from '@kc/domain';
import { PostError } from './errors';

export interface UpdatePostUseCaseInput {
  postId: string;
  viewerId: string;
  patch: UpdatePostInput;
}

export interface UpdatePostOutput {
  post: Post;
}

export class UpdatePostUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: UpdatePostUseCaseInput): Promise<UpdatePostOutput> {
    const current = await this.repo.findById(input.postId, input.viewerId);
    if (!current) throw new PostError('not_found', `post ${input.postId} not found`);
    if (input.viewerId && current.ownerId !== input.viewerId) {
      throw new PostError('forbidden', 'forbidden');
    }

    assertEditable(current, input.patch);

    const patch = this.validate(input.patch, current);
    const post = await this.repo.update(input.postId, patch);
    return { post };
  }

  private validate(raw: UpdatePostInput, current: Post): UpdatePostInput {
    const patch: UpdatePostInput = { ...raw };
    if (typeof patch.title === 'string') patch.title = normalizeTitle(patch.title);
    if (typeof patch.description === 'string' || patch.description === null) {
      patch.description = normalizeDescription(patch.description);
    }
    if (typeof patch.urgency === 'string' || patch.urgency === null) {
      patch.urgency = patch.urgency?.trim() || null;
    }
    if (patch.address) assertAddress(patch.address);
    if (patch.mediaAssets !== undefined) assertMedia(patch.mediaAssets, current);
    return patch;
  }
}

/**
 * FR-POST-009 + D-34: on closed_delivered / deleted_no_recipient, only a
 * visibility-only patch is allowed (owner-driven Hide / Unhide).
 * removed_admin and expired remain fully locked.
 */
function assertEditable(current: Post, patch: UpdatePostInput): void {
  if (current.status === 'open') return;
  const isClosedHideable =
    current.status === 'closed_delivered' || current.status === 'deleted_no_recipient';
  const patchKeys = Object.keys(patch).filter(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  );
  const isVisibilityOnly = patchKeys.length === 1 && patchKeys[0] === 'visibility';
  if (!(isClosedHideable && isVisibilityOnly)) {
    throw new PostError('post_not_open', `cannot edit post with status ${current.status}`);
  }
}

function normalizeTitle(title: string): string {
  const t = title.trim();
  if (t.length === 0) throw new PostError('title_required', 'title_required');
  if (t.length > TITLE_MAX_CHARS) throw new PostError('title_too_long', `title_too_long (>${TITLE_MAX_CHARS})`);
  return t;
}

function normalizeDescription(description: string | null): string | null {
  const d = description?.trim() ?? null;
  if (d && d.length > DESCRIPTION_MAX_CHARS) {
    throw new PostError('description_too_long', `description_too_long (>${DESCRIPTION_MAX_CHARS})`);
  }
  return d;
}

function assertAddress(address: NonNullable<UpdatePostInput['address']>): void {
  if (!address.city || !address.street || !address.streetNumber) {
    throw new PostError('address_required', 'address_required');
  }
}

function assertMedia(mediaAssets: NonNullable<UpdatePostInput['mediaAssets']>, current: Post): void {
  if (mediaAssets.length > MAX_MEDIA_ASSETS) {
    throw new PostError('too_many_media_assets', `too_many_media_assets (>${MAX_MEDIA_ASSETS})`);
  }
  if (current.type === 'Give' && mediaAssets.length === 0) {
    throw new PostError('image_required_for_give', 'image_required_for_give');
  }
}
