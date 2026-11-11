// Builds the link-preview card (title, description, image) of a shared post. Pure: the caller
// passes the row it read and the resolved config. The card must describe the same thing the
// share text does, per world and direction, and must never carry anything RLS did not return.

import { he } from '../i18n/he.mjs';
import { trimTrailingSlashes } from './config.mjs';

export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;
/** The only buckets a post image may live in (mirrors `MediaAsset.bucket` in @kc/domain). */
const IMAGE_BUCKETS = new Set(['post-images', 'listing-images']);
/** The community logo, used when the post has no usable image. */
export const FALLBACK_IMAGE_PATH = '/pwa-icon-512.png';

/** World slugs the cards have copy for; any other slug falls back to `generic`. */
const WORLDS = new Set(['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge', 'challenges']);

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A post without a world slug is a plain item post. */
export function resolveWorld(worldSlug) {
  if (worldSlug === null || worldSlug === undefined || worldSlug === '') return 'items';
  return WORLDS.has(worldSlug) ? worldSlug : 'generic';
}

/** `Give` is an offer, `Request` a request; anything else reads as an offer-free generic. */
function resolveDirection(type) {
  return type === 'Request' ? 'request' : 'offer';
}

/** The public URL of the post's first image, or the logo. */
export function resolveImageUrl(media, { supabaseUrl, appBaseUrl }) {
  const fallback = `${appBaseUrl}${FALLBACK_IMAGE_PATH}`;
  if (!Array.isArray(media) || !supabaseUrl) return fallback;
  const first = media
    .filter((m) => m && typeof m.path === 'string' && m.path !== '' && IMAGE_BUCKETS.has(m.bucket ?? 'post-images'))
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))[0];
  if (!first) return fallback;
  const path = first.path.startsWith('/') ? first.path.slice(1) : first.path;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${trimTrailingSlashes(supabaseUrl)}/storage/v1/object/public/${first.bucket ?? 'post-images'}/${encoded}`;
}

/**
 * @param {{ title: string, description: string | null, type: string, status: string,
 *           world_slug: string | null, city: string | null, media_assets: unknown[] }} row
 */
export function buildPostCard(row, config) {
  const world = resolveWorld(row.world_slug);
  const direction = resolveDirection(row.type);
  const closed = row.status === 'closed_delivered';
  // A closed post keeps its kind in the title but leads with the check mark instead.
  const prefix = closed ? he.closedPrefix : he.titlePrefix[world][direction];
  const description = (row.description ?? '').trim() || he.fallbackDescription[world][direction];
  const city = (row.city ?? '').trim();
  return {
    title: truncate(`${prefix} · ${row.title.trim()}`, TITLE_MAX),
    description: truncate(city ? `${description} 📍 ${city}` : description, DESCRIPTION_MAX),
    imageUrl: resolveImageUrl(row.media_assets, config),
  };
}

/** The card of any link that has no readable post behind it (RLS hides it, deleted, bad id). */
export function buildGenericCard(config) {
  return { title: he.appName, description: he.appTagline, imageUrl: `${config.appBaseUrl}${FALLBACK_IMAGE_PATH}` };
}

/** A profile card is deliberately generic: it carries no personal data, whatever the privacy mode. */
export function buildProfileCard(config) {
  return {
    title: he.profileTitle,
    description: he.profileDescription,
    imageUrl: `${config.appBaseUrl}${FALLBACK_IMAGE_PATH}`,
  };
}
