// Builds the link-preview card (title, description, image) of a shared post. Pure: the caller
// passes the row it read and the resolved config. The card must describe the same thing the
// share text does, per world and direction, and must never carry anything RLS did not return.

import { he } from '../i18n/he.mjs';
import { fallbackImage } from './ogImage.mjs';

export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;

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

/**
 * @param row one row of `post_share_card`
 * @param image the preview image chosen for it (`selectOgImage`); the logo when omitted
 */
export function buildPostCard(row, config, image = fallbackImage(config.appBaseUrl)) {
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
    image,
  };
}

/** The card of any link that has no readable post behind it (RLS hides it, deleted, bad id). */
export function buildGenericCard(config) {
  return { title: he.appName, description: he.appTagline, image: fallbackImage(config.appBaseUrl) };
}

/** A profile card is deliberately generic: it carries no personal data, whatever the privacy mode. */
export function buildProfileCard(config) {
  return {
    title: he.profileTitle,
    description: he.profileDescription,
    image: fallbackImage(config.appBaseUrl),
  };
}
