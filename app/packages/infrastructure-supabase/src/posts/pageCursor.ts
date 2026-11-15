// Opaque cursors of keyset pages. The baseline page functions (`feed_page`, `profile_posts_page`,
// `post_comments_page`, ...) return `next_cursor` as a JSON object and take it back unchanged; the
// application ports carry it as a string, so the adapter serialises it here. Callers never read it.

import type { Json } from '../database.types';

/** The cursor as the string the ports pass around; null when the page was the last one. */
export function encodePageCursor(next: Json | null | undefined): string | null {
  return next === null || next === undefined ? null : JSON.stringify(next);
}

/**
 * The JSON object a page function takes as `p_cursor`. A missing or unreadable cursor starts at the
 * first page, so a stale cursor kept by a screen never raises.
 */
export function decodePageCursor(raw: string | undefined | null): Json | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return isObject ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

// ── Keyset cursor over a table read ──────────────────────────────────────────
// Lists the baseline has no page function for (a member's posts by status, saved posts) are read
// from the table and paged by `(time column, id)`. The cursor is interpolated into a PostgREST
// filter, so only a plain ISO timestamp and a UUID are accepted.

const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Position after a row: its time and its id. */
export interface KeysetCursor {
  readonly t: string;
  readonly id: string;
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return JSON.stringify(cursor);
}

/** The validated cursor, or null (first page) for a missing, malformed or hostile value. */
export function parseKeysetCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KeysetCursor>;
    const valid =
      typeof parsed.t === 'string' && ISO_TS.test(parsed.t) && typeof parsed.id === 'string' && UUID.test(parsed.id);
    return valid ? { t: parsed.t as string, id: parsed.id as string } : null;
  } catch {
    return null;
  }
}

/** PostgREST `.or()` filter selecting the rows after `cursor` in a newest-first order. */
export function keysetAfterFilter(timeColumn: string, idColumn: string, cursor: KeysetCursor): string {
  return `${timeColumn}.lt.${cursor.t},and(${timeColumn}.eq.${cursor.t},${idColumn}.lt.${cursor.id})`;
}
