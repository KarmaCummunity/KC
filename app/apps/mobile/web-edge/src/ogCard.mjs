// Builds the link-preview card (title, description, image) of a shared post. Pure: the caller
// passes the row it read and the resolved config. The card must describe the same thing the
// share text does, per world and direction, and must never carry anything RLS did not return.

import { he } from '../i18n/he.mjs';
import { trimTrailingSlashes } from './config.mjs';

export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;
/** The only bucket a post image may live in (the baseline's single public media bucket). */
const IMAGE_BUCKET = 'post-images';
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

/** A post is an offer or a request; the database allows nothing else. */
function resolveDirection(direction) {
  return direction === 'request' ? 'request' : 'offer';
}

/** The public URL of the post's cover image, or the logo. */
export function resolveImageUrl({ cover_bucket: bucket, cover_key: key }, { supabaseUrl, appBaseUrl }) {
  const fallback = `${appBaseUrl}${FALLBACK_IMAGE_PATH}`;
  if (!supabaseUrl || bucket !== IMAGE_BUCKET || typeof key !== 'string' || key === '') return fallback;
  const path = key.startsWith('/') ? key.slice(1) : key;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${trimTrailingSlashes(supabaseUrl)}/storage/v1/object/public/${IMAGE_BUCKET}/${encoded}`;
}

/** @param row one row of `post_share_card` */
export function buildPostCard(row, config) {
  const world = resolveWorld(row.world_slug);
  const direction = resolveDirection(row.direction);
  const closed = row.status === 'closed_delivered';
  // A closed post keeps its kind in the title but leads with the check mark instead.
  const prefix = closed ? he.closedPrefix : he.titlePrefix[world][direction];
  const description = (row.description ?? '').trim() || he.fallbackDescription[world][direction];
  const city = (row.city_name_he ?? '').trim();
  return {
    title: truncate(`${prefix} · ${row.title.trim()}`, TITLE_MAX),
    description: truncate(city ? `${description} 📍 ${city}` : description, DESCRIPTION_MAX),
    imageUrl: resolveImageUrl(row, config),
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
