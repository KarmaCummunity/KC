// FR-POST-023 — the share link and message of a profile. Pure: the caller resolves the display name
// (the same masked-or-visible rule the profile screen uses) and reads the web base URL.
//
// A profile card carries no personal data beyond the name the sharer already sees, and the edge
// answers the link with a generic card (web-edge/src/ogCard.mjs), so a private profile leaks nothing.

import type { ShareTranslate } from './buildPostShareMessage';

/** `webBaseUrl` comes from `resolveWebBaseUrl`, so it is already trimmed of trailing slashes. */
export function buildProfileShareUrl(shareHandle: string, webBaseUrl: string): string {
  const handle = shareHandle.trim();
  if (handle === '') throw new Error('buildProfileShareUrl: shareHandle is required');
  return `${webBaseUrl}/user/${encodeURIComponent(handle)}`;
}

export interface ProfileShareMessageInput {
  /** Display name, or null/blank when the profile hides identity. */
  readonly displayName: string | null;
}

export function buildProfileShareMessage(input: ProfileShareMessageInput, t: ShareTranslate): string {
  const name = (input.displayName ?? '').trim();
  const headline =
    name === '' ? t('share.profile.headlineAnonymous') : t('share.profile.headline', { name });
  return [headline, '', t('share.profile.body'), '', t('share.profile.cta')].join('\n');
}
